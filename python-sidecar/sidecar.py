#!/usr/bin/env python3
"""CrateForge sidecar (Fase 1: pyrekordbox + fpcalc).

Contratto con il processo Node (vedi src/main/sidecar.ts):
  - invocazione:  sidecar <comando> --udm-path <file> [opzioni]
  - stdout:       SOLO righe JSON {type: progress|done|error|log, ...}
  - dati di massa: scritti DIRETTAMENTE nell'UDM (writer-ownership §2),
    mai attraverso stdout.
  - lo schema UDM è di proprietà di Node: qui niente DDL, solo INSERT/UPDATE
    nelle tabelle di ingestion (tracks, playlists, playlist_tracks, cues,
    ingest_runs).
  - il master.db cifrato è competenza esclusiva di questo processo, aperto in
    sola lettura via pyrekordbox/sqlcipher3. Node non lo tocca mai.

Comandi:
  ping                verifica presenza/avviabilità (usato dai test di fumo)
  ingest-masterdb     legge master.db e popola l'UDM
  fingerprint         calcola l'impronta Chromaprint di un singolo file (fpcalc)

Comandi Fase 2 (modalità Esperto, sperimentali):
  fingerprint-batch   acoustic_id per tutti i brani senza (dedup)
  match-fingerprints  ritrova file spostati/rinominati per acoustic_id
  analyze-cues        propone fino a 8 cue (richiede librerie AI, vedi
                      requirements-ai.txt; degrada con errore pulito)
  stems               separazione stem via Demucs (se installato)

Comandi fase intermedia (opt-in "scritture dirette", massima cautela):
  write-tags          scrive tag ID3/Vorbis SUI FILE ORIGINALI via mutagen,
                      con backup verificato per hash e rollback automatico
  download-key        recupera la chiave di decrittazione di Rekordbox
                      (fallback pyrekordbox §4.3, modalità Esperto)

Comandi di scrittura DIRETTA nel master.db (opt-in massimo, Rekordbox chiuso):
  masterdb-create-playlist   crea una playlist e vi aggiunge dei brani,
                             scrivendo e ri-cifrando il master.db via
                             pyrekordbox (gestisce l'USN con commit(autoinc)).
                             La cifratura SQLCipher del db è documentata
                             (chiave fissa nota); il rischio è la scrittura
                             concorrente con Rekordbox aperto, non la cifratura.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime

# ---------------------------------------------------------------------------
# Emissione eventi (throttling obbligatorio §2: mai un evento per traccia)
# ---------------------------------------------------------------------------

_MIN_INTERVAL_S = 0.15


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class ThrottledProgress:
    """Coalizza i progressi: max ~1 evento ogni 150 ms o ogni 100 item."""

    def __init__(self, phase: str) -> None:
        self.phase = phase
        self._last_emit = 0.0
        self._last_done = 0

    def update(self, done: int, total: int) -> None:
        now = time.monotonic()
        if done - self._last_done < 100 and now - self._last_emit < _MIN_INTERVAL_S:
            return
        self._last_emit = now
        self._last_done = done
        emit({"type": "progress", "phase": self.phase, "done": done, "total": total})

    def finish(self, done: int, total: int) -> None:
        emit({"type": "progress", "phase": self.phase, "done": done, "total": total})


def fail(message: str, code: int = 1) -> "NoReturn":  # noqa: F821
    emit({"type": "error", "message": message})
    sys.exit(code)


def _load_json_payload(inline: str | None, file_path: str | None):
    """Carica un payload JSON da file (preferito) o da stringa inline.
    Node scrive i payload grossi (write-tags, masterdb) in un file temporaneo
    per non superare il limite della command line di Windows (~32 KB).
    """
    if file_path:
        with open(file_path, encoding="utf-8") as f:
            return json.load(f)
    return json.loads(inline or "")


# ---------------------------------------------------------------------------
# Normalizzazioni (specchiano src/core/camelot.ts e versionRegex.ts)
# ---------------------------------------------------------------------------

_CAMELOT_MAJOR = {
    "B": "1B", "F#": "2B", "GB": "2B", "DB": "3B", "C#": "3B", "AB": "4B",
    "G#": "4B", "EB": "5B", "D#": "5B", "BB": "6B", "A#": "6B", "F": "7B",
    "C": "8B", "G": "9B", "D": "10B", "A": "11B", "E": "12B",
}
_CAMELOT_MINOR = {
    "G#": "1A", "AB": "1A", "D#": "2A", "EB": "2A", "A#": "3A", "BB": "3A",
    "F": "4A", "C": "5A", "G": "6A", "D": "7A", "A": "8A", "E": "9A",
    "B": "10A", "F#": "11A", "GB": "11A", "C#": "12A", "DB": "12A",
}


def to_camelot(key: str | None) -> str | None:
    if not key:
        return None
    raw = key.strip()
    m = re.match(r"^([1-9]|1[0-2])\s*([ABab])$", raw)
    if m:
        return f"{int(m.group(1))}{m.group(2).upper()}"
    m = re.match(r"^([A-Ga-g])\s*([#♯b♭]?)\s*(.*)$", raw)
    if not m:
        return None
    acc = {"♯": "#", "♭": "B", "b": "B"}.get(m.group(2), m.group(2))
    note = (m.group(1).upper() + acc).upper()
    mode = m.group(3).strip().lower()
    is_minor = mode == "m" or mode.startswith("min") or mode == "-"
    is_major = mode == "" or mode.startswith("maj") or mode == "dur"
    if is_minor:
        return _CAMELOT_MINOR.get(note)
    if is_major:
        return _CAMELOT_MAJOR.get(note)
    return None


_VERSION_KEYWORDS = (
    r"extended mix|extended version|extended edit|extended|radio edit|radio mix|"
    r"club mix|club edit|original mix|vocal mix|dub mix|instrumental|acapella|"
    r"a cappella|remaster(?:ed)?(?:\s+\d{4})?|bootleg|mashup|mash-up|rework|"
    r"remix|flip|vip(?:\s+mix)?|edit|refix|intro(?:\s+clean)?|clean|dirty"
)
_BRACKETED = re.compile(
    r"[(\[]([^()\[\]]*?\b(?:%s)\b[^()\[\]]*?)[)\]]" % _VERSION_KEYWORDS, re.I
)
_TRAILING = re.compile(
    r"[-–—]\s*([^-–—]*?\b(?:%s)\b[^-–—]*?)\s*$" % _VERSION_KEYWORDS, re.I
)


def extract_version_label(title_or_filename: str | None) -> str | None:
    if not title_or_filename:
        return None
    base = re.sub(r"\.[a-z0-9]{2,5}$", "", title_or_filename, flags=re.I)
    m = _BRACKETED.search(base) or _TRAILING.search(base)
    if not m:
        return None
    label = re.sub(r"\s+", " ", m.group(1)).strip()
    return re.sub(r"\b\w", lambda c: c.group(0).upper(), label)


# ---------------------------------------------------------------------------
# UDM (SQLite in chiaro): apertura del file GIÀ creato/migrato da Node
# ---------------------------------------------------------------------------

def open_udm(udm_path: str) -> sqlite3.Connection:
    if not os.path.exists(udm_path):
        fail(
            f"UDM non trovato al percorso ricevuto: {udm_path}. "
            "Il file deve essere creato da Node prima dello spawn del sidecar."
        )
    conn = sqlite3.connect(udm_path, timeout=10)
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA foreign_keys = ON")
    # Verifica handshake: lo schema deve esistere (Node è l'owner, qui no DDL).
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tracks'"
    ).fetchone()
    if row is None:
        fail("Schema UDM assente: Node non ha eseguito le migrazioni.")
    return conn


def _now_local() -> str:
    """Timestamp in ora LOCALE per ingest_runs (started_at/finished_at), coerente
    col Registro operazioni lato Node: mostrare UTC confondeva l'utente (orari
    sfasati). Usato solo per la visualizzazione, non per confronti."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# ingest-masterdb
# ---------------------------------------------------------------------------

def cmd_ingest_masterdb(args: argparse.Namespace) -> None:
    try:
        from pyrekordbox import Rekordbox6Database  # import pigro: ~lento
    except ImportError as exc:
        fail(f"pyrekordbox non installato nel sidecar: {exc}")

    udm = open_udm(args.udm_path)

    try:
        if args.key:
            rb = Rekordbox6Database(path=args.master_db, key=args.key)
        else:
            rb = Rekordbox6Database(path=args.master_db)
    except Exception as exc:  # chiave non estraibile, file corrotto, versione nuova…
        fail(
            "Impossibile aprire master.db (chiave non disponibile o versione non "
            f"supportata): {exc}. Usa la modalità solo-XML."
        )

    run_id = udm.execute(
        "INSERT INTO ingest_runs (source, started_at, status) VALUES ('masterdb', ?, 'running')",
        (_now_local(),),
    ).lastrowid
    udm.commit()

    progress = ThrottledProgress("ingest-masterdb")
    inserted = 0
    try:
        contents = list(rb.get_content())
        total = len(contents)
        emit({"type": "log", "message": f"master.db aperto: {total} contenuti"})

        # Cue: bulk-fetch e raggruppa per ContentID (roadmap §7.1: prima
        # l'ingest master.db NON leggeva alcun cue — perdita totale e silenziosa).
        cues_by_content: dict[str, list] = {}
        try:
            for cue in rb.get_cue().all():
                cid = _get(cue, "ContentID")
                if cid is not None:
                    cues_by_content.setdefault(str(cid), []).append(cue)
        except Exception as exc:
            emit({"type": "log", "message": f"Cue non letti: {exc}"})
        cue_count = 0

        # Transazioni brevi (§2): commit a blocchi di 500.
        for i, c in enumerate(contents):
            row = _content_to_track(c)
            if row is None:
                continue
            udm.execute(
                """
                INSERT INTO tracks (source, source_id, title, artist, album, genre,
                                    year, bpm, musical_key, camelot, duration_s, path,
                                    filesize, version_label, has_tag_issues,
                                    needs_review, review_reason, gain_db, rating,
                                    track_color, beatgrid_bpm, beatgrid_anchor_ms,
                                    data)
                VALUES ('masterdb', :source_id, :title, :artist, :album, :genre,
                        :year, :bpm, :musical_key, :camelot, :duration_s, :path,
                        :filesize, :version_label, :has_tag_issues,
                        :needs_review, :review_reason, :gain_db, :rating,
                        :track_color, :beatgrid_bpm, :beatgrid_anchor_ms,
                        :data)
                ON CONFLICT(source, source_id) DO UPDATE SET
                    title=excluded.title, artist=excluded.artist,
                    album=excluded.album, genre=excluded.genre,
                    year=excluded.year, bpm=excluded.bpm,
                    musical_key=excluded.musical_key, camelot=excluded.camelot,
                    duration_s=excluded.duration_s, path=excluded.path,
                    filesize=excluded.filesize,
                    version_label=excluded.version_label,
                    has_tag_issues=excluded.has_tag_issues,
                    needs_review=excluded.needs_review,
                    review_reason=excluded.review_reason,
                    gain_db=excluded.gain_db, rating=excluded.rating,
                    track_color=excluded.track_color,
                    beatgrid_bpm=excluded.beatgrid_bpm,
                    beatgrid_anchor_ms=excluded.beatgrid_anchor_ms,
                    data=excluded.data
                """,
                row,
            )
            inserted += 1

            # Cue del brano appena inserito (rimpiazza i precedenti: idempotente).
            trow = udm.execute(
                "SELECT id FROM tracks WHERE source='masterdb' AND source_id=?",
                (row["source_id"],),
            ).fetchone()
            if trow is not None:
                tid = trow[0]
                udm.execute("DELETE FROM cues WHERE track_id=?", (tid,))
                for cue in cues_by_content.get(row["source_id"], []):
                    cr = _rb_cue_row(cue)
                    if cr is None:
                        continue
                    udm.execute(
                        "INSERT INTO cues (track_id, cue_type, cue_index, position_ms,"
                        " length_ms, color, label) VALUES (?,?,?,?,?,?,?)",
                        (tid, cr[0], cr[1], cr[2], cr[3], cr[4], cr[5]),
                    )
                    cue_count += 1

            if inserted % 500 == 0:
                udm.commit()
            progress.update(i + 1, total)
        udm.commit()
        emit({"type": "log", "message": f"Cue importati: {cue_count}"})

        _ingest_playlists(rb, udm)
        udm.commit()

        udm.execute(
            "UPDATE ingest_runs SET finished_at=?, status='ok', track_count=? WHERE id=?",
            (_now_local(), inserted, run_id),
        )
        udm.commit()
        progress.finish(total, total)
        emit({"type": "done", "data": {"tracks": inserted, "cues": cue_count}})
    except Exception as exc:
        udm.rollback()
        udm.execute(
            "UPDATE ingest_runs SET finished_at=?, status='error', error=? WHERE id=?",
            (_now_local(), str(exc), run_id),
        )
        udm.commit()
        fail(f"Errore durante l'ingestion: {exc}")
    finally:
        udm.close()


def _get(obj, *names):
    """Primo attributo non-None tra quelli indicati (schema pyrekordbox variabile)."""
    for n in names:
        try:
            v = getattr(obj, n)
        except Exception:
            continue
        if v is not None:
            return v
    return None


# Palette colore-traccia Rekordbox (DjmdColor.Commnt → RGB), per track_color.
_RB_TRACK_COLORS = {
    "Pink": "#FF69B4", "Red": "#FF0000", "Orange": "#FFA500",
    "Yellow": "#FFFF00", "Green": "#00CC00", "Aqua": "#00FFFF",
    "Blue": "#0000FF", "Purple": "#9900CC",
}

# Palette hot-cue di default Rekordbox (best-effort, roadmap §7.4): la maggior
# parte dei cue ha Color=-1 (nessun colore esplicito → la destinazione applica
# il proprio default). Mappiamo solo gli indici piccoli noti; -1 e 255 → None.
_RB_CUE_COLORS = {
    1: "#FF69B4", 2: "#FF0000", 3: "#FFA500", 4: "#FFFF00",
    5: "#00CC00", 6: "#00FFFF", 7: "#0000FF", 8: "#9900CC",
}


def _rb_cue_color(color):
    if color is None or color < 0 or color == 255:
        return None
    return _RB_CUE_COLORS.get(int(color))


def _rb_pad_index(kind):
    """Slot pad 0-based dal Kind Rekordbox, che NON è contiguo (roadmap §7.3):
    pad 1-3 = Kind 1,2,3; pad 4-8 = Kind 5,6,7,8,9 (Kind 4 riservato ai loop).
    Kind>=10 = cue auto oltre gli 8 pad → nessuno slot."""
    if kind is None or kind < 1:
        return None
    if kind <= 4:
        return kind - 1  # 1,2,3 hot -> 0,1,2 ; 4 loop -> pad 4 (idx 3)
    if kind <= 9:
        return kind - 2  # 5..9 -> 3..7 (pad 4..8)
    return None


def _rb_cue_row(cue):
    """Riga DjmdCue → tupla per la tabella cues dell'UDM (o None se non valida).
    Tipo: OutMsec≠-1 → loop; Kind=0 o ≥10 → memory; altrimenti hot."""
    inmsec = _get(cue, "InMsec")
    if inmsec is None or inmsec < 0:
        return None
    outmsec = _get(cue, "OutMsec")
    kind = _get(cue, "Kind") or 0
    if outmsec is not None and outmsec != -1:
        ctype, length, idx = "loop", float(outmsec - inmsec), _rb_pad_index(kind)
    elif kind == 0 or kind >= 10:
        ctype, length, idx = "memory", None, None
    else:
        ctype, length, idx = "hot", None, _rb_pad_index(kind)
    return (ctype, idx, float(inmsec), length, _rb_cue_color(_get(cue, "Color")), _get(cue, "Comment"))


