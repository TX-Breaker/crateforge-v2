# Handoff tecnico e di sicurezza — CrateForge (sessione conversione DJ)

Documento per la **prossima IA/revisore** che valuterà i rischi di sicurezza e le
scelte tecniche adottate. Copre: cosa è stato scoperto sui dati reali, ogni
cambiamento fatto, la postura di sicurezza, i rischi aperti e le decisioni
tecniche discutibili.

Ambiente: macOS (Apple Silicon), Node@22 + Python@3.13 (via Homebrew), sessione
Claude Code in **modalità bypass-permessi** (azioni auto-approvate). Per questo mi
sono auto-vincolato a operazioni **non distruttive**.

---

## 0. Postura di sicurezza adottata (leggere per primo)

| Ambito | Cosa ho fatto | Rischio residuo |
|---|---|---|
| **master.db Rekordbox** | Backup verificato in `~/Desktop/Backup MASTER DB Rekordbox/`; il file REALE **mai aperto in scrittura**; hash+mtime invariati a fine sessione | Nessuno per l'originale |
| **Librerie utente** (Serato, Traktor, VirtualDJ, Engine) | Aperte **solo in lettura**; DB copiati in `/tmp` prima di aprirli quando potenzialmente in uso | Nessuno |
| **File audio** (Serato) | Aperti in **sola lettura** con mutagen per leggere i tag GEOB | Nessuno |
| **Simulazione scrittura master.db** | Solo su **copia** in `/tmp` (poi rimossa); verificato che il reale resta intatto | Nessuno |
| **Scritture su disco reali** | Solo: (a) backup additivo su Desktop, (b) file nel repo CrateForge (codice/doc), (c) file temporanei in `/tmp` e artefatti build gitignored | Nessuno su dati utente |
| **Rete** | Nessun dato utente inviato. Chiamate esterne: vedi §5 | Basso |
| **`rm` eseguiti** | Solo su `/tmp/*` e `python-sidecar/{build,dist}` (rigenerabili, gitignored) | Nessuno |

**Nota chiave per il revisore:** in questa sessione NON è stato scritto nulla su
alcuna libreria DJ reale dell'utente. Tutte le "scritture" verso i DJ sono
*export su file nuovi* o *simulazioni su copie*.

---

## 1. Contesto e obiettivo

CrateForge è un gestore/convertitore di librerie DJ con un **modello-pivot interno**
(UDM, SQLite in chiaro) verso cui ogni software (Rekordbox, Serato, Traktor,
VirtualDJ, Engine DJ) viene importato ed esportato. Obiettivo della sessione:
implementare i fix del report `docs/INTEROPERABILITA-DJ.md`, aggiungere un
convertitore X→Y in GUI, validare tutto su **dati reali**, verificare la
scrittura sicura sul master.db in simulazione, e catalogare le operazioni utili
per programma (`docs/CATALOGO-OPERAZIONI.md`).

---

## 2. Scoperte sui dati reali

- **Rekordbox**: master.db cifrato SQLCipher (6102 brani, **3368 cue** in
  `DjmdCue`), chiave DB6 in cache pyrekordbox. Export XML reale da 70 MB
  (`Collezione-RKB-2026.xml`) → 6041 brani, 152 playlist, **3357 cue** letti
  correttamente (coerenti col master.db). `Kind` dei cue è **ordinale non
  contiguo** (pad 1-3=Kind 1-3, pad 4-8=Kind 5-9, Kind 4 riservato ai loop).
- **Serato**: i cue NON sono nel database ma nei tag **ID3 GEOB "Serato
  Markers2"** dei file audio. Trovati **96 file reali** con cue. **Scoperta
  critica**: il payload è `\x01\x01` + base64 (newline ogni 72 char) + null di
  padding, e la base64 ha un **gruppo finale parziale** (lunghezza `mod4==1`) che
  va **troncato all'ultimo gruppo completo di 4** — la mia prima implementazione
  (padding con `=`) falliva su TUTTI i file veri. Corretto e validato su 95/96
  file (709 hot cue). Posizioni in **ms** (uint32 BE), colori RGB, label reali.
- **Traktor**: NML reale (4735 brani, 78 cue) con posizioni cue a **precisione
  sub-ms** preservata; smartlist dinamiche correttamente segnalate.
