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
                                    track_color, beatgrid_bpm, beatgrid_anchor_ms)
                VALUES ('masterdb', :source_id, :title, :artist, :album, :genre,
                        :year, :bpm, :musical_key, :camelot, :duration_s, :path,
                        :filesize, :version_label, :has_tag_issues,
                        :needs_review, :review_reason, :gain_db, :rating,
                        :track_color, :beatgrid_bpm, :beatgrid_anchor_ms)
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
                    beatgrid_anchor_ms=excluded.beatgrid_anchor_ms
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
        energies: list[float] = []
        total_frames = 0
        while True:
            samples, read = src()
            if onset(samples):
                onsets_s.append(onset.get_last_s())
            tempo(samples)
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
        if 0 <= t < duration and len(cues) < 8:
            cues.append({"label": label, "positionMs": round(t * 1000), "color": color})

    add("Intro", onsets_s[0] if onsets_s else 0.0, "#28e214")
    # Drop: primo salto sostenuto sopra l'80% del picco
    for i, e in enumerate(profile):
        if e >= 0.8 * peak and i > 4:
            add("Drop", float(i), "#e21414")
            break
    # Breakdown: primo crollo sotto il 30% del picco dopo il drop
    drop_i = next((i for i, e in enumerate(profile) if e >= 0.8 * peak and i > 4), None)
    if drop_i is not None:
        for i in range(drop_i + 4, len(profile)):
            if profile[i] <= 0.3 * peak:
                add("Breakdown", float(i), "#1478e2")
                break
    add("Outro", max(0.0, duration - 32.0), "#e2a014")

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
                udm.execute(
                    """INSERT INTO play_history
                       (session_id, session_name, session_date, position, title, artist,
                        album, genre, year, bpm, musical_key, duration_s, isrc, label, path)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        sid, sname, str(sdate) if sdate is not None else None, idx,
                        t["title"], t["artist"], t["album"], t["genre"], t["year"],
                        t["bpm"], t["musical_key"], t["duration_s"], isrc, label, t["path"],
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


def _serato_has_markers(tags) -> bool:
    if not tags:
        return False
    for gk in tags.keys():
        if str(gk).startswith("GEOB") and getattr(tags[gk], "desc", "") == "Serato Markers2":
            return True
    return False


def _serato_import_one(udm, MutagenFile, abs_path, source_id, meta) -> int:
    """Inserisce/aggiorna un brano Serato e ne legge i cue GEOB. Ritorna il
    numero di cue importati. `meta['_tags']` (se presente) evita di riaprire il
    file quando i tag sono già stati letti dallo scan."""
    title, artist, key_name = meta.get("title"), meta.get("artist"), meta.get("key")
    udm.execute(
        """INSERT INTO tracks (source, source_id, title, artist, album, genre,
               bpm, musical_key, camelot, path, has_tag_issues, needs_review)
           VALUES ('serato', :sid, :title, :artist, :album, :genre, :bpm, :key,
               :camelot, :path, :issue, 0)
           ON CONFLICT(source, source_id) DO UPDATE SET
               title=excluded.title, artist=excluded.artist, album=excluded.album,
               genre=excluded.genre, bpm=excluded.bpm, musical_key=excluded.musical_key,
               camelot=excluded.camelot, path=excluded.path""",
        {
            "sid": source_id, "title": title, "artist": artist,
            "album": meta.get("album"), "genre": meta.get("genre"),
            "bpm": meta.get("bpm"), "key": key_name, "camelot": to_camelot(key_name),
            "path": abs_path, "issue": 1 if (not title or not artist) else 0,
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
    tags = meta.get("_tags")
    if tags is None:
        try:
            tags = getattr(MutagenFile(abs_path), "tags", None)
        except Exception:
            tags = None
    for gk in list(tags.keys()) if tags else []:
        if not str(gk).startswith("GEOB"):
            continue
        fr = tags[gk]
        if getattr(fr, "desc", "") == "Serato Markers2":
            for c in parse_serato_markers2(bytes(fr.data)):
                udm.execute(
                    "INSERT INTO cues (track_id, cue_type, cue_index, position_ms,"
                    " length_ms, color, label) VALUES (?,?,?,?,?,?,?)",
                    (tid, c[0], c[1], c[2], c[3], c[4], c[5]),
                )
                n += 1
    return n


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
                rel = _serato_text(fld.get("pfil", b"")) if fld.get("pfil") else None
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
                bpm_txt = _serato_text(fld.get("tbpm", b""))
                try:
                    bpm = float(bpm_txt) if bpm_txt else None
                except ValueError:
                    bpm = None
                cue_count += _serato_import_one(
                    udm, MutagenFile, abs_path, rel,
                    {
                        "title": _serato_text(fld.get("tsng", b"")),
                        "artist": _serato_text(fld.get("tart", b"")),
                        "album": _serato_text(fld.get("talb", b"")),
                        "genre": _serato_text(fld.get("tgen", b"")),
                        "bpm": bpm, "key": _serato_text(fld.get("tkey", b"")),
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
                    tags = getattr(MutagenFile(ap), "tags", None)
                except Exception:
                    continue
                if not _serato_has_markers(tags):
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
                        "bpm": bpm, "key": _txt(tags, "TKEY"), "_tags": tags,
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
    elif args.command == "read-history":
        cmd_read_history(args)
    elif args.command == "masterdb-create-playlist":
        cmd_masterdb_create_playlist(args)


if __name__ == "__main__":
    main()