def _content_to_track(c) -> dict | None:
    source_id = _get(c, "ID", "id")
    if source_id is None:
        return None

    # ⚠ Rekordbox ha un JOURNAL: `rb_local_usn` e' un numero di sequenza
    # monotono che cresce a ogni modifica. E' il segnale piu' ricco fra tutti i
    # software supportati, e permette al motore di sincronizzazione di chiedere
    # «cosa e' cambiato da quando ho guardato» invece di «in cosa differiscono
    # queste due librerie». Senza, ogni giro rilegge tutto.
    usn = _get(c, "rb_local_usn", "usn")
    updated_at = _get(c, "updated_at")
    title = _get(c, "Title")
    artist = _get(_get(c, "Artist"), "Name") or _get(c, "ArtistName")
    album = _get(_get(c, "Album"), "Name") or _get(c, "AlbumName")
    genre = _get(_get(c, "Genre"), "Name") or _get(c, "GenreName")
    key_name = _get(_get(c, "Key"), "ScaleName") or _get(c, "KeyName")
    bpm_raw = _get(c, "BPM")
    bpm = (bpm_raw / 100.0) if isinstance(bpm_raw, (int, float)) and bpm_raw > 400 else bpm_raw
    length = _get(c, "Length")  # secondi
    path = _get(c, "FolderPath")  # pyrekordbox: percorso file completo
    year = _get(c, "ReleaseYear", "Year")
    filesize = _get(c, "FileSize")

    missing_core = not title or not artist
    version = extract_version_label(title) or extract_version_label(
        os.path.basename(path) if path else None
    )
    # Metadati di performance (roadmap §7.5).
    color_name = _get(_get(c, "Color"), "Commnt", "Comment")
    track_color = _RB_TRACK_COLORS.get(color_name) if color_name else None
    rating_raw = _get(c, "Rating")
    rating = None
    if isinstance(rating_raw, (int, float)) and rating_raw > 0:
        # Rekordbox usa 0/51/102/153/204/255 (stelle×51); normalizza a 0-100.
        rating = round(rating_raw / 255 * 100) if rating_raw > 5 else round(rating_raw * 20)
    return {
        "source_id": str(source_id),
        "title": title,
        "artist": artist,
        "album": album,
        "genre": genre,
        "year": int(year) if year else None,
        "bpm": float(bpm) if bpm else None,
        "musical_key": key_name,
        "camelot": to_camelot(key_name),
        "duration_s": float(length) if length else None,
        "path": path,
        "filesize": int(filesize) if filesize else None,
        "version_label": version,
        "has_tag_issues": 1 if missing_core else 0,
        "needs_review": 0,
        "review_reason": None,
        "gain_db": None,
        "rating": rating,
        "track_color": track_color,
        "beatgrid_bpm": None,
        "beatgrid_anchor_ms": None,
        # Sacca dei campi non normalizzati, chiave 'rekordbox'. Ci va il
        # segnale di modifica: senza, il motore di sincronizzazione non puo'
        # essere incrementale. Solo valori davvero presenti — una chiave a
        # None sarebbe rumore che fa sembrare diverse due righe identiche.
        "data": json.dumps(
            {
                "rekordbox": {
                    k: v
                    for k, v in (
                        ("usn", int(usn) if isinstance(usn, (int, float)) else None),
                        ("updatedAt", str(updated_at) if updated_at else None),
                    )
                    if v is not None
                }
            }
        )
        if (usn is not None or updated_at is not None)
        else "{}",
    }


def _ingest_playlists(rb, udm: sqlite3.Connection) -> None:
    """Playlist + membership. Best-effort: se lo schema differisce, logga e salta."""
    try:
        playlists = list(rb.get_playlist())
    except Exception as exc:
        emit({"type": "log", "message": f"Playlist non lette: {exc}"})
        return

    id_map: dict[str, int] = {}
    for p in playlists:
        pid = _get(p, "ID", "id")
        name = _get(p, "Name")
        if pid is None or name is None:
            continue
        attr = _get(p, "Attribute")
        is_folder = 1 if attr == 1 else 0  # 0=playlist, 1=folder, 4=smartlist
        cur = udm.execute(
            """
            INSERT INTO playlists (source, source_id, name, is_folder, sort_order)
            VALUES ('masterdb', ?, ?, ?, ?)
            ON CONFLICT(source, source_id) DO UPDATE SET
                name=excluded.name, is_folder=excluded.is_folder,
                sort_order=excluded.sort_order
            """,
            (str(pid), str(name), is_folder, int(_get(p, "Seq") or 0)),
        )
        row = udm.execute(
            "SELECT id FROM playlists WHERE source='masterdb' AND source_id=?",
            (str(pid),),
        ).fetchone()
        id_map[str(pid)] = row[0] if row else cur.lastrowid

    # parent linking (secondo giro: i parent potrebbero venire dopo i figli)
    for p in playlists:
        pid, parent = _get(p, "ID", "id"), _get(p, "ParentID")
        if pid is None or parent in (None, "root", "0"):
            continue
        if str(parent) in id_map:
            udm.execute(
                "UPDATE playlists SET parent_id=? WHERE source='masterdb' AND source_id=?",
                (id_map[str(parent)], str(pid)),
            )

    # membership
    for p in playlists:
        pid = _get(p, "ID", "id")
        if pid is None or str(pid) not in id_map:
            continue
        try:
            songs = list(_get(p, "Songs") or [])
        except Exception:
            continue
        udm.execute("DELETE FROM playlist_tracks WHERE playlist_id=?", (id_map[str(pid)],))
        # position = indice progressivo, NON il TrackNo di Rekordbox: la PK di
        # playlist_tracks è (playlist_id, position), quindi due song con lo
        # stesso TrackNo (o senza) collasserebbero su una sola riga e i brani
        # verrebbero persi. L'ordine segue quello dei song (già ordinati da rb).
        for idx, song in enumerate(songs):
            content_id = _get(song, "ContentID")
            if content_id is None:
                continue
            row = udm.execute(
                "SELECT id FROM tracks WHERE source='masterdb' AND source_id=?",
                (str(content_id),),
            ).fetchone()
            if row:
                udm.execute(
                    """INSERT OR REPLACE INTO playlist_tracks
                       (playlist_id, track_id, position) VALUES (?, ?, ?)""",
                    (id_map[str(pid)], row[0], idx),
                )


# ---------------------------------------------------------------------------
# fingerprint (fpcalc / Chromaprint) — dedup e relocator Fase 2
# ---------------------------------------------------------------------------

def _fpcalc_binary() -> str:
    """Percorso di fpcalc. Ordine: env CRATEFORGE_FPCALC → binario incluso nel
    pacchetto (accanto all'eseguibile del sidecar, ce lo mette lo script di
    build) → PATH di sistema. Così l'utente non deve installare nulla a mano.
    """
    env = os.environ.get("CRATEFORGE_FPCALC")
    if env and os.path.exists(env):
        return env
    exe_name = "fpcalc.exe" if sys.platform == "win32" else "fpcalc"
    base = (
        os.path.dirname(sys.executable)
        if getattr(sys, "frozen", False)
        else os.path.dirname(os.path.abspath(__file__))
    )
    for candidate in (os.path.join(base, exe_name), os.path.join(base, "bin", exe_name)):
        if os.path.exists(candidate):
            return candidate
    return "fpcalc"  # fallback: PATH