- **VirtualDJ**: POI nel `database.xml` (in questa libreria solo automix/remix);
  playlist statiche in `.vdjfolder` (qui solo FilterFolder dinamici).
- **Engine DJ**: cue nei blob `PerformanceData` (quickCues zlib+BE, loops LE,
  posizioni in **sample** con sample-rate **per-traccia**); key intera 0-23
  **ordinata Camelot** (non cromatica — era un bug). 860 hot cue reali
  decodificati; end-to-end verificato.

---

## 3. Cambiamenti fatti (per file, con motivazione)

Vedi anche `docs/IMPLEMENTAZIONE-FIX.md`. Sintesi tecnica:

### Sidecar Python (`python-sidecar/sidecar.py`)
- **Lettura cue Rekordbox** in `ingest-masterdb`: bulk-fetch `DjmdCue`, mappa
  `Kind`→pad non contigua (`_rb_pad_index`), tipi hot/memory/loop, palette
  colori best-effort, rating e track_color. *Prima leggeva 0 cue.*
- **Serato** (`parse_serato_markers2`, `cmd_read_serato`, helper): parser GEOB
  Markers2 con il fix base64 (troncatura); lettura via `mutagen.File` (funziona
  su MP3/AIFF/WAV; FLAC/MP4 usano altri contenitori — limite noto); database V2 +
  crate; **scan della cartella** per file taggati non presenti nel database.
- `download-key`/`ensure-key`: nomi funzione corretti (`download_db6_key`/
  `write_db6_key_cache`); timestamp `ingest_runs` in ora locale.

### Adapter TypeScript
- `engine/engineReader.ts`: **fix key Camelot** (era cromatica → key sbagliata su
  ogni brano); decodifica cue `PerformanceData` (zlib framing BE, loops LE,
  ARGB→hex, sample→ms con SR per-traccia); rating.
- `traktor/nmlReader.ts` + `nmlWriter.ts`: risoluzione path VOLUME **boot vs
  esterno** (default a esterno se non confermato boot → deterministico anche a
  drive scollegato); loop-su-pad senza collisioni; SMARTLIST segnalate.
- `virtualdj/vdjReader.ts`: parser `.vdjfolder` (playlist statiche, anche vuote),
  POI automix realStart/remix→memory, colore POI.
- `rekordbox/xmlWriter.ts`: **loop** ora esportati (Type=4 con End); allocazione
  `Num` dei pad **senza collisioni** tra hot cue e hot loop.
- `common.ts`: `ExportSelection.source` → export filtrato per libreria (per X→Y).

### Modello e GUI
- `core/schema.ts`: **migrazione UDM v6** (ALTER TABLE additivo:
  `gain_db/rating/track_color/beatgrid_bpm/beatgrid_anchor_ms`). Non distruttiva.
- `core/foreignImport.ts`, `core/udm.ts`: `NormTrack`/`TrackRow` estesi.
- `renderer/.../ConverterPage.tsx`: **selettore X→Y** che importa la libreria e la
  esporta filtrando sulla sorgente; Serato accetta cartella `_Serato_` o musica.
- Preload/IPC: `library.importSerato`, `rekordbox.defaultPaths`, `preflight`.
- (Sessione precedente, incluse qui) preflight all'avvio + default path master.db.

### Test
- Fixture aggiornate al nuovo comportamento (loop nell'XML, key Engine Camelot);
  nuovo test decoder cue Engine. **176 test verdi.**

---

## 4. Rischi tecnici da valutare (per il revisore)

| # | Area | Rischio | Mitigazione attuale |
|---|---|---|---|
| R1 | **Scrittura diretta master.db** (`masterdb-create-playlist`) | È l'UNICO percorso che scrive su dati reali dell'utente: playlist ri-cifrate nel DB. Errore/concorrenza → corruzione libreria | Gate `masterDbWrites`; backup datato PRIMA di scrivere (Node); pyrekordbox **blocca la commit se Rekordbox è aperto**; sola scrittura playlist (no cue) |
| R2 | **Parser Serato Markers2** | Formato reverse-engineered; la troncatura base64 è empirica → se Serato cambia formato può dare cue in posizioni sbagliate | Validato su 95/96 file reali; sola lettura; il LOOP usa offset documentati non validati su dato reale (nessun loop nei file utente) |
| R3 | **Parser Engine PerformanceData** | Blob binario reverse-engineered (endianness mista, SR per-traccia) | Validato su dato reale (860 cue, match col deep-dive); sola lettura; guardie sui bound del buffer |
| R4 | **Writer Serato (NON implementato)** | Scriverebbe tag GEOB nei FILE AUDIO originali → operazione distruttiva sui file | **Deliberatamente non implementato.** Se un futuro AI lo aggiunge: obbligo backup dei file + copie |
| R5 | **Palette colori / mappa Kind** | Best-effort/euristiche (colori pad Rekordbox, Kind→pad) | Solo estetica/indici; non intaccano posizioni |
| R6 | **Risoluzione path Traktor** | Dipende dallo stato di mount corrente (realpath /Volumes) | Deterministico per boot; per esterni non montati assume `/Volumes/<vol>` |
| R7 | **Sidecar PyInstaller non firmato** | Gatekeeper/quarantena; falsi positivi antivirus | Documentato; preflight verifica l'avviabilità |

---

## 5. Rete e dati esterni

- **pyrekordbox `download_db6_key`**: al preflight, se la chiave di lettura manca,
  scarica una **chiave pubblica nota** da un URL raw di GitHub (progetto CueGen).
  Nessun dato utente inviato. One-time, cache locale.
- **Auto-Tagger** (feature esistente, non toccata): interroga MusicBrainz/Discogs
  con titolo/artista per proporre tag. Invia metadati dei brani a servizi terzi
  (opt-in dell'utente).
- Nessun'altra comunicazione di rete introdotta in questa sessione.

---

## 6. Scelte tecniche adottate (razionale)

1. **Pivot in millisecondi `REAL`** come lingua franca dei cue: converte tra ms
   interi (Serato/Rekordbox), sub-ms (Traktor), sample (Engine).
2. **Serato base64**: troncatura all'ultimo gruppo di 4 invece del padding —
   unica strategia che decodifica i file reali.
3. **Serato: scan cartella oltre al database V2** — perché i file cue-ati non
   sono sempre nel database corrente (nell'utente: 96 file cue-ati, 2 nel db).
4. **Engine sample→ms con SR per-traccia** — mai 44100 fisso (nei dati reali
   coesistono 44100/48000/22050/32000).
5. **Migrazione schema additiva** (ALTER TABLE ADD COLUMN) — nessuna perdita dati
   su UDM esistenti.
6. **Export filtrato per `source`** — la conversione X→Y esporta solo la libreria
   X, non tutto l'hub UDM.
7. **Allocazione pad senza collisioni** nel writer XML — due POSITION_MARK con lo
   stesso Num sono invalidi in Rekordbox.

---

## 7. Verifiche eseguite (evidenze)

- **176 test** unitari verdi; typecheck pulito; build di produzione OK.
- **Review avversariale** multi-agente (18 agenti): 7 bug confermati e corretti.
- **Dati reali**: Rekordbox master.db (3368 cue) + XML (3357 cue); Engine m.db
  (860 cue); Serato (95/96 file, 709 cue); Traktor NML (78 cue).
- **End-to-end**: Serato reale → Traktor NML + Rekordbox XML con **tutti i 78 cue
  preservati** (posizioni, colori, label, indici).
- **Simulazione scrittura master.db**: playlist scritta su copia, riletta,
  master reale intatto (hash+mtime).

---

## 8. Aperto / da fare (per la prossima IA)

- **Scrittura cue nel master.db** (item 11): pyrekordbox non espone `add_cue`;
  serve inserimento low-level `DjmdCue` con USN/UUID corretti. Fattibile, non
  fatto. Alto rischio → dietro gate + backup + Rekordbox chiuso.
- **Beatgrid reale** (item 10): bloccato da `ConstError` di pyrekordbox sul chunk
  ANLZ PQT2; serve parser custom.
- **Writer Serato/Engine**: assenti (scriverebbero su file/DB originali).
- **Serato LOOP**: parser presente ma non validato su dato reale (nessun loop nei
  file utente).
- **FLAC/MP4 Serato**: cue in contenitori diversi da ID3 (non letti).