def _run_fpcalc_raw(path: str) -> list[int] | None:
    """Fingerprint Chromaprint grezzo (lista di interi a 32 bit) o None."""
    try:
        out = subprocess.run(
            [_fpcalc_binary(), "-raw", "-json", path],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except FileNotFoundError:
        fail(
            "fpcalc (Chromaprint) non trovato: né incluso nel pacchetto né nel PATH. "
            "Reinstalla CrateForge o esegui di nuovo lo script di build del sidecar."
        )
    except subprocess.TimeoutExpired:
        return None
    if out.returncode != 0:
        return None
    try:
        fp = json.loads(out.stdout).get("fingerprint")
    except json.JSONDecodeError:
        return None
    return fp if isinstance(fp, list) and fp else None


def acoustic_id_from_raw(fp: list[int], segments: int = 4) -> str:
    """ID acustico robusto: simhash a 32 bit per segmento temporale.

    Il fingerprint grezzo cambia leggermente tra encoding diversi dello stesso
    brano; la maggioranza bit-per-bit (simhash) su ogni segmento assorbe le
    piccole differenze, così due encode dello stesso audio collassano quasi
    sempre sullo stesso ID. Sperimentale (§6 Fase 2): la UI lo dichiara.
    """
    n = len(fp)
    seg_len = max(1, n // segments)
    parts: list[str] = []
    for s in range(segments):
        chunk = fp[s * seg_len : (s + 1) * seg_len] or fp[-seg_len:]
        votes = [0] * 32
        for v in chunk:
            v &= 0xFFFFFFFF
            for b in range(32):
                votes[b] += 1 if (v >> b) & 1 else -1
        h = 0
        for b in range(32):
            if votes[b] > 0:
                h |= 1 << b
        parts.append(f"{h:08x}")
    return "".join(parts)


def cmd_fingerprint(args: argparse.Namespace) -> None:
    udm = open_udm(args.udm_path)
    fp = _run_fpcalc_raw(args.file)
    if fp is None:
        udm.close()
        fail(f"fpcalc non è riuscito a leggere il file: {args.file}")
    aid = acoustic_id_from_raw(fp)
    if args.track_id:
        udm.execute("UPDATE tracks SET acoustic_id=? WHERE id=?", (aid, int(args.track_id)))
        udm.commit()
    udm.close()
    emit({"type": "done", "data": {"acousticId": aid}})


def cmd_fingerprint_batch(args: argparse.Namespace) -> None:
    """acoustic_id per tutti i brani con file esistente e acoustic_id NULL."""
    udm = open_udm(args.udm_path)
    rows = udm.execute(
        "SELECT id, path FROM tracks WHERE path IS NOT NULL AND acoustic_id IS NULL"
    ).fetchall()
    todo = [(tid, p) for tid, p in rows if p and os.path.exists(p)]
    progress = ThrottledProgress("fingerprint")
    done_count, failed = 0, 0
    for i, (tid, path) in enumerate(todo):
        fp = _run_fpcalc_raw(path)
        if fp is None:
            failed += 1
        else:
            udm.execute(
                "UPDATE tracks SET acoustic_id=? WHERE id=?",
                (acoustic_id_from_raw(fp), tid),
            )
            done_count += 1
        if (i + 1) % 25 == 0:
            udm.commit()
        progress.update(i + 1, len(todo))
    udm.commit()
    progress.finish(len(todo), len(todo))
    udm.close()
    emit({
        "type": "done",
        "data": {"fingerprinted": done_count, "failed": failed, "skippedMissing": len(rows) - len(todo)},
    })


_AUDIO_EXT = (".mp3", ".m4a", ".aac", ".flac", ".wav", ".aiff", ".aif", ".ogg", ".opus", ".wma")


def cmd_match_fingerprints(args: argparse.Namespace) -> None:
    """Relocator per fingerprint (§6 Fase 2.3): ritrova i brani con path rotto
    fingerprintando i file nella nuova cartella e confrontando gli acoustic_id
    già salvati. Scrive i match in relocation_matches; Node genera l'XML.
    """
    udm = open_udm(args.udm_path)
    broken = [
        (tid, aid)
        for tid, path, aid in udm.execute(
            "SELECT id, path, acoustic_id FROM tracks "
            "WHERE acoustic_id IS NOT NULL AND path IS NOT NULL"
        ).fetchall()
        if not os.path.exists(path)
    ]
    if not broken:
        udm.close()
        emit({"type": "done", "data": {"broken": 0, "matched": 0, "scanned": 0}})
        return
    by_aid: dict[str, list[int]] = {}
    for tid, aid in broken:
        by_aid.setdefault(aid, []).append(tid)

    candidates = [
        os.path.join(root, f)
        for root, _dirs, files in os.walk(args.new_root)
        for f in files
        if f.lower().endswith(_AUDIO_EXT)
    ]
    progress = ThrottledProgress("relocate-fingerprint")
    matched = 0
    udm.execute("DELETE FROM relocation_matches WHERE method='fingerprint'")
    for i, cand in enumerate(candidates):
        fp = _run_fpcalc_raw(cand)
        if fp is not None:
            aid = acoustic_id_from_raw(fp)
            for tid in by_aid.get(aid, []):
                udm.execute(
                    "INSERT OR REPLACE INTO relocation_matches (track_id, new_path, method) "
                    "VALUES (?, ?, 'fingerprint')",
                    (tid, cand),
                )
                matched += 1
        if (i + 1) % 10 == 0:
            udm.commit()
        progress.update(i + 1, len(candidates))
    udm.commit()
    progress.finish(len(candidates), len(candidates))
    udm.close()
    emit({
        "type": "done",
        "data": {"broken": len(broken), "matched": matched, "scanned": len(candidates)},
    })


# ---------------------------------------------------------------------------
# analyze-cues (Fase 2.1, sperimentale) — richiede librerie AI opzionali
# ---------------------------------------------------------------------------

def _snap_to_beat(t: float, beats: list[float]) -> float:
    """Porta `t` sul battito rilevato più vicino.

    Un hot cue fuori battito non serve a un DJ: premuto a tempo, parte in
    anticipo o in ritardo sul colpo e "sbava". Si sposta solo se il battito
    più vicino dista meno di mezzo intervallo fra battiti, cioè se è davvero
    quello giusto; senza battiti, o con battiti troppo radi, `t` resta com'è.
    """
    if len(beats) < 2:
        return t
    import bisect

    i = bisect.bisect_left(beats, t)
    candidati = [b for b in (beats[i - 1] if i > 0 else None, beats[i] if i < len(beats) else None) if b is not None]
    vicino = min(candidati, key=lambda b: abs(b - t))
    # Intervallo locale fra battiti: quello attorno al battito scelto.
    j = beats.index(vicino)
    passo = beats[j + 1] - beats[j] if j + 1 < len(beats) else beats[j] - beats[j - 1]
    return vicino if abs(vicino - t) <= passo / 2 else t


def cmd_analyze_cues(args: argparse.Namespace) -> None:
    """Propone fino a 8 cue. Ordine di preferenza dei backend:
    aubio (onset/beat) → fallback errore pulito se nessuna libreria AI.
    Output: pochi KB via evento done (mai bulk data).
    """
    try:
        import aubio  # type: ignore
        import numpy as np  # type: ignore
    except ImportError:
        fail(
            "Librerie AI non installate in questo sidecar. Installa il livello AI: "
            "pip install -r requirements-ai.txt (vedi README). "
            "Le altre funzioni restano disponibili."
        )
        return

    path = args.file
    if not os.path.exists(path):
        fail(f"File non trovato: {path}")

    # File corrotti/formati non supportati sollevano RuntimeError in aubio: va
    # convertito in un evento JSON error, non un traceback su stderr (che Node
    # non sa interpretare).
    try:
        hop = 512
        src = aubio.source(path, 0, hop)
        sr = src.samplerate
        onset = aubio.onset("energy", 1024, hop, sr)
        tempo = aubio.tempo("default", 1024, hop, sr)

        onsets_s: list[float] = []
        # Istanti dei battiti rilevati: servono ad allineare i cue proposti.
        beats_s: list[float] = []
        energies: list[float] = []
        total_frames = 0
        while True:
            samples, read = src()
            if onset(samples):
                onsets_s.append(onset.get_last_s())
            if tempo(samples):
                beats_s.append(tempo.get_last_s())
            energies.append(float(np.sqrt(np.mean(samples**2))))
            total_frames += read
            if read < hop:
                break
        duration = total_frames / sr if sr else 0.0
        bpm = float(tempo.get_bpm()) or None
    except Exception as exc:  # noqa: BLE001
        fail(f"Analisi audio non riuscita ({os.path.basename(path)}): {str(exc)[:200]}")
        return

    # Profilo d'energia a finestre da ~1s → intro/drop/breakdown/outro euristici.
    win = max(1, int(sr / hop))
    profile = [
        float(sum(energies[i : i + win]) / win) for i in range(0, len(energies), win)
    ]
    peak = max(profile) if profile else 0.0
    cues: list[dict] = []

    def add(label: str, t: float, color: str) -> None:
        # ⚠ Il drop si cerca su finestre di un secondo e l'outro si mette a
        # durata - 32 s: entrambi cadevano su istanti arbitrari, non su un
        # battito. Ora si allineano al battito più vicino.
        t = _snap_to_beat(t, beats_s)
        if 0 <= t < duration and len(cues) < 8:
            cues.append({"label": label, "positionMs": round(t * 1000), "color": color})

    # Tinte della palette dei cue (design system §5.1): desaturate, distinguibili
    # anche in scala di grigi. Le tinte sature di prima erano fuori scala rispetto
    # a tutto il resto dell'interfaccia e sparavano dal fondo scuro.
    add("Intro", onsets_s[0] if onsets_s else 0.0, "#6C9BC9")
    # Drop: primo salto sostenuto sopra l'80% del picco
    for i, e in enumerate(profile):
        if e >= 0.8 * peak and i > 4:
            add("Drop", float(i), "#E8912E")
            break
    # Breakdown: primo crollo sotto il 30% del picco dopo il drop
    drop_i = next((i for i, e in enumerate(profile) if e >= 0.8 * peak and i > 4), None)
    if drop_i is not None:
        for i in range(drop_i + 4, len(profile)):
            if profile[i] <= 0.3 * peak:
                add("Breakdown", float(i), "#8F8AC4")
                break
    add("Outro", max(0.0, duration - 32.0), "#7FA8A0")

    # Envelope normalizzata per la waveform UI: max 480 bucket (pochi KB,
    # coerente con "mai bulk data su IPC" — non sono campioni audio).
    envelope: list[float] = []
    if profile and peak > 0:
        n = min(480, len(profile))
        step = len(profile) / n
        for i in range(n):
            lo = int(i * step)
            hi = max(lo + 1, int((i + 1) * step))
            envelope.append(round(max(profile[lo:hi]) / peak, 3))

    emit({
        "type": "done",
        "data": {
            "durationS": round(duration, 2),
            "bpm": round(bpm, 2) if bpm else None,
            "cues": cues,
            "envelope": envelope,
            "backend": "aubio-energy",
            "beatAligned": len(beats_s) >= 2,
        },
    })


# ---------------------------------------------------------------------------
# write-tags — scrittura ID3 sugli ORIGINALI (opt-in, backup+hash+rollback §3.4)
# ---------------------------------------------------------------------------

def _sha256(path: str) -> str:
    import hashlib

    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _backup_manifest_append(backup_dir: str, entry: dict) -> None:
    """Registra nel manifest della cartella di backup da DOVE viene ogni copia.

    Senza questo file la cartella e' una pila di copie con nome appiattito
    (`0007_Intro.mp3`): il contenuto e' salvo ma nessuno — nemmeno chi ha
    scritto il programma — sa piu' in quale cartella andava rimesso. Il
    manifest si scrive PRIMA della scrittura, e in modalita' append, cosi'
    sopravvive anche a un'interruzione a meta' lavoro.
    """
    path = os.path.join(backup_dir, "crateforge-backup.json")
    try:
        data = {"kind": "audio", "files": []}
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        data.setdefault("files", []).append(entry)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
    except Exception:
        # Un manifest che non si scrive non deve impedire il backup: la copia
        # verificata resta la protezione principale.
        pass


def cmd_write_tags(args: argparse.Namespace) -> None:
    """Scrive tag sui file originali. Per OGNI file:
    1. hash dell'originale; 2. copia di backup + verifica hash; 3. scrittura
    mutagen; 4. riapertura di verifica; 5. su qualsiasi errore: ripristino del
    backup + verifica hash del ripristino. Il backup resta comunque su disco.
    """
    try:
        import mutagen
    except ImportError:
        fail("mutagen non disponibile nel sidecar: rebuild richiesto.")
        return
    import shutil

    try:
        jobs = _load_json_payload(args.tags_json, getattr(args, "tags_file", None))
        assert isinstance(jobs, list)
    except (json.JSONDecodeError, AssertionError, OSError):
        fail("--tags-json non valido: atteso un array [{path, tags{}}].")
        return
    os.makedirs(args.backup_dir, exist_ok=True)

    # Mappa campi UDM → chiavi EasyID3/VorbisComment di mutagen (easy=True).
    field_map = {"title": "title", "artist": "artist", "album": "album",
                 "genre": "genre", "year": "date", "bpm": "bpm"}

    progress = ThrottledProgress("write-tags")
    results: list[dict] = []
    for i, job in enumerate(jobs):
        path = job.get("path")
        tags = job.get("tags") or {}
        entry = {"path": path, "ok": False, "rolledBack": False, "error": None}
        backup = None
        try:
            if not path or not os.path.exists(path):
                raise FileNotFoundError("file non trovato")
            src_hash = _sha256(path)
            backup = os.path.join(args.backup_dir, f"{i:04d}_{os.path.basename(path)}")
            shutil.copy2(path, backup)
            if _sha256(backup) != src_hash:
                raise IOError("verifica hash del backup fallita")
            _backup_manifest_append(
                args.backup_dir,
                {"from": path, "to": backup, "sha256": src_hash, "at": _now_local()},
            )

            audio = mutagen.File(path, easy=True)
            if audio is None:
                raise ValueError("formato non supportato da mutagen")
            for field, value in tags.items():
                key = field_map.get(field)
                if key is not None and value is not None:
                    audio[key] = [str(value)]
            audio.save()
            # Riapertura di verifica: il file deve restare leggibile.
            if mutagen.File(path) is None:
                raise IOError("il file non è più leggibile dopo la scrittura")
            entry["ok"] = True
        except Exception as exc:  # rollback a prova di bomba
            entry["error"] = str(exc)[:300]
            if backup and os.path.exists(backup):
                try:
                    shutil.copy2(backup, path)
                    entry["rolledBack"] = _sha256(path) == _sha256(backup)
                except Exception:
                    entry["rolledBack"] = False
        results.append(entry)
        progress.update(i + 1, len(jobs))
    progress.finish(len(jobs), len(jobs))
    ok = sum(1 for r in results if r["ok"])
    emit({
        "type": "done",
        "data": {
            "written": ok,
            "failed": len(results) - ok,
            "backupDir": args.backup_dir,
            "results": results[:100],
        },
    })


# ---------------------------------------------------------------------------
# read-history — cronologia riproduzioni dal master.db (per il report SIAE)
# ---------------------------------------------------------------------------

def cmd_read_history(args: argparse.Namespace) -> None:
    """Legge le sessioni della cronologia di Rekordbox (DjmdHistory +
    DjmdSongHistory) dal master.db e le scrive nella tabella play_history
    dell'UDM. Sola lettura sul master.db; rimpiazza la cronologia precedente.
    """
    try:
        from pyrekordbox import Rekordbox6Database
    except ImportError:
        fail("pyrekordbox non disponibile nel sidecar: rebuild richiesto.")
        return
    try:
        # Come per ingest-masterdb: senza --key pyrekordbox auto-rileva la
        # chiave. Passare key="" romperebbe l'auto-detect.
        if args.key:
            rb = Rekordbox6Database(path=args.master_db, key=args.key)
        else:
            rb = Rekordbox6Database(path=args.master_db)
    except Exception as exc:
        fail(f"Apertura del master.db non riuscita: {str(exc)[:300]}")
        return

    udm = open_udm(args.udm_path)
    udm.execute("DELETE FROM play_history")
    sessions = 0
    rows = 0
    try:
        for hist in rb.get_history():
            sessions += 1
            sid = str(_get(hist, "ID", "id") or sessions)
            sname = _get(hist, "Name")
            sdate = _get(hist, "DateCreated", "created_at")
            songs = list(_get(hist, "Songs") or [])
            for idx, sh in enumerate(songs):
                content = _get(sh, "Content")
                t = _content_to_track(content) if content is not None else None
                if t is None:
                    continue
                isrc = _get(content, "ISRC")
                label = _get(_get(content, "Label"), "Name") or _get(content, "LabelName")
                # Ora del singolo brano: in DjmdSongHistory `created_at` e'
                # il momento in cui il brano e' entrato nella cronologia, cioe'
                # quando e' stato suonato. Serve per la fascia oraria del
                # programma musicale (21:00 -> 06:00 del giorno dopo): senza,
                # l'unica data e' quella della sessione intera. Se manca resta
                # None, e chi legge la tratta come "non lo so".
                played = _get(sh, "created_at", "DateCreated")
                udm.execute(
                    """INSERT INTO play_history
                       (session_id, session_name, session_date, position, title, artist,
                        album, genre, year, bpm, musical_key, duration_s, isrc, label, path,
                        played_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        sid, sname, str(sdate) if sdate is not None else None, idx,
                        t["title"], t["artist"], t["album"], t["genre"], t["year"],
                        t["bpm"], t["musical_key"], t["duration_s"], isrc, label, t["path"],
                        str(played) if played is not None else None,
                    ),
                )
                rows += 1
        udm.commit()
    except Exception as exc:  # noqa: BLE001
        udm.close()
        rb.close()
        fail(f"Lettura della cronologia non riuscita: {str(exc)[:300]}")
        return
    udm.close()
    rb.close()
    emit({"type": "done", "data": {"sessions": sessions, "rows": rows}})


# ---------------------------------------------------------------------------
# masterdb-create-playlist — scrittura DIRETTA nel master.db (opt-in massimo)
# ---------------------------------------------------------------------------

def cmd_masterdb_create_playlist(args: argparse.Namespace) -> None:
    """Crea una playlist nel master.db e vi aggiunge i brani indicati.

    Scrittura documentata e supportata da pyrekordbox: create_playlist +
    add_to_playlist + commit(autoinc=True), che aggiorna correttamente l'USN
    (update sequence number) — il meccanismo con cui Rekordbox rileva le
    modifiche. La ri-cifratura SQLCipher è gestita dalla libreria.

    Precondizioni (verificate a monte da Node/UI, ribadite qui):
      - Rekordbox DEVE essere chiuso (scrittura concorrente = corruzione);
      - il backup di master.db+options.json è già stato fatto da Node (§3.2).
    """
    try:
        from pyrekordbox import Rekordbox6Database
    except ImportError:
        fail("pyrekordbox non disponibile nel sidecar: rebuild richiesto.")
        return

    try:
        content_ids = _load_json_payload(args.content_ids_json, getattr(args, "content_ids_file", None))
        assert isinstance(content_ids, list)
    except (json.JSONDecodeError, AssertionError, OSError):
        fail("--content-ids-json non valido: atteso un array di ID contenuto.")
        return

    db_dir = os.path.dirname(os.path.abspath(args.master_db))
    try:
        # key esplicita se fornita (chiave SQLCipher documentata), altrimenti
        # pyrekordbox la cerca nella cache locale / la deriva.
        db = Rekordbox6Database(path=args.master_db, key=args.key or "")
    except Exception as exc:
        fail(
            "Apertura del master.db in scrittura non riuscita: "
            f"{str(exc)[:300]}. Se la chiave non è disponibile, prova prima "
            "'Scarica chiave di lettura' nelle Impostazioni."
        )
        return

    progress = ThrottledProgress("masterdb-playlist")
    added, missing = 0, 0
    try:
        playlist = db.create_playlist(args.playlist_name)
        for i, cid in enumerate(content_ids):
            content = db.get_content(ID=str(cid))
            # get_content può ritornare una query: normalizza al primo record
            record = content.first() if hasattr(content, "first") else content
            if record is None:
                missing += 1
            else:
                db.add_to_playlist(playlist, record)
                added += 1
            progress.update(i + 1, len(content_ids))
        db.commit()  # autoinc=True di default: aggiorna l'USN
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        db.close()
        fail(f"Scrittura nel master.db non riuscita (nessuna modifica salvata): {str(exc)[:300]}")
        return
    progress.finish(len(content_ids), len(content_ids))
    db.close()
    emit({
        "type": "done",
        "data": {"playlist": args.playlist_name, "added": added, "missing": missing, "dbDir": db_dir},
    })


# ---------------------------------------------------------------------------
# masterdb-write-metadata — scrittura DIRETTA dei metadati brano (opt-in massimo)
# ---------------------------------------------------------------------------

def cmd_masterdb_write_metadata(args: argparse.Namespace) -> None:
    """Aggiorna sul posto i metadati di brani esistenti nel master.db.

    Stesso patto di `masterdb-create-playlist`: pyrekordbox apre il database
    cifrato in scrittura, le mutazioni passano dall'ORM e `commit()` (autoinc)
    aggiorna l'USN, che è il meccanismo con cui Rekordbox rileva le modifiche
    al prossimo avvio. Ogni campo è facoltativo: `None` significa «non toccare».

    Campi supportati e dove vivono nel master.db (verificati su libreria reale
    Rekordbox 7.2.18):
      - title   → DjmdContent.Title
      - artist  → DjmdContent.ArtistID (riga DjmdArtist, cercata per nome,
                  creata se assente — come fa Rekordbox);
      - album   → DjmdContent.AlbumID (come artist);
      - genre   → DjmdContent.GenreID (riga DjmdGenre per nome);
      - year    → DjmdContent.ReleaseYear (intero);
      - bpm     → DjmdContent.BPM (intero, CENTESIMI di BPM: 12300 = 123.00);
      - key     → DjmdContent.KeyID (ID della riga DjmdKey con ScaleName
                  uguale, notazione «Am»/«Bbm»; il valore deve già esistere in
                  tabella: Rekordbox non crea tasti nuovi da fuori);
      - rating  → DjmdContent.Rating (stelle 0-5; Node normalizza da 0-100);
      - color   → DjmdContent.ColorID (ID della riga DjmdColor il cui nome
                  corrisponde al colore della palette rekordbox).

    Precondizioni (verificate a monte da Node/UI, ribadite qui):
      - Rekordbox DEVE essere chiuso;
      - il backup di master.db+options.json è già stato fatto da Node (§3.2).
    """
    try:
        from pyrekordbox import Rekordbox6Database
    except ImportError:
        fail("pyrekordbox non disponibile nel sidecar: rebuild richiesto.")
        return

    try:
        rows = _load_json_payload(args.tracks_json, getattr(args, "tracks_file", None))
        assert isinstance(rows, list)
    except (json.JSONDecodeError, AssertionError, OSError):
        fail("--tracks-file non valido: atteso un array di brani.")
        return

    try:
        db = Rekordbox6Database(path=args.master_db, key=args.key or "")
    except Exception as exc:
        fail(
            "Apertura del master.db in scrittura non riuscita: "
            f"{str(exc)[:300]}. Se la chiave non è disponibile, prova prima "
            "'Scarica chiave di lettura' nelle Impostazioni."
        )
        return

    # Indici nome→ID letti UNA volta: 142 contenuti significano 142 lookup
    # per tabella altrimenti. La notazione dei tasti è «Am»/«Bbm» (ScaleName),
    # la stessa che gira nell'UDM e nei crate Serato: nessuna conversione.
    try:
        key_id_by_name = {k.ScaleName: k.ID for k in db.get_key().all()}
        # Stessa tonalità, grafia diversa: si cerca per Camelot fra i tasti
        # che Rekordbox ha GIÀ. Un tasto assente non si crea da fuori.
        key_id_by_camelot = {}
        for _name, _kid in key_id_by_name.items():
            _cam = to_camelot(_name)
            if _cam and _cam not in key_id_by_camelot:
                key_id_by_camelot[_cam] = _kid
        color_id_by_name = {c.Commnt: c.ID for c in db.get_color().all()}
    except Exception as exc:
        db.close()
        fail(f"Lettura delle tabelle tasti/colori non riuscita: {str(exc)[:200]}")
        return
    color_name_by_hex = {v.upper(): k for k, v in _RB_TRACK_COLORS.items()}

    progress = ThrottledProgress("masterdb-metadata")
    updated, missing = 0, 0
    skipped_fields: dict[str, int] = {}

    def note_skip(field: str) -> None:
        skipped_fields[field] = skipped_fields.get(field, 0) + 1

    try:
        for i, row in enumerate(rows):
            cid = str(row.get("id") or "")
            content = db.get_content(ID=cid)
            record = content.first() if hasattr(content, "first") else content
            if record is None:
                missing += 1
                progress.update(i + 1, len(rows))
                continue

            title = row.get("title")
            if title is not None and title != record.Title:
                record.Title = title

            artist = row.get("artist")
            if artist:
                a = db.get_artist(Name=artist).first()
                if a is None:
                    try:
                        a = db.add_artist(artist)
                    except Exception:
                        a = None
                        note_skip("artist")
                if a is not None and str(record.ArtistID) != str(a.ID):
                    record.ArtistID = str(a.ID)

            album = row.get("album")
            if album:
                al = db.get_album(Name=album).first()
                if al is None:
                    try:
                        al = db.add_album(album)
                    except Exception:
                        al = None
                        note_skip("album")
                if al is not None and str(record.AlbumID) != str(al.ID):
                    record.AlbumID = str(al.ID)

            genre = row.get("genre")
            if genre:
                g = db.get_genre(Name=genre).first()
                if g is None:
                    try:
                        g = db.add_genre(genre)
                    except Exception:
                        g = None
                        note_skip("genre")
                if g is not None and str(record.GenreID) != str(g.ID):
                    record.GenreID = str(g.ID)

            year = row.get("year")
            if year is not None and record.ReleaseYear != int(year):
                record.ReleaseYear = int(year)

            bpm = row.get("bpm")
            if bpm is not None:
                # Il master.db conserva i BPM in centesimi (12300 = 123.00 BPM).
                cents = int(round(float(bpm) * 100))
                if record.BPM != cents:
                    record.BPM = cents

            key = row.get("musicalKey")
            cam = row.get("camelot") or to_camelot(key)
            if key or cam:
                kid = key_id_by_name.get(key) if key else None
                if kid is None and cam:
                    kid = key_id_by_camelot.get(cam)
                if kid is None:
                    note_skip("musicalKey")
                elif str(record.KeyID) != str(kid):
                    record.KeyID = str(kid)

            rating = row.get("rating")
            if rating is not None:
                # 0-100 normalizzato → stelle 0-5 del master.db.
                record.Rating = max(0, min(5, int(round(int(rating) / 20))))

            color = row.get("color")
            if color:
                name = color_name_by_hex.get(str(color).upper(), "")
                col_id = color_id_by_name.get(name)
                if col_id is None:
                    note_skip("color")
                else:
                    record.ColorID = str(col_id)

            updated += 1
            progress.update(i + 1, len(rows))

        db.commit()  # autoinc=True di default: aggiorna l'USN
    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        db.close()
        fail(f"Scrittura dei metadati non riuscita (nessuna modifica salvata): {str(exc)[:300]}")
        return
    progress.finish(len(rows), len(rows))
    db.close()
    emit({
        "type": "done",
        "data": {"updated": updated, "missing": missing, "skippedFields": skipped_fields},
    })


# download-key — fallback chiave Rekordbox (§4.3, Esperto, in-app)
# ---------------------------------------------------------------------------

def _key_cached() -> bool:
    """True se la chiave di decrittazione Rekordbox è già in cache pyrekordbox.
    La cache è un file di testo con la riga 'dp: 402fd…' (la chiave valida inizia
    sempre con 402fd)."""
    try:
        from pyrekordbox.config import get_cache_file
        cache = str(get_cache_file())
        if not os.path.exists(cache):
            return False
        with open(cache, encoding="utf-8") as fh:
            return "402fd" in fh.read()
    except Exception:
        return False


def _download_and_cache_key() -> None:
    """Scarica la chiave nota da fonti pubbliche del progetto e la salva in cache.
    In pyrekordbox 0.4.x le funzioni sono `download_db6_key` (in
    pyrekordbox.__main__) e `write_db6_key_cache` — con il '6': i vecchi nomi
    `download_db_key`/`write_db_key_cache` NON esistono, per questo la feature
    risultava "non esposta". download_db6_key scarica E scrive già la cache.
    La funzione stampa su stdout ('Looking for key…'): la silenziamo per non
    sporcare il protocollo JSON-per-riga verso Node."""
    import contextlib
    import io
    try:
        from pyrekordbox.__main__ import download_db6_key  # type: ignore
    except ImportError:
        try:
            from pyrekordbox import download_db6_key  # type: ignore  # eventuale alias futuro
        except ImportError:
            raise RuntimeError(
                "Questa versione di pyrekordbox non espone il download della chiave."
            )
    with contextlib.redirect_stdout(io.StringIO()):
        download_db6_key()


def cmd_download_key(args: argparse.Namespace) -> None:
    """Scarica la chiave di decrittazione nota del master.db tramite
    pyrekordbox (la recupera da fonti pubbliche del progetto). Nessun dato
    dell'utente viene inviato. Dopo, l'ingest diretto può funzionare anche
    dove l'estrazione locale della chiave fallisce (Rekordbox >= 6.6.5).
    """
    try:
        _download_and_cache_key()
    except Exception as exc:
        fail(f"Download della chiave non riuscito: {str(exc)[:300]}")
        return
    emit({"type": "done", "data": {"keyCached": True}})


# ---------------------------------------------------------------------------
# Serato (roadmap §7.8) — libreria "database V2" + crate + cue nei tag GEOB.
# I cue/loop Serato NON stanno nel database ma nei frame ID3 GEOB
# "Serato Markers2" dei file audio (base64, layout binario documentato).
# READER SPERIMENTALE: sola lettura, opt-in. Posizioni cue in MILLISECONDI.
# Non validato su libreria reale (nessuna disponibile in sviluppo): il parser
# GEOB è coperto da test sintetico.
# ---------------------------------------------------------------------------


def _serato_fields(data: bytes, offset: int = 0, end: int | None = None):
    """Itera i campi Serato: tag ASCII 4 char + uint32 BE lunghezza + payload."""
    if end is None:
        end = len(data)
    i = offset
    while i + 8 <= end:
        import struct as _s
        tag = data[i : i + 4].decode("ascii", "replace")
        ln = _s.unpack(">I", data[i + 4 : i + 8])[0]
        yield tag, data[i + 8 : i + 8 + ln]
        i += 8 + ln


def _serato_text(payload: bytes) -> str | None:
    try:
        return payload.decode("utf-16-be").rstrip("\x00") or None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Tipizzazione dei campi TLV: la regola sta nella PRIMA LETTERA del codice
# ---------------------------------------------------------------------------
#
# Serato non ha una tabella "tag → tipo". Il parser guarda `code[0]`:
#
#   t, p  → stringa UTF-16BE (p è un percorso, ma il codec è lo stesso)
#   s     → uint16 big-endian
#   b     → uint8
#   u     → uint32 big-endian senza segno
#   altro → uint32 big-endian
#
# Da qui si deriva il tipo di QUALUNQUE campo, anche di uno mai incontrato.
# Prima di questa funzione ogni payload veniva decodificato come UTF-16BE:
# corretto per i campi di testo che leggiamo (`tsng`, `tart`, `pfil`…), ma
# `ufsb` (flag) o `tsiz` sarebbero diventati stringhe di caratteri arbitrari.
# Serve per il round-trip: un campo che non sappiamo interpretare va comunque
# riscritto identico, e per riscriverlo bisogna sapere che cos'è.
#
# ⚠ Un buffer più corto del tipo NON è un errore: si restituisce 0. È il
# comportamento osservato, e i file `_Serato_` si corrompono davvero (rimozione
# a caldo di una chiavetta). Sollevare qui renderebbe illeggibile un database
# che Serato apre senza fiatare.

_SERATO_INT_WIDTH = {"s": 2, "b": 1, "u": 4}


def _serato_value(tag: str, payload: bytes):
    """Valore tipizzato di un campo TLV, dalla prima lettera del four-char code."""
    first = tag[:1]
    if first in ("t", "p"):
        return _serato_text(payload)
    width = _SERATO_INT_WIDTH.get(first, 4)
    if len(payload) < width:
        return 0
    return int.from_bytes(payload[:width], "big")


def _serato_encode_value(tag: str, value) -> bytes:
    """Payload di un campo TLV, con lo stesso criterio della lettura.

    ⚠ Asimmetria voluta rispetto a `_serato_value`: in lettura `u` cade nel ramo
    di default (uint32 come tutti gli altri), in scrittura ha un ramo proprio che
    satura a 0 i valori negativi. È così nel formato: un `u` negativo non esiste.
    """
    first = tag[:1]
    if first in ("t", "p"):
        return str(value or "").encode("utf-16-be")
    width = _SERATO_INT_WIDTH.get(first, 4)
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = 0
    if first == "u":
        n = max(0, n)
    n = max(0, min(n, (1 << (8 * width)) - 1))
    return n.to_bytes(width, "big")


def parse_serato_markers2(geob_data: bytes):
    """GEOB 'Serato Markers2' → lista tuple (type,index,posMs,lenMs,color,label).
    Formato: 2 byte versione + base64 (con newline) del corpo; il corpo ha entry
    [nome-tipo null-terminated][uint32 BE len][payload]. CUE e LOOP in ms."""
    import base64
    import struct as _s

    try:
        # 2 byte versione + base64 (newline ogni 72 char) + null di padding.
        # La base64 va presa FINO al primo null e TRONCATA all'ultimo gruppo
        # completo di 4: Serato lascia un gruppo parziale finale (verificato su
        # file reali) che romperebbe il decode se lo si tenta di completare.
        b64 = geob_data[2:].replace(b"\n", b"").split(b"\x00")[0]
        b64 = b64[: len(b64) - (len(b64) % 4)]
        body = base64.b64decode(b64)
    except Exception:
        return []
    cues = []
    i = 2  # salta 01 01 iniziale del corpo
    n = len(body)
    while i < n:
        j = body.find(b"\x00", i)
        if j < 0:
            break
        name = body[i:j].decode("ascii", "replace")
        i = j + 1
        if i + 4 > n:
            break
        ln = _s.unpack(">I", body[i : i + 4])[0]
        i += 4
        payload = body[i : i + ln]
        i += ln
        if name == "CUE" and len(payload) >= 12:
            idx = payload[1]
            pos = _s.unpack(">I", payload[2:6])[0]
            rgb = payload[7:10]
            label = payload[12:].split(b"\x00")[0].decode("utf-8", "replace") or None
            color = "#%02X%02X%02X" % (rgb[0], rgb[1], rgb[2]) if len(rgb) == 3 else None
            cues.append(("hot", idx, float(pos), None, color, label))
        elif name == "LOOP" and len(payload) >= 20:
            # Layout documentato: [0]=00,[1]=index,[2:6]=start,[6:10]=end,
            # [10:14]=FFFFFFFF,[14]=00,[15:18]=color,[18]=00,[19]=locked,[20:]=name.
            idx = payload[1]
            start = _s.unpack(">I", payload[2:6])[0]
            endp = _s.unpack(">I", payload[6:10])[0]
            rgb = payload[15:18]
            color = "#%02X%02X%02X" % (rgb[0], rgb[1], rgb[2]) if len(rgb) == 3 else None
            label = payload[20:].split(b"\x00")[0].decode("utf-8", "replace") or None
            cues.append(("loop", idx, float(start), float(endp - start), color, label))
    return cues


def _serato_volume_root(serato_dir: str) -> str:
    """I path nei crate/db Serato sono relativi alla root del volume.
    macOS: drive esterno /Volumes/USB/… → '/Volumes/USB'; volume di boot → ''
    (i rel diventano assoluti con il solo prefisso '/'). Windows: la root è il
    drive della cartella _Serato_ (es. 'D:'), senza il quale i rel tipo
    'Users/x/Music/a.mp3' produrrebbero path rotti '/Users/…'."""
    m = re.match(r"^(/Volumes/[^/]+)/", serato_dir)
    if m:
        return m.group(1)
    m = re.match(r"^([A-Za-z]:)", serato_dir)
    if m:
        return m.group(1)
    return ""


_SERATO_AUDIO_EXT = (".mp3", ".aiff", ".aif", ".wav", ".flac", ".m4a")


_SERATO_B64_ALPHABET = frozenset(
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
)

# Nome del campo "Serato Markers2" per contenitore. In ID3 è un frame GEOB con
# quella descrizione; negli altri contenitori Serato usa un campo testuale che
# porta lo stesso contenuto avvolto in un secondo strato base64.
_SERATO_MARKERS2_KEYS = {
    "flac": ("serato_markers_v2",),
    "ogg": ("serato_markers2",),
    "mp4": ("----:com.serato.dj:markersv2",),
}


def _serato_unwrap_container(raw: bytes, frame_name: bytes = b"Serato Markers2") -> bytes | None:
    """Toglie lo strato esterno che Serato usa fuori da ID3.

    Il valore è base64 di: `application/octet-stream` + NUL + NUL + nome del
    frame + NUL + lo STESSO contenuto che in ID3 sta dentro il GEOB. La
    decodifica è tollerante come quella di Serato: si scartano i caratteri fuori
    dall'alfabeto (gli a capo ogni 72 caratteri, per esempio) e un resto di 1
    carattere su 4 si completa con `A==`. Nella variante MP4 il padding `=` è
    sostituito da `A`, che decodifica in byte nulli in coda: innocui, perché il
    contenuto interno si chiude con un NUL comunque.

    ⚠ NON verificato su file reali: sulla macchina di collaudo non esiste
    nessun FLAC o M4A taggato da Serato (614 MP3 e 32 WAV sì, tutti in ID3). La
    forma viene dalla specifica del formato. Se fosse sbagliata il risultato è
    `None` o un contenuto che il parser delle entry non riconosce — cioè nessun
    cue, mai cue inventati: il parser pretende nome, lunghezza e payload
    coerenti.
    """
    import base64

    filtered = bytes(c for c in raw if c in _SERATO_B64_ALPHABET or c == ord("="))
    filtered = filtered.rstrip(b"=")
    resto = len(filtered) % 4
    if resto == 1:
        filtered += b"A=="
    elif resto:
        filtered += b"=" * (4 - resto)
    try:
        decoded = base64.b64decode(filtered)
    except Exception:
        return None
    marker = frame_name + b"\x00"
    if marker not in decoded:
        return None
    return decoded.split(marker)[-1]


def _serato_container_kind(audio) -> str:
    """'id3' | 'flac' | 'ogg' | 'mp4' | 'unknown' — dal tipo dei tag mutagen."""
    tags = getattr(audio, "tags", None)
    nome = type(tags).__name__ if tags is not None else ""
    if nome in ("ID3", "_WaveID3", "_IFFID3") or hasattr(tags, "getall"):
        return "id3"
    if nome == "MP4Tags":
        return "mp4"
    if nome == "VCFLACDict":
        return "flac"
    if nome in ("VCommentDict", "OggVCommentDict") or nome.endswith("VComment"):
        return "ogg"
    return "unknown"


def _serato_markers2_data(tags, kind: str) -> bytes | None:
    """Il contenuto "Serato Markers2" nella forma GEOB, qualunque sia il contenitore."""
    if not tags:
        return None
    if kind == "id3":
        for gk in tags.keys():
            if str(gk).startswith("GEOB") and getattr(tags[gk], "desc", "") == "Serato Markers2":
                return bytes(tags[gk].data)
        return None
    chiavi = _SERATO_MARKERS2_KEYS.get(kind, ())
    for k in list(tags.keys()):
        if str(k).lower() not in chiavi:
            continue
        v = tags[k]
        v = v[0] if isinstance(v, list) and v else v
        raw = bytes(v) if isinstance(v, (bytes, bytearray)) else str(v).encode("ascii", "ignore")
        return _serato_unwrap_container(raw)
    return None


def _serato_has_markers(tags, kind: str = "id3") -> bool:
    return _serato_markers2_data(tags, kind) is not None


def _serato_tlen_seconds(tlen: str | None) -> float | None:
    """`tlen` del database V2 ("mm:ss.cc") in secondi. Solo ripiego: è arrotondato."""
    if not tlen:
        return None
    m = re.match(r"^\s*(\d+):(\d{1,2})(?:\.(\d+))?\s*$", tlen)
    if not m:
        return None
    if int(m.group(2)) >= 60:
        return None
    frac = float("0." + m.group(3)) if m.group(3) else 0.0
    return int(m.group(1)) * 60 + int(m.group(2)) + frac


def _serato_import_one(udm, MutagenFile, abs_path, source_id, meta) -> int:
    """Inserisce/aggiorna un brano Serato e ne legge i cue GEOB. Ritorna il
    numero di cue importati. `meta['_tags']` (se presente) evita di riaprire il
    file quando i tag sono già stati letti dallo scan."""
    title, artist, key_name = meta.get("title"), meta.get("artist"), meta.get("key")

    # ⚠ Durata e dimensione si leggono dal FILE, non dal database V2. Prima non
    # si leggevano affatto: su una libreria reale tutte le 114 tracce Serato
    # entravano senza, e la regola d'identità che unisce lo stesso file visto da
    # software diversi (nome + durata + dimensione) non poteva scattare per
    # nessuna. Il database V2 ha `tlen` e `tsiz`, ma come testo arrotondato
    # ("02:34.12", "8.2MB"): il file è la fonte esatta, e `tlen` resta come
    # ripiego quando il file non è raggiungibile.
    audio = meta.get("_audio")
    if audio is None:
        try:
            audio = MutagenFile(abs_path)
        except Exception:
            audio = None
        meta["_audio"] = audio
    duration_s = None
    try:
        length = getattr(getattr(audio, "info", None), "length", None)
        duration_s = float(length) if length and length > 0 else None
    except Exception:
        duration_s = None
    if duration_s is None:
        duration_s = _serato_tlen_seconds(meta.get("tlen"))
    try:
        filesize = os.path.getsize(abs_path)
    except OSError:
        filesize = None

    udm.execute(
        """INSERT INTO tracks (source, source_id, title, artist, album, genre,
               bpm, musical_key, camelot, path, duration_s, filesize,
               has_tag_issues, needs_review)
           VALUES ('serato', :sid, :title, :artist, :album, :genre, :bpm, :key,
               :camelot, :path, :duration, :filesize, :issue, 0)
           ON CONFLICT(source, source_id) DO UPDATE SET
               title=excluded.title, artist=excluded.artist, album=excluded.album,
               genre=excluded.genre, bpm=excluded.bpm, musical_key=excluded.musical_key,
               camelot=excluded.camelot, path=excluded.path,
               duration_s=COALESCE(excluded.duration_s, tracks.duration_s),
               filesize=COALESCE(excluded.filesize, tracks.filesize)""",
        {
            "sid": source_id, "title": title, "artist": artist,
            "album": meta.get("album"), "genre": meta.get("genre"),
            "bpm": meta.get("bpm"), "key": key_name, "camelot": to_camelot(key_name),
            "path": abs_path, "duration": duration_s, "filesize": filesize,
            "issue": 1 if (not title or not artist) else 0,
        },
    )
    trow = udm.execute(
        "SELECT id FROM tracks WHERE source='serato' AND source_id=?", (source_id,)
    ).fetchone()
    if not trow:
        return 0
    tid = trow[0]
    udm.execute("DELETE FROM cues WHERE track_id=?", (tid,))
    n = 0
    # ⚠ I cue Serato non stanno solo nel GEOB di ID3. In FLAC, OGG e M4A stanno
    # in un campo testuale con un nome diverso, e prima venivano ignorati in
    # silenzio: il brano entrava senza cue e niente lo segnalava.
    audio = meta.get("_audio")
    tags = meta.get("_tags")
    if audio is None:
        try:
            audio = MutagenFile(abs_path)
        except Exception:
            audio = None
    if tags is None:
        tags = getattr(audio, "tags", None)
    kind = _serato_container_kind(audio) if audio is not None else "id3"
    data = _serato_markers2_data(tags, kind)
    for c in parse_serato_markers2(data) if data else []:
        udm.execute(
            "INSERT INTO cues (track_id, cue_type, cue_index, position_ms,"
            " length_ms, color, label) VALUES (?,?,?,?,?,?,?)",
            (tid, c[0], c[1], c[2], c[3], c[4], c[5]),
        )
        n += 1
    return n


def _serato_split_entries(body: bytes) -> list[tuple[str, bytes]]:
    """Corpo decodificato di 'Serato Markers2' → [(nome_entry, payload)].

    Conserva TUTTE le entry, comprese quelle che non sappiamo interpretare
    (COLOR, BPMLOCK, FLIP, e qualunque cosa Serato aggiunga in futuro): è ciò
    che rende sicura la riscrittura, perché quello che non capiamo lo
    rimettiamo identico invece di buttarlo.
    """
    import struct as _s

    out: list[tuple[str, bytes]] = []
    i = 2  # i primi 2 byte sono la versione del corpo (01 01)
    n = len(body)
    while i < n:
        j = body.find(b"\x00", i)
        if j < 0:
            break
        name = body[i:j].decode("latin-1")
        if j + 5 > n:
            break
        ln = _s.unpack(">I", body[j + 5 - 4 : j + 5])[0]
        payload = body[j + 5 : j + 5 + ln]
        if len(payload) < ln:  # troncato: meglio fermarsi che inventare
            break
        out.append((name, payload))
        i = j + 5 + ln
    # Byte non consumati = struttura che non conosciamo. Chi riscrive DEVE
    # accorgersene: restituiamo anche quanto abbiamo letto davvero.
    _serato_split_entries.last_consumed = i  # type: ignore[attr-defined]
    return out


def _serato_build_markers2(version: bytes, entries: list[tuple[str, bytes]], total_size: int | None) -> bytes:
    """Ricostruisce il GEOB 'Serato Markers2' completo di envelope.

    Struttura verificata byte-per-byte su un file taggato da Serato reale
    (round-trip identico): 2 byte versione + base64 del corpo, con il PADDING
    '=' mantenuto e una newline ogni 72 caratteri, poi NUL fino alla fine del
    frame. Se `total_size` è noto e sufficiente, replichiamo la dimensione
    originale del frame (Serato lascia una coda di NUL); altrimenti chiudiamo
    con un solo NUL.
    """
    import base64
    import struct as _s

    body = version + b"".join(
        name.encode("latin-1") + b"\x00" + _s.pack(">I", len(payload)) + payload
        for name, payload in entries
    )
    enc = base64.b64encode(body)  # il padding '=' va CONSERVATO
    lines = [enc[i : i + 72] for i in range(0, len(enc), 72)]
    b64 = b"\n".join(lines)
    head = version[:2] if len(version) >= 2 else b"\x01\x01"
    if total_size is not None and total_size >= len(head) + len(b64) + 1:
        return head + b64 + b"\x00" * (total_size - len(head) - len(b64))
    return head + b64 + b"\x00"


def _serato_cue_entry(index: int, position_ms: int, color: str | None, label: str | None) -> bytes:
    """Entry CUE nel formato Serato (13 byte + eventuale etichetta).

    Layout verificato sui dati reali:
      [0]=00, [1]=index, [2:6]=posizione uint32 BE in ms, [6]=00,
      [7:10]=colore RGB, [10:12]=00 00, [12:]=nome NUL-terminated.
    """
    import struct as _s

    rgb = b"\x00\x00\x00"
    if color and len(color) == 7 and color[0] == "#":
        try:
            rgb = bytes.fromhex(color[1:])
        except ValueError:
            rgb = b"\x00\x00\x00"
    name = (label or "").encode("utf-8")
    return (
        b"\x00"
        + bytes([index & 0xFF])
        + _s.pack(">I", max(0, int(position_ms)))
        + b"\x00"
        + rgb
        + b"\x00\x00"
        + name
        + b"\x00"
    )


def _serato_loop_entry(index: int, start_ms: int, end_ms: int, color: str | None, label: str | None) -> bytes:
    """Entry LOOP nel formato Serato (21 byte + eventuale etichetta).

    Layout verificato su loop creati a mano in Serato:
      [0]=00, [1]=index, [2:6]=inizio uint32 BE (ms), [6:10]=fine uint32 BE,
      [10:14]=FF FF FF FF (costante), [14]=00, [15:18]=colore RGB, [18]=00,
      [19]=loop bloccato (0/1), [20:]=nome NUL-terminated.

    Nota: nei dati reali il colore dei loop è sempre lo stesso (#27AAE1) —
    Serato usa un colore unico per i loop e non lo rende configurabile — ma lo
    scriviamo comunque da quello del pivot, così un colore esplicito non va
    perso se in futuro Serato lo supporta.
    """
    import struct as _s

    rgb = b"\x27\xaa\xe1"  # colore loop di Serato, osservato su tutti i loop reali
    if color and len(color) == 7 and color[0] == "#":
        try:
            rgb = bytes.fromhex(color[1:])
        except ValueError:
            pass
    name = (label or "").encode("utf-8")
    return (
        b"\x00"
        + bytes([index & 0xFF])
        + _s.pack(">I", max(0, int(start_ms)))
        + _s.pack(">I", max(0, int(end_ms)))
        + b"\xff\xff\xff\xff"
        + b"\x00"
        + rgb
        + b"\x00"
        + b"\x00"  # loop non bloccato
        + name
        + b"\x00"
    )


def _serato_field(tag: str, payload: bytes) -> bytes:
    """Campo Serato: [tag 4 char ASCII][uint32 BE lunghezza][payload]."""
    import struct as _s

    return tag.encode("ascii") + _s.pack(">I", len(payload)) + payload


_CRATE_ORDER_FILENAME = "neworder.pref"
_ORDER_BEGIN = "[begin record]"
_ORDER_CRATE = "[crate]"
_ORDER_END = "[end record]"


def _u16(s: str) -> bytes:
    return s.encode("utf-16-be")


def _serato_crate_order_add(serato_dir: str, names: list[str], backup_dir: str | None = None) -> dict:
    """Registra dei crate in `neworder.pref`, l'ordine dell'albero di Serato.

    ⚠ Senza questo passaggio un crate scritto ESISTE come file ma non compare
    nell'albero di Serato: il file d'ordine è la lista di ciò che Serato mostra.
    È la ragione per cui l'export dei crate, finora, sembrava non funzionare.

    Il formato NON è TLV: sono righe separate da `\\n`, con i marcatori
    `[begin record]`, `[crate]`, `[end record]` codificati in UTF-16BE e
    terminati da un byte nullo.

    ⚠ Aggiornamento INCREMENTALE e basta: si legge il file esistente, si tolgono
    le righe dei crate che stiamo per registrare (per non duplicarle) e si
    reinseriscono PRIMA di `[end record]`. Tutto il resto resta byte per byte
    com'era — compresi eventuali marcatori che non conosciamo.

    Se `neworder.pref` non esiste NON viene creato: il file governa cosa Serato
    mostra, e generarne uno da zero significherebbe dichiarare noi quale sia
    l'intero albero dell'utente sulla base di un formato dedotto. Si segnala e
    si lascia fare a Serato, che lo ricrea da sé.
    """
    path = os.path.join(serato_dir, _CRATE_ORDER_FILENAME)
    if not os.path.exists(path):
        return {"updated": False, "reason": "missing", "added": 0}

    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError as exc:
        return {"updated": False, "reason": f"unreadable: {exc}", "added": 0}

    # Copia verificata per hash PRIMA di toccare l'originale: se il confronto
    # non torna, non si scrive affatto. Stessa regola dei tag audio.
    if backup_dir:
        try:
            os.makedirs(backup_dir, exist_ok=True)
            copy = os.path.join(backup_dir, _CRATE_ORDER_FILENAME)
            with open(copy, "wb") as f:
                f.write(raw)
                f.flush()
                os.fsync(f.fileno())
            if _sha256(copy) != _sha256(path):
                return {"updated": False, "reason": "backup mismatch", "added": 0}
            _backup_manifest_append(
                backup_dir, {"original": path, "backup": copy, "sha256": _sha256(path)}
            )
        except OSError as exc:
            return {"updated": False, "reason": f"backup failed: {exc}", "added": 0}

    # Righe: il separatore è un LF *grezzo* (0x0A), non un LF in UTF-16.
    lines = raw.split(b"\n")

    crate_prefix = _u16(_ORDER_CRATE)
    end_marker = _u16(_ORDER_END)

    def is_crate_named(line: bytes, name: str) -> bool:
        # ⚠ Confronto ESATTO, non `rstrip(b"\x00")`. In UTF-16BE metà dei byte
        # sono nulli: un nome che finisce con un carattere tipo U+0100 termina
        # davvero con 0x00, e uno strip avido se lo mangerebbe facendo fallire
        # il riconoscimento — con il risultato di duplicare la riga invece di
        # sostituirla.
        if not line.startswith(crate_prefix):
            return False
        body = line[len(crate_prefix):]
        target = _u16(name)
        return body == target or body == target + b"\x00"

    wanted = [n for n in names if n]
    kept = [ln for ln in lines if not any(is_crate_named(ln, n) for n in wanted)]

    new_lines = [crate_prefix + _u16(n) + b"\x00" for n in wanted]

    end_at = next((i for i, ln in enumerate(kept) if ln.startswith(end_marker)), None)
    if end_at is None:
        # Nessun [end record]: si accoda in fondo, saltando l'eventuale riga
        # vuota finale prodotta dallo split.
        tail = 1 if kept and kept[-1] == b"" else 0
        at = len(kept) - tail
        out = kept[:at] + new_lines + kept[at:]
    else:
        out = kept[:end_at] + new_lines + kept[end_at:]

    tmp = path + ".cfnew"
    try:
        with open(tmp, "wb") as f:
            f.write(b"\n".join(out))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except OSError as exc:
        try:
            os.remove(tmp)
        except OSError:
            pass
        return {"updated": False, "reason": f"unwritable: {exc}", "added": 0}

    return {"updated": True, "reason": None, "added": len(new_lines)}


def cmd_write_serato_crates(args: argparse.Namespace) -> None:
    """Scrive i crate (playlist) di Serato in Subcrates/*.crate.

    Formato dedotto dal reader già validato: sequenza di campi
    [tag][uint32 BE lunghezza][payload], con `vrsn` (versione, UTF-16-BE) e un
    `otrk` per brano contenente `ptrk` = percorso relativo al volume.

    ONESTÀ: a differenza dei cue, questo formato NON è stato verificato con un
    round-trip byte-identico su un crate scritto da Serato, perché nella
    libreria di riferimento non ne esiste nessuno. Per questo NON sovrascrive
    mai un crate esistente: se il file c'è già, lo salta e lo segnala.
    """
    try:
        jobs = _load_json_payload(args.crates_json, getattr(args, "crates_file", None))
        assert isinstance(jobs, list)
    except (json.JSONDecodeError, AssertionError, OSError):
        fail("--crates-json non valido: atteso un array [{name, paths:[...]}].")
        return

    serato_dir = args.serato_dir
    if not os.path.isdir(serato_dir):
        fail(f"Cartella _Serato_ non trovata: {serato_dir}")
        return
    sub = os.path.join(serato_dir, "Subcrates")
    os.makedirs(sub, exist_ok=True)

    # I path nei crate sono relativi alla radice del volume che contiene
    # _Serato_ (stessa regola usata in lettura).
    vol = _serato_volume_root(serato_dir)

    written = 0
    skipped: list[str] = []
    results = []
    for job in jobs:
        name = (job.get("name") or "").strip()
        paths = job.get("paths") or []
        if not name or not paths:
            continue
        # ⚠ `%` NON va sanitizzato: `%%` è il separatore di livello dei crate
        # annidati, ed è ciò che rende `Genere%%House.crate` un figlio invece
        # che un crate con un nome strano. Il chiamante ha già sostituito i `%`
        # che facevano parte dei nomi originali (vedi adapters/serato/crateNames).
        # `/` e `\` restano vietati: creerebbero sottocartelle, che Serato non usa.
        safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)[:120]
        target = os.path.join(sub, f"{safe}.crate")
        if os.path.exists(target):
            # Mai sovrascrivere un crate dell'utente: il formato non è
            # verificato byte-per-byte e la perdita sarebbe silenziosa.
            skipped.append(name)
            continue

        blob = _serato_field("vrsn", "1.0/Serato ScratchLive Crate".encode("utf-16-be"))
        for p in paths:
            rel = p.replace("\\", "/")
            if vol and rel.lower().startswith(vol.lower().replace("\\", "/")):
                rel = rel[len(vol):].lstrip("/")
            elif re.match(r"^[A-Za-z]:", rel):
                rel = rel[2:].lstrip("/")  # via il drive: il crate è volume-relativo
            blob += _serato_field("otrk", _serato_field("ptrk", rel.encode("utf-16-be")))
        try:
            with open(target, "wb") as f:
                f.write(blob)
            written += 1
            results.append({"name": name, "file": target, "tracks": len(paths)})
        except OSError as exc:
            skipped.append(f"{name} ({exc})")

    # I crate appena scritti vanno registrati nell'albero, altrimenti esistono
    # come file e Serato non li mostra. Solo quelli davvero scritti: annunciare
    # nell'ordine un crate saltato lo farebbe comparire vuoto.
    order = _serato_crate_order_add(
        serato_dir,
        [r["name"] for r in results],
        getattr(args, "backup_dir", None),
    )
    if not order["updated"] and results:
        emit({
            "type": "log",
            "message": (
                "neworder.pref non aggiornato (%s): i crate sono stati scritti ma "
                "potrebbero non comparire nell'albero finché Serato non li rilegge."
                % order["reason"]
            ),
        })

    emit({
        "type": "done",
        "data": {
            "written": written,
            "skipped": skipped,
            "crates": results[:100],
            "order": order,
        },
    })


_DB_V2_FILENAME = "database V2"
_DB_V2_VERSION = "2.0/Serato Scratch LIVE Database"

# ⚠ Campi ESCLUSI dal confronto fra il record esistente e quello nuovo.
# Serato li ricalcola da sé a ogni scansione: se entrassero nel paragone
# risulterebbero sempre diversi, e ogni sincronizzazione riscriverebbe l'intero
# database senza che sia cambiato nulla.
_DB_V2_VOLATILE = ("ufsb", "tlen", "tsiz")

# Campi che sappiamo produrre. Tutto ciò che non è in questa lista, dentro un
# record esistente, viene lasciato dov'è e com'è.
_DB_V2_WRITABLE = {
    "title": "tsng",
    "artist": "tart",
    "album": "talb",
    "genre": "tgen",
    "key": "tkey",
    "bpm": "tbpm",
}


def _serato_db_relpath(abs_path: str, vol: str) -> str:
    """Percorso come lo scrive Serato: relativo alla radice del volume."""
    rel = abs_path.replace("\\", "/")
    if vol and rel.lower().startswith(vol.lower().replace("\\", "/")):
        rel = rel[len(vol):]
    elif re.match(r"^[A-Za-z]:", rel):
        rel = rel[2:]
    return rel.lstrip("/")


def _serato_merge_otrk(original: bytes, updates: dict) -> bytes:
    """Fonde i valori nuovi dentro un record `otrk` esistente.

    ⚠ Fusione a livello di CAMPO, non sostituzione del record. Un `otrk` reale
    contiene decine di campi che questo progetto non interpreta — flag, indici,
    date, dati di analisi. Ricostruire il record dai soli campi noti li
    cancellerebbe tutti, e Serato non se ne lamenterebbe: si limiterebbe a
    perdere il lavoro dell'utente.

    L'ordine dei campi originali è preservato: i campi nuovi si sostituiscono al
    loro posto, quelli mai visti si accodano.
    """
    out = b""
    seen: set[str] = set()
    for tag, payload in _serato_fields(original):
        if tag in updates:
            seen.add(tag)
            out += _serato_field(tag, _serato_encode_value(tag, updates[tag]))
        else:
            out += _serato_field(tag, payload)
    for tag, value in updates.items():
        if tag not in seen:
            out += _serato_field(tag, _serato_encode_value(tag, value))
    return out


def _serato_otrk_equivalent(original: bytes, merged: bytes) -> bool:
    """I due record dicono la stessa cosa, ignorando i campi che Serato ricalcola."""
    def stable(blob: bytes) -> list[tuple[str, bytes]]:
        return [(t, p) for t, p in _serato_fields(blob) if t not in _DB_V2_VOLATILE]

    return stable(original) == stable(merged)


def cmd_write_serato_database(args: argparse.Namespace) -> None:
    """Aggiorna `database V2` conservando tutto ciò che non stiamo scrivendo.

    ⚠ La regola che rende sicura questa operazione: NON si rigenera il file. Si
    legge quello esistente, si sostituiscono soltanto i record dei brani che
    conosciamo, e si riscrive tutto il resto identico — intestazione compresa,
    presa dal file originale invece che ricostruita.

    Rigenerare `database V2` dall'archivio interno cancellerebbe ogni brano che
    l'archivio non conosce. Su una libreria Serato costruita in anni, sarebbe la
    perdita più grossa che questo programma possa causare.

    Sicurezza, per file: copia verificata per hash → scrittura su file
    temporaneo → fsync → sostituzione atomica. Se qualcosa va storto prima della
    sostituzione, l'originale non è mai stato toccato.
    """
    try:
        jobs = _load_json_payload(args.tracks_json, getattr(args, "tracks_file", None))
        assert isinstance(jobs, list)
    except (json.JSONDecodeError, AssertionError, OSError):
        fail("--tracks-json non valido: atteso un array [{path, title, artist, …}].")
        return

    serato_dir = args.serato_dir
    db_path = os.path.join(serato_dir, _DB_V2_FILENAME)
    if not os.path.isfile(db_path):
        fail(f"'{_DB_V2_FILENAME}' non trovato in {serato_dir}: non c'è una libreria da aggiornare.")
        return

    vol = _serato_volume_root(serato_dir)

    # Indice dei valori nuovi per percorso relativo, che è la chiave d'identità
    # dentro il database (campo `pfil`).
    wanted: dict[str, dict] = {}
    for job in jobs:
        p = job.get("path")
        if not p:
            continue
        updates = {}
        for key, tag in _DB_V2_WRITABLE.items():
            if job.get(key) is not None:
                updates[tag] = job[key]
        if updates:
            wanted[_serato_db_relpath(p, vol).lower()] = updates

    with open(db_path, "rb") as f:
        raw = f.read()

    # Copia verificata PRIMA di qualunque scrittura.
    backup_dir = getattr(args, "backup_dir", None)
    backup_path = None
    if backup_dir:
        try:
            os.makedirs(backup_dir, exist_ok=True)
            backup_path = os.path.join(backup_dir, _DB_V2_FILENAME)
            with open(backup_path, "wb") as f:
                f.write(raw)
                f.flush()
                os.fsync(f.fileno())
            if _sha256(backup_path) != _sha256(db_path):
                fail("Copia di sicurezza non verificata: nessuna scrittura eseguita.")
                return
            _backup_manifest_append(
                backup_dir,
                {"original": db_path, "backup": backup_path, "sha256": _sha256(db_path)},
            )
        except OSError as exc:
            fail(f"Copia di sicurezza non riuscita ({exc}): nessuna scrittura eseguita.")
            return

    out = b""
    updated = 0
    unchanged = 0
    preserved = 0
    matched: set[str] = set()

    for tag, payload in _serato_fields(raw):
        if tag != "otrk":
            # Intestazione e qualunque altro contenitore: identici.
            out += _serato_field(tag, payload)
            preserved += 1
            continue

        fld = {t: p for t, p in _serato_fields(payload)}
        rel = _serato_value("pfil", fld["pfil"]) if "pfil" in fld else None
        key = (rel or "").replace("\\", "/").lower()
        updates = wanted.get(key)
        if not updates:
            out += _serato_field(tag, payload)
            preserved += 1
            continue

        matched.add(key)
        merged = _serato_merge_otrk(payload, updates)
        if _serato_otrk_equivalent(payload, merged):
            # Nulla di sostanziale è cambiato: si riscrive l'originale byte per
            # byte, così il file non cambia affatto dove non doveva cambiare.
            out += _serato_field(tag, payload)
            unchanged += 1
        else:
            out += _serato_field(tag, merged)
            updated += 1

    # ⚠ I brani non presenti nel database NON vengono aggiunti qui: un `otrk`
    # completo richiede campi che non sappiamo produrre (flag, durata, chiave di
    # ordinamento). Serato li aggiunge da sé quando incontra il file. Aggiungerne
    # di monchi significherebbe righe che si vedono ma non funzionano.
    not_in_db = sorted(set(wanted) - matched)

    tmp = db_path + ".cfnew"
    try:
        with open(tmp, "wb") as f:
            f.write(out)
            f.flush()
            os.fsync(f.fileno())
        # Rilettura di verifica prima di sostituire l'originale: il file nuovo
        # deve ri-analizzarsi e contenere ESATTAMENTE gli stessi record di
        # partenza. Questo comando aggiorna, non aggiunge e non toglie: un
        # conteggio diverso significa che il codec ha sbagliato una lunghezza, e
        # allora l'originale non si tocca.
        with open(tmp, "rb") as f:
            check = f.read()
        prima = sum(1 for t, _ in _serato_fields(raw) if t == "otrk")
        dopo = sum(1 for t, _ in _serato_fields(check) if t == "otrk")
        if dopo != prima:
            raise OSError(f"verifica fallita: {prima} record prima, {dopo} dopo")
        os.replace(tmp, db_path)
    except OSError as exc:
        try:
            os.remove(tmp)
        except OSError:
            pass
        fail(f"Scrittura non riuscita ({exc}): l'originale non è stato modificato.")
        return

    emit({
        "type": "done",
        "data": {
            "updated": updated,
            "unchanged": unchanged,
            "preserved": preserved,
            "notInDatabase": len(not_in_db),
            "backupDir": backup_dir,
        },
    })


def cmd_write_serato_cues(args: argparse.Namespace) -> None:
    """Scrive gli hot cue nei tag GEOB 'Serato Markers2' dei file audio.

    Sicurezza (§3.4), per OGNI file: hash dell'originale → backup verificato
    con hash → scrittura → riapertura di verifica → in caso di qualunque
    errore, ripristino dal backup e verifica dell'hash ripristinato.

    Le entry che non sappiamo interpretare (COLOR traccia, BPMLOCK, FLIP…)
    vengono RIMESSE IDENTICHE: sostituiamo solo CUE e LOOP. Senza questa
    accortezza un writer "inverso del reader" cancellerebbe dati che il
    reader ignora.
    """
    try:
        import mutagen
        from mutagen.id3 import GEOB
    except ImportError:
        fail("mutagen non disponibile nel sidecar: rebuild richiesto.")
        return
    import shutil

    try:
        jobs = _load_json_payload(args.cues_json, getattr(args, "cues_file", None))
        assert isinstance(jobs, list)
    except (json.JSONDecodeError, AssertionError, OSError):
        fail("--cues-json non valido: atteso un array [{path, cues:[{index,positionMs,color,label}]}].")
        return
    os.makedirs(args.backup_dir, exist_ok=True)

    progress = ThrottledProgress("write-serato")
    results: list[dict] = []
    for i, job in enumerate(jobs):
        path = job.get("path")
        cues = job.get("cues") or []
        loops = job.get("loops") or []
        entry = {
            "path": path, "ok": False, "rolledBack": False, "cues": 0,
            "preserved": 0, "skippedPads": 0, "legacyV1": False, "error": None,
        }
        backup = None
        try:
            if not path or not os.path.exists(path):
                raise FileNotFoundError("file non trovato")
            # ⚠ Fuori da ID3 (FLAC, OGG, M4A) Serato usa un campo diverso con un
            # secondo strato base64, la cui forma NON è verificata su file reali.
            # Prima si arrivava fino a `tags.add(GEOB)`, che su quei contenitori
            # non esiste: eccezione e rollback, con un messaggio che non diceva
            # perché. Ora ci si ferma qui, prima di toccare il file.
            _probe = mutagen.File(path)
            if _probe is not None and _serato_container_kind(_probe) != "id3":
                raise ValueError(
                    "cue Serato in FLAC/OGG/M4A: formato non verificato su file reali, "
                    "scrittura non eseguita (supportati MP3, AIFF, WAV)"
                )
            src_hash = _sha256(path)
            backup = os.path.join(args.backup_dir, f"{i:04d}_{os.path.basename(path)}")
            shutil.copy2(path, backup)
            if _sha256(backup) != src_hash:
                raise IOError("verifica hash del backup fallita")
            _backup_manifest_append(
                args.backup_dir,
                {"from": path, "to": backup, "sha256": src_hash, "at": _now_local()},
            )

            audio = mutagen.File(path)
            if audio is None or not hasattr(audio, "tags") or audio.tags is None:
                raise ValueError("il file non ha tag ID3 leggibili")

            # Entry esistenti: le conserviamo tutte tranne CUE/LOOP, che
            # sostituiamo con quelle richieste.
            old_key = None
            version = b"\x01\x01"
            total_size = None
            preserved: list[tuple[str, bytes]] = []
            for k in list(audio.tags.keys()):
                fr = audio.tags[k]
                if str(k).startswith("GEOB") and getattr(fr, "desc", "") == "Serato Markers2":
                    old_key = k
                    raw = bytes(fr.data)
                    total_size = len(raw)
                    version = raw[:2]
                    b64 = raw[2:].replace(b"\n", b"").split(b"\x00")[0]
                    b64 += b"=" * (-len(b64) % 4)
                    try:
                        import base64 as _b64
                        body = _b64.b64decode(b64)
                        parsed = _serato_split_entries(body)
                    except Exception:
                        # GEOB illeggibile: non lo sovrascriviamo alla cieca.
                        raise ValueError("GEOB 'Serato Markers2' esistente non decodificabile")
                    # Se restano byte che non abbiamo saputo leggere, il blob ha
                    # una struttura che non conosciamo (versione futura di
                    # Serato): riscriverlo cancellerebbe quei dati. Meglio
                    # fermarsi che perdere informazioni dell'utente.
                    consumed = getattr(_serato_split_entries, "last_consumed", len(body))
                    if consumed < len(body):
                        raise ValueError(
                            f"il GEOB contiene {len(body) - consumed} byte non riconosciuti "
                            "(versione di Serato più recente): scrittura annullata per non perderli"
                        )
                    # Conserviamo TUTTO tranne ciò che stiamo riscrivendo: i CUE
                    # sempre, i LOOP solo se ne abbiamo di nuovi da scrivere —
                    # altrimenti restano quelli dell'utente, perché cancellarli
                    # sarebbe una perdita muta.
                    replacing = {"CUE"} | ({"LOOP"} if loops else set())
                    for name, payload in parsed:
                        if name not in replacing:
                            preserved.append((name, payload))
                    break

            # Ordine osservato nei file scritti da Serato: COLOR, poi i CUE
            # per indice crescente, poi il resto (LOOP, BPMLOCK, FLIP…).
            new_entries: list[tuple[str, bytes]] = []
            for name, payload in preserved:
                if name == "COLOR":
                    new_entries.append((name, payload))
            skipped_pads = 0
            for c in sorted(cues, key=lambda x: x.get("index") or 0):
                idx = c.get("index")
                if idx is None or int(idx) < 0 or int(idx) > 7:
                    skipped_pads += 1  # Serato ha 8 pad: oltre non è scrivibile
                    continue
                new_entries.append(
                    ("CUE", _serato_cue_entry(int(idx), c.get("positionMs") or 0, c.get("color"), c.get("label")))
                )
            # I LOOP vanno dopo i CUE, come nei file scritti da Serato.
            for l in sorted(loops, key=lambda x: x.get("index") or 0):
                idx = l.get("index")
                if idx is None or int(idx) < 0 or int(idx) > 7:
                    skipped_pads += 1
                    continue
                start = int(l.get("startMs") or 0)
                end = int(l.get("endMs") or 0)
                if end <= start:
                    continue  # loop senza durata: non rappresentabile
                new_entries.append(
                    ("LOOP", _serato_loop_entry(int(idx), start, end, l.get("color"), l.get("label")))
                )
            for name, payload in preserved:
                if name != "COLOR":
                    new_entries.append((name, payload))
            entry["skippedPads"] = skipped_pads
            entry["loops"] = len([e for e in new_entries if e[0] == "LOOP"])

            blob = _serato_build_markers2(version, new_entries, total_size)
            if old_key is not None:
                del audio.tags[old_key]
            audio.tags.add(GEOB(encoding=0, mime="application/octet-stream", desc="Serato Markers2", data=blob))
            audio.save()

            # Riapertura di verifica: il file deve restare leggibile E i cue
            # devono rileggersi con lo stesso parser che usa l'import.
            check = mutagen.File(path)
            if check is None:
                raise IOError("il file non è più leggibile dopo la scrittura")
            reread = 0
            for k in list(getattr(check, "tags", {}) or {}):
                fr = check.tags[k]
                if str(k).startswith("GEOB") and getattr(fr, "desc", "") == "Serato Markers2":
                    reread = len(parse_serato_markers2(bytes(fr.data)))
            if reread < len([c for c in cues if c.get("index") is not None and 0 <= int(c["index"]) <= 7]):
                raise IOError(f"verifica fallita: riletti {reread} cue")
            entry["ok"] = True
            entry["cues"] = reread
            entry["preserved"] = len(preserved)
            # 'Serato Markers_' è il formato v1 legacy (max 5 cue, troncato):
            # Serato moderno usa Markers2 come fonte autoritativa, quindi lo
            # lasciamo intatto invece di riscriverlo con una spec non
            # verificata — ma lo segnaliamo, perché resta disallineato.
            entry["legacyV1"] = any(
                str(k).startswith("GEOB") and getattr(check.tags[k], "desc", "") == "Serato Markers_"
                for k in list(getattr(check, "tags", {}) or {})
            )
        except Exception as exc:
            entry["error"] = str(exc)[:300]
            if backup and os.path.exists(backup):
                try:
                    shutil.copy2(backup, path)
                    entry["rolledBack"] = _sha256(path) == _sha256(backup)
                except Exception:
                    entry["rolledBack"] = False
        results.append(entry)
        progress.update(i + 1, len(jobs))
    progress.finish(len(jobs), len(jobs))
    ok = sum(1 for r in results if r["ok"])
    emit({
        "type": "done",
        "data": {
            "written": ok,
            "failed": len(results) - ok,
            "backupDir": args.backup_dir,
            "results": results[:200],
        },
    })


def cmd_read_serato(args: argparse.Namespace) -> None:
    try:
        from mutagen import File as MutagenFile
    except ImportError:
        fail("mutagen non installato nel sidecar: impossibile leggere i cue Serato.")
        return
    root = args.serato_dir
    # Il percorso può essere una cartella _Serato_ (con 'database V2') OPPURE una
    # cartella musica: i cue Serato stanno nei tag GEOB dei file, quindi oltre al
    # database scansioniamo l'albero per i file taggati non ancora importati (i
    # brani cue-ati non sempre sono nel database corrente).
    serato_dir = None
    if os.path.exists(os.path.join(root, "database V2")):
        serato_dir = root
    elif os.path.exists(os.path.join(root, "_Serato_", "database V2")):
        serato_dir = os.path.join(root, "_Serato_")

    udm = open_udm(args.udm_path)
    run_id = udm.execute(
        "INSERT INTO ingest_runs (source, started_at, status) VALUES ('serato', ?, 'running')",
        (_now_local(),),
    ).lastrowid
    udm.commit()
    progress = ThrottledProgress("read-serato")
    tracks = 0
    cue_count = 0
    imported: set[str] = set()
    try:
        # 1) libreria dal database V2 (+ crate), se presente.
        if serato_dir:
            vol = _serato_volume_root(serato_dir)
            with open(os.path.join(serato_dir, "database V2"), "rb") as f:
                raw = f.read()
            otrks = [p for t, p in _serato_fields(raw) if t == "otrk"]
            for k, payload in enumerate(otrks):
                fld = {t: p for t, p in _serato_fields(payload)}
                # Il tipo di ogni campo si deriva dalla prima lettera del codice
                # (vedi _serato_value): niente tabella da mantenere.
                val = lambda tag: _serato_value(tag, fld[tag]) if tag in fld else None
                rel = val("pfil")
                if not rel:
                    continue
                # Separatori normalizzati e guardia sui rel già assoluti (con
                # '/' su mac o drive letter su Windows). normpath rende il path
                # nativo della piattaforma, così il confronto con os.walk in
                # fase di scan (set `imported`) non produce doppioni su Windows.
                rel = rel.replace("\\", "/")
                if rel.startswith("/") or re.match(r"^[A-Za-z]:", rel):
                    abs_path = os.path.normpath(rel)
                else:
                    abs_path = os.path.normpath(vol + "/" + rel)
                bpm_txt = val("tbpm")
                try:
                    bpm = float(bpm_txt) if bpm_txt else None
                except ValueError:
                    bpm = None
                cue_count += _serato_import_one(
                    udm, MutagenFile, abs_path, rel,
                    {
                        "title": val("tsng"),
                        "artist": val("tart"),
                        "album": val("talb"),
                        "genre": val("tgen"),
                        "bpm": bpm, "key": val("tkey"), "tlen": val("tlen"),
                    },
                )
                imported.add(abs_path)
                tracks += 1
                if tracks % 200 == 0:
                    udm.commit()
                progress.update(k + 1, len(otrks))
            _read_serato_crates(serato_dir, udm)
            udm.commit()

        # 2) scan della cartella per i file con "Serato Markers2" non già letti.
        def _txt(tags, key):
            try:
                return str(tags[key].text[0]) if key in tags else None
            except Exception:
                return None

        for dp, _, fs in os.walk(root):
            # Salta la cartella interna _Serato_ (indice/DB, niente audio) e i
            # cestini, ma RELATIVAMENTE alla root: un controllo substring sul path
            # assoluto azzerava l'intera scansione quando la root stessa era (o
            # stava sotto) una cartella il cui path contiene "_Serato_" — es.
            # quando l'utente seleziona proprio la cartella _Serato_, come indica
            # la UI. In quel caso i cue GEOB nei file (709 reali) andavano persi.
            reldp = os.path.relpath(dp, root)
            # Cestini: .Trash (macOS) e $RECYCLE.BIN (Windows).
            if "_Serato_" in reldp.split(os.sep) or "/.Trash" in dp or "$RECYCLE.BIN" in dp:
                continue
            for f in fs:
                if not f.lower().endswith(_SERATO_AUDIO_EXT):
                    continue
                ap = os.path.join(dp, f)
                if ap in imported:
                    continue
                try:
                    audio_f = MutagenFile(ap)
                    tags = getattr(audio_f, "tags", None)
                except Exception:
                    continue
                kind = _serato_container_kind(audio_f) if audio_f is not None else "id3"
                if not _serato_has_markers(tags, kind):
                    continue
                bpm = None
                try:
                    b = _txt(tags, "TBPM")
                    bpm = float(b) if b else None
                except Exception:
                    bpm = None
                cue_count += _serato_import_one(
                    udm, MutagenFile, ap, ap,
                    {
                        "title": _txt(tags, "TIT2"), "artist": _txt(tags, "TPE1"),
                        "album": _txt(tags, "TALB"), "genre": _txt(tags, "TCON"),
                        "bpm": bpm, "key": _txt(tags, "TKEY"), "_tags": tags, "_audio": audio_f,
                    },
                )
                imported.add(ap)
                tracks += 1
                if tracks % 100 == 0:
                    udm.commit()
                    progress.update(tracks, tracks + 1)

        udm.commit()
        udm.execute(
            "UPDATE ingest_runs SET finished_at=?, status='ok', track_count=? WHERE id=?",
            (_now_local(), tracks, run_id),
        )
        udm.commit()
        progress.finish(tracks, tracks)
        emit({"type": "done", "data": {"tracks": tracks, "cues": cue_count}})
    except Exception as exc:
        udm.rollback()
        udm.execute(
            "UPDATE ingest_runs SET finished_at=?, status='error', error=? WHERE id=?",
            (_now_local(), str(exc), run_id),
        )
        udm.commit()
        fail(f"Lettura Serato non riuscita: {str(exc)[:300]}")
    finally:
        udm.close()


def _read_serato_crates(serato_dir: str, udm: sqlite3.Connection) -> None:
    """Crate Serato (Subcrates/*.crate) → playlist. Best-effort."""
    sub = os.path.join(serato_dir, "Subcrates")
    if not os.path.isdir(sub):
        return
    udm.execute("DELETE FROM playlist_tracks WHERE playlist_id IN (SELECT id FROM playlists WHERE source='serato')")
    udm.execute("DELETE FROM playlists WHERE source='serato'")
    import glob as _g

    # Ricorsivo: Serato annida i crate in sottocartelle di raggruppamento
    # (es. Subcrates/Serato Stems/Stems.crate), che un glob non-ricorsivo
    # ("*.crate") non trovava → 0 playlist importate.
    for order, cf in enumerate(sorted(_g.glob(os.path.join(sub, "**", "*.crate"), recursive=True))):
        name = os.path.splitext(os.path.basename(cf))[0].replace("%%", " / ")
        try:
            with open(cf, "rb") as f:
                raw = f.read()
        except Exception:
            continue
        rels = [
            _serato_text(sp)
            for t, p in _serato_fields(raw)
            if t == "otrk"
            for st, sp in _serato_fields(p)
            if st == "ptrk"
        ]
        cur = udm.execute(
            "INSERT INTO playlists (source, source_id, name, is_folder, sort_order)"
            " VALUES ('serato', ?, ?, 0, ?)",
            (cf, name, order),
        )
        pid = cur.lastrowid
        pos = 0
        for rel in rels:
            if not rel:
                continue
            tr = udm.execute(
                "SELECT id FROM tracks WHERE source='serato' AND source_id=?", (rel,)
            ).fetchone()
            if tr:
                udm.execute(
                    "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?,?,?)",
                    (pid, tr[0], pos),
                )
                pos += 1


# ---------------------------------------------------------------------------
# Rekordbox su chiavetta USB — la SECONDA chiave
# ---------------------------------------------------------------------------
#
# ⚠ Le chiavi SQLCipher di Rekordbox sono DUE, e non sono intercambiabili:
#
#   - quella del `master.db` desktop, che pyrekordbox ricava/scarica e che
#     questo sidecar usa in `ingest-masterdb`;
#   - quella dei database su chiavetta (`exportLibrary.db`, `export.pdb`), che
#     è la costante qui sotto.
#
# Usare l'una al posto dell'altra non dà un errore parlante: dà "file is not a
# database", che somiglia a un file corrotto. È l'errore più comune su questa
# superficie, ed è il motivo per cui le due strade sono tenute separate anche
# nel codice invece di essere unificate dietro un parametro.

_RB_USB_PASSWORD = "r8gddnr4k847830ar6cqzbkk0el6qytmb3trbbx805jm74vez64i5o8fnrqryqls"
_RB_USB_CIPHER_PRAGMAS = ("cipher=sqlcipher", "legacy=4")
# Validata contro property[0].dbVersion. Una versione diversa significa
# "chiavetta scritta da un'altra generazione di Rekordbox", non "file rotto".
_RB_USB_EXPECTED_DB_VERSION = "1000"

_RB_USB_LIBRARY = "exportLibrary.db"
_RB_USB_PDB = "export.pdb"


def find_pioneer_dir(root: str) -> str | None:
    """Cartella `rekordbox` di una chiavetta Pioneer, se c'è.

    ⚠ Non esiste un file marcatore: una chiavetta si riconosce dalla presenza di
    uno dei due database. Su HFS+ la cartella si chiama `.PIONEER`, col punto.
    """
    for name in ("PIONEER", ".PIONEER"):
        d = os.path.join(root, name, "rekordbox")
        if os.path.exists(os.path.join(d, _RB_USB_LIBRARY)) or os.path.exists(
            os.path.join(d, _RB_USB_PDB)
        ):
            return d
    return None


def _open_usb_library(path: str):
    """Apre `exportLibrary.db` con la chiave USB. Senza, il file non si apre affatto."""
    try:
        import sqlcipher3  # type: ignore
    except ImportError as exc:
        raise RuntimeError(f"sqlcipher3 non disponibile nel sidecar: {exc}") from exc

    con = sqlcipher3.connect(path)
    cur = con.cursor()
    for pragma in _RB_USB_CIPHER_PRAGMAS:
        cur.execute(f"PRAGMA {pragma};")
    cur.execute(f"PRAGMA key='{_RB_USB_PASSWORD}';")
    # La chiave sbagliata non fallisce qui: fallisce alla prima lettura reale.
    cur.execute("SELECT count(*) FROM sqlite_master;")
    cur.fetchone()
    return con


def _table_columns(con, table: str) -> set[str]:
    try:
        return {r[1] for r in con.execute(f"PRAGMA table_info({table})").fetchall()}
    except Exception:
        return set()


def cmd_read_usb_library(args: argparse.Namespace) -> None:
    """Legge una libreria Rekordbox da chiavetta USB, in sola lettura.

    Non tocca il supporto: apre, legge, chiude. Le scritture su chiavetta
    (export.pdb, USBANLZ, catena staging→copia→verifica) sono un'altra cosa e
    non sono implementate.
    """
    root = args.usb_root
    pioneer = find_pioneer_dir(root)
    if not pioneer:
        fail(
            f"Nessuna libreria Pioneer in {root}: manca la cartella PIONEER/rekordbox "
            f"con {_RB_USB_LIBRARY} o {_RB_USB_PDB}."
        )
        return

    lib_path = os.path.join(pioneer, _RB_USB_LIBRARY)
    if not os.path.exists(lib_path):
        fail(
            f"Su questa chiavetta c'è solo {_RB_USB_PDB}, che è un formato diverso "
            f"e non è ancora supportato in lettura."
        )
        return

    try:
        con = _open_usb_library(lib_path)
    except Exception as exc:
        fail(
            "Impossibile aprire il database della chiavetta. Se il file esiste ed è "
            f"integro, potrebbe essere di una generazione non supportata: {str(exc)[:200]}"
        )
        return

    udm = open_udm(args.udm_path)
    run_id = udm.execute(
        "INSERT INTO ingest_runs (source, started_at, status) VALUES ('rekordbox-usb', ?, 'running')",
        (_now_local(),),
    ).lastrowid
    udm.commit()

    progress = ThrottledProgress("read-usb-library")
    tracks = 0
    warnings: list[str] = []

    try:
        # Versione del formato: un valore diverso non è un errore, è una
        # generazione che non abbiamo collaudato. Si dice e si prosegue in
        # lettura — leggere non può rovinare la chiavetta.
        try:
            row = con.execute("SELECT dbVersion FROM property LIMIT 1").fetchone()
            found = str(row[0]) if row and row[0] is not None else None
        except Exception:
            found = None
        if found != _RB_USB_EXPECTED_DB_VERSION:
            warnings.append(
                f"Versione del database della chiavetta: {found or 'non rilevata'} "
                f"(collaudata: {_RB_USB_EXPECTED_DB_VERSION}). I dati letti potrebbero "
                "essere incompleti."
            )

        cols = _table_columns(con, "content")
        if not cols:
            fail("Il database della chiavetta non ha una tabella 'content'.")
            return

        def col(*names):
            for n in names:
                if n in cols:
                    return n
            return None

        c_id = col("ID", "id")
        c_title = col("Title", "title")
        c_bpm = col("BPM", "bpm")
        c_len = col("Length", "length")
        c_folder = col("FolderPath", "folder_path")
        c_file = col("FileNameL", "FileNameS", "file_name")
        c_year = col("ReleaseYear", "Year", "year")
        c_size = col("FileSize", "file_size")

        if not c_id:
            fail("La tabella 'content' non ha una colonna identificativa riconoscibile.")
            return

        # Le tabelle di lookup: su una chiavetta i nomi sono normalizzati.
        def lookup(table: str) -> dict:
            tcols = _table_columns(con, table)
            if not tcols:
                return {}
            key = "ID" if "ID" in tcols else ("id" if "id" in tcols else None)
            name = "Name" if "Name" in tcols else ("name" if "name" in tcols else None)
            if not key or not name:
                return {}
            try:
                return {r[0]: r[1] for r in con.execute(f'SELECT "{key}", "{name}" FROM {table}')}
            except Exception:
                return {}

        artists = lookup("artist")
        albums = lookup("album")
        genres = lookup("genre")
        keys = lookup("key")

        c_artist = col("ArtistID", "artist_id")
        c_album = col("AlbumID", "album_id")
        c_genre = col("GenreID", "genre_id")
        c_key = col("KeyID", "key_id")

        select = [c for c in (c_id, c_title, c_bpm, c_len, c_folder, c_file, c_year,
                              c_size, c_artist, c_album, c_genre, c_key) if c]
        rows = con.execute(f'SELECT {", ".join(chr(34)+c+chr(34) for c in select)} FROM content').fetchall()
        idx = {name: i for i, name in enumerate(select)}

        def get(r, c):
            return r[idx[c]] if c and c in idx else None

        ins = (
            "INSERT INTO tracks (source, source_id, title, artist, album, genre, year, bpm,"
            " musical_key, duration_s, path, filesize, data)"
            " VALUES ('rekordbox-usb', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(source, source_id) DO UPDATE SET"
            " title=excluded.title, artist=excluded.artist, album=excluded.album,"
            " genre=excluded.genre, year=excluded.year, bpm=excluded.bpm,"
            " musical_key=excluded.musical_key, duration_s=excluded.duration_s,"
            " path=excluded.path, filesize=excluded.filesize"
        )

        for k, r in enumerate(rows):
            cid = get(r, c_id)
            folder = get(r, c_folder) or ""
            fname = get(r, c_file) or ""
            path = folder if folder.endswith(fname) else (folder.rstrip("/\\") + "/" + fname if fname else folder)
            raw_bpm = get(r, c_bpm)
            # Rekordbox tiene il BPM moltiplicato per 100.
            bpm = (float(raw_bpm) / 100.0) if raw_bpm not in (None, 0) else None
            length = get(r, c_len)
            udm.execute(
                ins,
                (
                    str(cid),
                    get(r, c_title),
                    artists.get(get(r, c_artist)),
                    albums.get(get(r, c_album)),
                    genres.get(get(r, c_genre)),
                    get(r, c_year),
                    bpm,
                    keys.get(get(r, c_key)),
                    float(length) if length else None,
                    path or None,
                    get(r, c_size),
                    json.dumps({"rekordboxUsb": {"contentId": cid, "device": pioneer}}),
                ),
            )
            tracks += 1
            if tracks % 200 == 0:
                udm.commit()
            progress.update(k + 1, len(rows))

        udm.commit()
        udm.execute(
            "UPDATE ingest_runs SET finished_at=?, status='ok', track_count=? WHERE id=?",
            (_now_local(), tracks, run_id),
        )
        udm.commit()
        progress.finish(tracks, tracks)
        emit({"type": "done", "data": {"tracks": tracks, "device": pioneer, "warnings": warnings}})
    except Exception as exc:
        udm.rollback()
        udm.execute(
            "UPDATE ingest_runs SET finished_at=?, status='error', error=? WHERE id=?",
            (_now_local(), str(exc), run_id),
        )
        udm.commit()
        fail(f"Lettura della chiavetta non riuscita: {str(exc)[:300]}")
    finally:
        try:
            con.close()
        except Exception:
            pass
        udm.close()


def cmd_ensure_key(args: argparse.Namespace) -> None:
    """Preflight all'avvio (auto): se la chiave di lettura non è in cache la
    scarica, così la lettura diretta del master.db funziona out-of-the-box su un
    Mac appena installato (Rekordbox >= 6.6.5). Idempotente e non distruttivo.
    Esce SEMPRE con successo: lo stato reale è in data.keyReady, così Node
    distingue "modulo rotto" (uscita !=0) da "chiave non ancora pronta"
    (uscita 0, keyReady=false, es. offline al primo avvio)."""
    if _key_cached():
        emit({"type": "done", "data": {"keyReady": True, "downloaded": False}})
        return
    try:
        _download_and_cache_key()
        emit({"type": "done", "data": {"keyReady": _key_cached(), "downloaded": True}})
    except Exception as exc:
        emit({
            "type": "done",
            "data": {"keyReady": False, "downloaded": False, "error": str(exc)[:200]},
        })


# ---------------------------------------------------------------------------
# stems (Fase 2.5, opzionale) — Demucs on-demand
# ---------------------------------------------------------------------------

def cmd_stems(args: argparse.Namespace) -> None:
    try:
        import demucs  # type: ignore  # noqa: F401
    except ImportError:
        fail(
            "Demucs non installato in questo sidecar (operazione opzionale e "
            "pesante). Installa il livello AI: pip install -r requirements-ai.txt."
        )
        return
    emit({"type": "log", "message": "Separazione stem avviata (operazione lunga)…"})
    # In build PyInstaller frozen sys.executable è il sidecar stesso, non un
    # interprete Python: "sidecar -m demucs" non funziona. Chiama Demucs in
    #-process; se non disponibile in questa build, errore chiaro.
    if getattr(sys, "frozen", False):
        try:
            from demucs.separate import main as demucs_main  # type: ignore
        except ImportError:
            fail(
                "Gli stem richiedono il sidecar con il livello AI (script/venv), "
                "non disponibile in questa build compilata."
            )
            return
        try:
            demucs_main(["--out", args.out_dir, args.file])
        except SystemExit as exc:  # demucs usa argparse → SystemExit
            if exc.code not in (0, None):
                fail(f"Demucs terminato con codice {exc.code}")
                return
        except Exception as exc:  # noqa: BLE001
            fail(f"Demucs: {str(exc)[:300]}")
            return
    else:
        out = subprocess.run(
            [sys.executable, "-m", "demucs", "--out", args.out_dir, args.file],
            capture_output=True,
            text=True,
        )
        if out.returncode != 0:
            fail(f"Demucs exit {out.returncode}: {out.stderr.strip()[-500:]}")
    emit({"type": "done", "data": {"outDir": args.out_dir}})


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(prog="crateforge-sidecar")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ping = sub.add_parser("ping")
    p_ping.add_argument("--udm-path", required=False)

    p_ingest = sub.add_parser("ingest-masterdb")
    p_ingest.add_argument("--udm-path", required=True)
    p_ingest.add_argument("--master-db", required=True)
    p_ingest.add_argument("--options-json", required=False)
    p_ingest.add_argument("--key", required=False, help="chiave SQLCipher esplicita (test/Esperto)")

    p_fp = sub.add_parser("fingerprint")
    p_fp.add_argument("--udm-path", required=True)
    p_fp.add_argument("--file", required=True)
    p_fp.add_argument("--track-id", required=False)

    p_fpb = sub.add_parser("fingerprint-batch")
    p_fpb.add_argument("--udm-path", required=True)

    p_mfp = sub.add_parser("match-fingerprints")
    p_mfp.add_argument("--udm-path", required=True)
    p_mfp.add_argument("--new-root", required=True)

    p_cues = sub.add_parser("analyze-cues")
    p_cues.add_argument("--udm-path", required=True)
    p_cues.add_argument("--file", required=True)
    p_cues.add_argument("--track-id", required=False)

    p_stems = sub.add_parser("stems")
    p_stems.add_argument("--udm-path", required=True)
    p_stems.add_argument("--file", required=True)
    p_stems.add_argument("--out-dir", required=True)

    p_wt = sub.add_parser("write-tags")
    p_wt.add_argument("--udm-path", required=True)
    p_wt.add_argument("--tags-json", required=False)
    p_wt.add_argument("--tags-file", required=False)
    p_wt.add_argument("--backup-dir", required=True)

    p_dk = sub.add_parser("download-key")
    p_dk.add_argument("--udm-path", required=True)

    # Preflight all'avvio: verifica/prepara la chiave senza intervento utente.
    p_ek = sub.add_parser("ensure-key")
    p_ek.add_argument("--udm-path", required=False)

    # Serato (sperimentale): libreria database V2 + crate + cue GEOB.
    p_ser = sub.add_parser("read-serato")
    p_ser.add_argument("--udm-path", required=True)
    p_ser.add_argument("--serato-dir", required=True)

    # Scrittura dei cue nei tag GEOB dei file audio (§3.4: backup + rollback).
    p_wc = sub.add_parser("write-serato-crates")
    p_wc.add_argument("--udm-path", required=True)
    p_wc.add_argument("--serato-dir", required=True)
    p_wc.add_argument("--crates-json", required=False)
    p_wc.add_argument("--crates-file", required=False)
    # neworder.pref è l'unico file ESISTENTE che questo comando modifica: prima
    # di toccarlo se ne fa una copia verificata, come per i tag audio.
    p_wc.add_argument("--backup-dir", required=False)

    p_wd = sub.add_parser("write-serato-database")
    p_wd.add_argument("--udm-path", required=True)
    p_wd.add_argument("--serato-dir", required=True)
    p_wd.add_argument("--tracks-json", required=False)
    p_wd.add_argument("--tracks-file", required=False)
    p_wd.add_argument("--backup-dir", required=False)

    p_ws = sub.add_parser("write-serato-cues")
    p_ws.add_argument("--udm-path", required=True)
    p_ws.add_argument("--cues-json", required=False)
    p_ws.add_argument("--cues-file", required=False)
    p_ws.add_argument("--backup-dir", required=True)

    p_usb = sub.add_parser("read-usb-library")
    p_usb.add_argument("--udm-path", required=True)
    p_usb.add_argument("--usb-root", required=True)

    p_rh = sub.add_parser("read-history")
    p_rh.add_argument("--udm-path", required=True)
    p_rh.add_argument("--master-db", required=True)
    p_rh.add_argument("--key", required=False, default="")

    p_mcp = sub.add_parser("masterdb-create-playlist")
    p_mcp.add_argument("--udm-path", required=True)
    p_mcp.add_argument("--master-db", required=True)
    p_mcp.add_argument("--playlist-name", required=True)
    p_mcp.add_argument("--content-ids-json", required=False)
    p_mcp.add_argument("--content-ids-file", required=False)
    p_mcp.add_argument("--key", required=False, default="")

    p_mwm = sub.add_parser("masterdb-write-metadata")
    p_mwm.add_argument("--udm-path", required=True)
    p_mwm.add_argument("--master-db", required=True)
    p_mwm.add_argument("--tracks-json", required=False)
    p_mwm.add_argument("--tracks-file", required=False)
    p_mwm.add_argument("--key", required=False, default="")

    args = parser.parse_args()

    if args.command == "ping":
        emit({"type": "done", "data": {"pong": True, "python": sys.version.split()[0]}})
    elif args.command == "ingest-masterdb":
        cmd_ingest_masterdb(args)
    elif args.command == "fingerprint":
        cmd_fingerprint(args)
    elif args.command == "fingerprint-batch":
        cmd_fingerprint_batch(args)
    elif args.command == "match-fingerprints":
        cmd_match_fingerprints(args)
    elif args.command == "analyze-cues":
        cmd_analyze_cues(args)
    elif args.command == "stems":
        cmd_stems(args)
    elif args.command == "write-tags":
        cmd_write_tags(args)
    elif args.command == "download-key":
        cmd_download_key(args)
    elif args.command == "ensure-key":
        cmd_ensure_key(args)
    elif args.command == "read-serato":
        cmd_read_serato(args)
    elif args.command == "write-serato-cues":
        cmd_write_serato_cues(args)
    elif args.command == "write-serato-crates":
        cmd_write_serato_crates(args)
    elif args.command == "write-serato-database":
        cmd_write_serato_database(args)
    elif args.command == "read-usb-library":
        cmd_read_usb_library(args)
    elif args.command == "read-history":
        cmd_read_history(args)
    elif args.command == "masterdb-create-playlist":
        cmd_masterdb_create_playlist(args)
    elif args.command == "masterdb-write-metadata":
        cmd_masterdb_write_metadata(args)


if __name__ == "__main__":
    main()
