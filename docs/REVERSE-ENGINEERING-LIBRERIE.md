# Reverse engineering delle librerie DJ: cifratura, binding, scrittura esterna

## 1. Executive summary

Questo report documenta il reverse engineering, su dati reali del sistema, di cinque librerie di software DJ — **Rekordbox 7**, **Serato DJ Pro 4**, **Traktor Pro 4**, **Engine DJ 5** e **VirtualDJ 2026** — con l'obiettivo di stabilire se un tool esterno (CrateForge) possa scrivere brani, playlist, cue, loop e tag in modo che l'applicazione nativa li accetti.

La conclusione centrale è netta: **una sola delle cinque librerie è cifrata (Rekordbox, SQLCipher DB6), e la sua chiave è pubblica/documentabile.** Le altre quattro conservano i dati utente in chiaro (XML in chiaro per Traktor e VirtualDJ, SQLite non cifrato per Engine DJ, file binari tag+length non cifrati per Serato). In nessun caso il legame device/sessione è un vero DRM che blocchi la scrittura: si tratta al più di lock di processo (Rekordbox), di contatori di sync (Rekordbox), o di semplici concorrenza-di-scrittura (tutte). **Tutto ciò riguarda i DATI dell'utente — brani, cue, tag, playlist — non funzioni a pagamento, licenze o attivazioni del software.**

La difficoltà di scrittura cresce in un ordine preciso: **VirtualDJ (banale) < Traktor (XML in chiaro) < Serato (binario non cifrato, ma cue nei tag ID3) < Engine DJ (SQLite + BLOB zlib, ma i trigger fanno gran parte del lavoro) < Rekordbox (SQLCipher + bookkeeping USN/UUID + sidecar ANLZ/XML).**

### Tabella riassuntiva

| App | Cifratura | Chiave pubblica? | Binding device/sessione | Scrittura esterna fattibile? | Rischio |
|---|---|---|---|---|---|
| **Rekordbox 7.2.x** | Sì — SQLCipher 4 (DB6), page 4096, kdf_iter 256000, HMAC-SHA512 | Sì — passphrase `402fd4…8497`, documentata, ricavabile da `options.json` (`dp`, Blowfish) o Frida | Software/sessione: lock di **processo** ("Rekordbox running") + contatori **USN** globali/per-riga + UUID | Sì (provata su copia): API pyrekordbox + insert diretti; ricifratura automatica | **Alto** — bookkeeping USN/UUID, sidecar ANLZ/XML, de-sync cloud se sbagliato |
| **Serato DJ Pro 4.0.6** | **Nessuna** — DB V2 binario tag+len in chiaro, DJ.gai è SQLite in chiaro | N/A | **Nessuno** — no UUID, no USN, no checksum, no lock; binding al **volume** (path volume-relative) | Sì — riscrittura DB V2/crate + GEOB `Serato Markers2` nei tag ID3 | **Medio** — framing tag+len e UTF-16BE, encoder Markers2 da validare |
| **Traktor Pro 4.4.2** | **Nessuna** — `collection.nml` e `.tsi` XML in chiaro | N/A | **Nessuno** — no UUID hardware, no USN, no checksum; `AUDIO_ID` è fingerprint audio, non binding | Sì — riscrittura XML; formato DJ più semplice tra i "grandi" con cue/beatgrid | **Basso** — solo coerenza conteggi ENTRIES e path-encoding `/:` |
| **Engine DJ 5.0.0** | **Nessuna** — 8 SQLite in chiaro; solo zlib nei BLOB PerformanceData | N/A | UUID di libreria + origin tracking; **ChangeLog è uno stub VIEW vuoto** (no USN attivo), nessun lock | Sì (provata su copia end-to-end): trigger creano PerformanceData e backfill; integrity_check ok | **Medio** — re-encoding BLOB `[BE len]+zlib` (loops LE), linked-list `nextEntityId` |
| **VirtualDJ 2026** | **Nessuna** — `database.xml` XML in chiaro, `extra.db` SQLite in chiaro | N/A (SQLCipher nel binario serve solo a IMPORT di DB di terzi) | **Nessuno** — no UUID macchina, no USN; `AudioSig` è fingerprint audio | Sì — editor XML standard; bookkeeping minimo | **Basso** — solo XML ben formato + `FileSize` corretto + app chiusa |

Regola operativa comune a tutte e cinque: **lavorare su copia, con l'app chiusa, e (dove esiste) rispettare il bookkeeping di sync.** Ogni app riscrive la propria libreria alla chiusura o al commit, quindi una modifica esterna a runtime viene sovrascritta.

---

## 2. Analisi per applicazione

### 2.1 Rekordbox 7.2.14 / 7.2.16 (macOS)

#### Storage
La libreria vive in `/Users/dj-john/Library/Pioneer/rekordbox/`. Il database principale è **`master.db` (300 MB), un SQLite cifrato con SQLCipher**. pyrekordbox 0.4.3 rileva la config come `rekordbox7` (version=7, install_dir `/Applications/rekordbox 7`, db_path `.../master.db`), ma **schema e chiave appartengono alla famiglia "DB6"**.

Dati fuori dal DB:
- **ANLZ per-brano** in `share/PIONEER/USBANLZ/<hex>/<uuid>/ANLZ0000.DAT` e `.EXT` — binari big-endian, magic `PMAI`, sezioni `PPTH` (path), `PQTZ` (beatgrid), `PCOB` (cue base), `PWAV`/`PWV3-5` (waveform). La `.EXT` aggiunge `PCO2` (cue nexus2 con colore+commento) e `PSSI` (phrase).
- **`masterPlaylists6.xml`** — albero playlist; `Timestamp` in ms, `Attribute` 0=playlist / 1=folder, `Lib_Type`/`CheckType`.
- **`options.json`** in `~/Library/Application Support/Pioneer/rekordboxAgent/storage/`.
- Backup automatici `master.backup*.db` nella stessa cartella.

Tabelle chiave (pyrekordbox `db6/tables.py`): `DjmdContent` (brani), `DjmdPlaylist` (playlist/folder/smart), `DjmdSongPlaylist` (membership + `TrackNo`), `DjmdCue` (memory/hot cue + loop), `DjmdHotCueBanklist`/`DjmdSongHotCueBanklist`, `DjmdMyTag`/`DjmdSongMyTag`, `DjmdColor`, `AgentRegistry` (contatori sync globali), `uuidIDMap`.

#### Cifratura — e chiave pubblica
**Sì, cifrato con SQLCipher 4.** Parametri confermati via `PRAGMA` sulla copia: `cipher_version` 4.6.1, `cipher_page_size` 4096, `kdf_iter` 256000, `cipher_kdf_algorithm` PBKDF2_HMAC_SHA512, `cipher_hmac_algorithm` HMAC_SHA512. **Prova header** (`xxd -l16`): `7782 f1a3 f152 9ba0 895a ebb2 e810 4fdd` — nessun magic "SQLite format 3" perché anche la pagina 1 è cifrata (salt casuale).

La chiave **protegge i dati dell'utente** (brani/cue/playlist), **non licenze**, ed è **pubblica/documentata**. Passphrase DB6:

```
402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497
```

Attenzione: è una **passphrase SQLCipher**, non la chiave AES raw. SQLCipher la passa in PBKDF2 sui default 4.x; `PRAGMA key='402fd...'` apre il DB e legge `sqlite_master` (385 righe) senza altri pragma. pyrekordbox valida i primi 5 char (`402fd`).

**Derivazione della chiave**: in `options.json` c'è il campo `dp` (`"FJ9s0iA+hiPZgURNVQNg+Aj/UQ41...=="`, base64, Blowfish-ECB). `pyrekordbox/config.py` `_update_sqlite_key` estrae la password Blowfish da `app.asar` dell'app (`_extract_pw`), poi `blowfish.Cipher(pw).decrypt_ecb(b64decode(dp))` → ottiene la stringa `402fd...`. In alternativa la ricava per code-injection Frida su `sqlite3_key`. La cache la salva in `~/Library/Application Support/pyrekordbox/rb.cache` (contenuto reale: `version: 2\ndp: 402fd482...8497`). All'apertura crea l'engine SQLAlchemy con URL `sqlite+pysqlcipher://:{key}@/{path}?`.

#### Binding device/sessione
La libreria **NON è legata a device/HWID**: la stessa chiave apre la copia in `/tmp`. Il legame è **software/sessione** via due meccanismi:

1. **Lock "Rekordbox running"** — pyrekordbox chiama `get_rekordbox_pid()`; se il processo è vivo, `database.commit()` lancia `RuntimeError("Rekordbox is running. Please close Rekordbox before commiting changes.")`. Sul sistema reale `get_rekordbox_pid()=22053`. **Non è un file-lock sul DB, è un check di processo.**
2. **Sync/USN** — contatore globale monotono in `AgentRegistry` (row `id='localUpdateCount'`, valore in `int_1`) + per-riga `usn`/`rb_local_usn`. Le righe hanno UUID (VARCHAR) globalmente unici. Il campo `usn` (cloud/mobile sync) resta `None` finché non avviene sync cloud; `rb_local_usn` è il contatore locale. `rb_data_status`/`rb_local_data_status`/`rb_local_deleted`/`rb_local_synced` tracciano lo stato di sync verso Rekordbox Cloud/dispositivi.

#### Come scrivere dati validi
API alto livello (pyrekordbox 0.4.3): `db.create_playlist` / `create_playlist_folder`, `db.add_to_playlist`, `db.add_content`, `db.add_album`, e insert diretti su qualsiasi tabella con `Table.create(...)` + `db.add()`. Il commit ricifra trasparentemente (l'engine sqlcipher tiene la chiave; ogni pagina scritta passa dal cifrario).

**Prova scrittura playlist su COPIA `/tmp/rbtest/master.db`**: `create_playlist('CRATEFORGE_TEST')` → nuovo ID `174449755`, UUID `b52ce3eb-…`, `Seq 46`; `commit()`: USN globale `4461760 → 4461762` (delta 2). Riaprendo una nuova sessione, `4461762` era persistito e l'header restava cifrato SQLCipher = ricifratura OK.

**Inserire un `DjmdCue` valido** (testato, delta USN 1, `rb_local_usn 4461763`):

| Campo | Valore |
|---|---|
| `ID` | `generate_unused_id(DjmdCue)` (stringa) |
| `ContentID` | `DjmdContent.ID` del brano |
| `ContentUUID` | `DjmdContent.UUID` |
| `InMsec` | posizione in ms |
| `InFrame` | `round(InMsec * 0.15)` — frame a 150 fps (prova: In=55634/Frame=8345; In=73274/Frame=10991 → rapporto esatto 0.1500) |
| `OutMsec` / `OutFrame` | `-1` / `0` per cue/hotcue non-loop |
| `Kind` | `0` = memory cue (`Kind>0` = hot cue; nei dati reali compare anche `Kind=9`) |
| `Color` / `ColorTableIndex` | `-1` / `0` |
| `ActiveLoop` | `0` |
| `InMpegFrame`/`InMpegAbs`/`OutMpegFrame`/`OutMpegAbs` | `0` |
| `Comment` | `''` |
| `BeatLoopSize`/`CueMicrosec` | `0` |
| `InPointSeekInfo`/`OutPointSeekInfo` | `''` |
| `UUID` | `uuid4` |
| `rb_data_status`/`rb_local_data_status`/`rb_local_deleted`/`rb_local_synced` | `0` |
| `usn` | `None` (lo mette il commit come `rb_local_usn`) |
| `created_at`/`updated_at` | `now` |

#### Bookkeeping necessario
Per ogni scrittura accettata:

1. **Incremento USN globale**: leggere `AgentRegistry` row `'localUpdateCount'`.`int_1`, incrementarlo, assegnarlo a `rb_local_usn` di **ogni** riga toccata. pyrekordbox lo fa in `commit()` via `registry.autoincrement_local_update_count(set_row_usn=True)`: 1 USN per operazione tracciata (create/update/delete/move).
2. **UUID**: `uuid4` per la colonna `UUID` di ogni nuova riga.
3. **ID primario**: `generate_unused_id()` → ID pseudo-casuale a 28 bit (≥100, verificato non usato).
4. **Timestamp**: `created_at`/`updated_at = datetime.now()`.
5. **`masterPlaylists6.xml`**: per le playlist va aggiunto/aggiornato il NODE (`Id` in hex maiuscolo, `Timestamp` in ms). Prova: la copia XML è passata da 160 a 161 NODE, con `Id="A65E45B"` (=174449755) `ParentId="0"` `Attribute="0"` `Timestamp="1784075377388"`.
6. **Ricifratura**: automatica via SQLCipher, nessun passo manuale.

> Nota sul `delta USN = 2` di `create_playlist`: è il pattern di pyrekordbox (crea con `Name='New playlist'` poi rinomina). Un insert diretto minimale conta **1 USN per operazione**, come visto per `DjmdCue`.

#### Cosa si rompe
| Errore | Conseguenza |
|---|---|
| Commit con Rekordbox aperto | `RuntimeError` dal lock (protezione anti-corruzione; l'app può avere WAL/pagine in memoria e sovrascrivere) |
| USN globale non incrementato / `rb_local_usn` incoerente | **De-sync** con Rekordbox e Cloud/dispositivi: modifiche ignorate, sovrascritte o duplicate; possibile perdita dati cloud |
| UUID mancante/duplicato | Collisioni, comportamento indefinito nel merge di sync |
| Foreign key invalide (`ContentID`/`ContentUUID` inesistenti) | Righe orfane, cue non mostrate, rifiuto/crash in import |
| `masterPlaylists6.xml` non aggiornato | pyrekordbox avvisa "not found in masterPlaylists6.xml"; Rekordbox può non mostrarla/sincronizzarla |
| Disallineamento DB↔ANLZ | Modificare `DjmdCue` **non** aggiorna i file ANLZ; i CDJ/export leggono cue/waveform/beatgrid dagli ANLZ → cue scritti solo nel DB possono non comparire su USB finché Rekordbox non ri-analizza |
| `InFrame` non coerente (rapporto ≠ 0.15) | Posizione cue errata sulla forma d'onda |
| Scrivere SQLite in chiaro (salto ricifratura) | Rekordbox non apre più il DB |

#### Prior art
**pyrekordbox** (Dylan Jones, MIT) è il riferimento OSS: chiave (`config._update_sqlite_key`), engine sqlcipher via SQLAlchemy, bookkeeping USN in `db6/registry.py` (`RekordboxAgentRegistry` con `on_create`/`on_update`/`on_delete`/`on_move` + `autoincrement_local_update_count`), sync di `masterPlaylists6.xml` in `db6/aux_files.py` (`MasterPlaylistXml.add/update/remove/save`) e `smartlist.py`. Modulo `pyrekordbox/anlz` per ANLZ (`file.py`: `build()`/`save()`/`set_path()`, `structs.py` per `PMAI/PQTZ/PCOB/PCO2/PWAV/PSSI`). Altri: **crate-digger / Deep-Symmetry** (Java, RE di ANLZ ed `export.pdb`/DeviceSQL), **rekordcrate** (Rust, holzhaus).

---

### 2.2 Serato DJ Pro 4.0.6 (build 4.0.6.307)

> **Correzione applicata (prevale sui dati originali).** L'affermazione di rischio secondo cui "nessun brano aveva cue impostati (0 file con GEOB Markers), quindi non ho potuto campionare un `Serato Markers2` autentico" è **SMENTITA**. Scansione reale con mutagen 1.47.0 su `/Users/dj-john/Music` (4722 file audio): **96 file con GEOB `Serato Markers2`**, 96 con legacy `Serato Markers_`, **95 con ≥1 hot cue realmente scritti da Serato** (es. `.../DARIO CAMINITA/CLASSIC REVIBES COLLECTION VOL 13 MP3/Madonna - Open Your Heart (Dario Caminita Revibe).mp3`, 8 hot cue colorati con label "Cue 1..8"). Un campione autentico era abbondantemente disponibile.

#### Storage
Bundle `com.serato.seratodj`, `/Applications/Serato DJ Pro.app`. Libreria in `/Users/dj-john/Music/_Serato_` (copiata read-only in `/tmp/serato_work`). **NON è un DB relazionale, ma file binari proprietari** sotto una cartella `_Serato_` per volume.

- **`database V2`** (1972 byte): formato binario **TAG+LENGTH**. Ogni campo = 4 byte ASCII tag + 4 byte big-endian length + payload. Header con tag `vrsn`, payload UTF-16BE `"2.0/Serato Scratch LIVE Database"`. Un record traccia = tag `otrk` (length `0x03bd`) con sotto-campi: `ttyp`(mp3), `pfil`(path), `tsng`(title), `tart`, `talb`, `tgen`, `tlen`, `tsiz`, `tbit`, `tsmp`, `tbpm`, `tcom`, `tlbl`, `tcmp`, `ttyr`, `tadd`, `tkey`, + campi u32 (`uadd`,`utkn`,`utme`,`ufsb`,`udsc`,`utpc`) e boolean 1-byte (`bhrt`,`bmis`,`bply`,`blop`,`bitu`,`bovc`,`bcrt`,`biro`,`bwlb`,`bwll`,`buns`,`bbgl`,`bkrk`). **Testo in UTF-16 BIG-ENDIAN** (`00 53 00 65` = 'S''e').
- **Crate**: `Subcrates/*.crate` (stesso tag+len: `vrsn`, `ovct`/`tvcn`/`tvcw` definizioni colonne, `otrk`>`ptrk` path per riga). `SmartCrates/*.scrate` per smart crate. `neworder.pref` = ordinamento (qui 0 byte).
- **Cue/hotcue/loop/beatgrid/overview NON stanno nel DB V2 ma dentro il file audio come frame ID3 GEOB**: `Serato Autotags`, `Serato BeatGrid`, `Serato Overview` (+ TXXX `SERATO_PLAYCOUNT`, `Serato Analysis Flags`). `Serato Markers2` e `Serato Markers_` compaiono quando l'utente ha impostato cue.
- **`DJ.gai`**: SQLite plain (indice ricerca/analisi, tabelle `hits`, `properties`), **non** è la libreria primaria.

> **Perimetro (sfumatura, non salva l'affermazione originale).** La cartella `/Users/dj-john/Music/_Serato_` è quasi vuota: `database V2` referenzia solo 2 brani (Funk & Disco), entrambi senza Markers2/cue; `Subcrates` non contiene `.crate`. Ma i 96 file cue-ati stanno nell'albero musicale, e il reader stesso scandisce la cartella per i GEOB non nel DB, quindi rientrano nel perimetro operativo.

#### Cifratura
**NESSUNA**, verificato sui byte reali:
- `database V2`: plaintext binario tag+len, leggibile con `xxd`/`strings`.
- `Subcrates/*.crate`: plaintext binario.
- `DJ.gai`: magic `53 51 4c 69 74 65 20 66 6f 72 6d 61 74 20 33 00` = `SQLite format 3` (NON `SQLCipher`/`Salted__`).
- GEOB: plaintext. `BeatGrid`/`Overview`/`Autotags` sono binari raw con header versione (es. BeatGrid inizia `01 00...`). `Serato Markers2` è base64 ASCII con header versione `01 01`.

Nessuna chiave, nessun cifrario. A differenza di Rekordbox, **Serato non cifra affatto i dati utente.**

#### Binding device/sessione
**NESSUNO.** Nessun UUID, nessun USN/sync counter, nessun checksum/CRC, nessun lock. La coda di `database V2` finisce pulita sull'ultimo boolean `bkrk` (`00 00 01 00`) senza hash/CRC trailer.

Il legame è al **volume/drive**, non al device: una cartella `_Serato_` per disco, e i path traccia sono **relativi alla radice del volume, senza slash iniziale**. Prova in `pfil`: UTF-16BE `"Users/dj-john/Music/Music/Media.localized/..."` (inizia con 'U' di Users, non con '/'). Serato risolve come `<mountpoint>/<pfil>`. Portando il disco su un altro Mac, la libreria resta valida. I GEOB nei file audio sono self-contained e seguono il file ovunque.

#### Come scrivere dati validi
- **Brani/tag/beatgrid** nel `database V2`: riscrivere l'intero file serializzando i record `otrk` col formato tag(4B ASCII)+len(4B BE)+payload; testo in UTF-16BE. Nessun contatore/checksum.
- **Playlist**: scrivere/riscrivere `Subcrates/<nome>.crate` (`otrk`>`ptrk` con path volume-relative, senza slash iniziale) + opzionalmente `neworder.pref`.
- **Cue/hotcue/loop/color**: ri-encodare il frame GEOB `Serato Markers2` (base64) e il legacy `Serato Markers_`, scritti con mutagen ID3.

**Struttura Markers2** (verificata contro i file reali, vedi Bookkeeping): corpo `\x01\x01` + sequenza entry `[name\0 + u32 len + payload]` + terminatore `\x00`, poi base64 wrappato, prefisso esterno `\x01\x01`. Entry osservate: `COLOR`, `CUE` (indice + `pos_ms` + rgb + nome), `BPMLOCK`.

Verifica round-trip su copia in `/tmp`: risalvando con mutagen i frame `Serato Autotags`/`BeatGrid`/`Overview` restano **byte-identici** dopo save/reload; mutagen preserva esattamente i GEOB.

#### Bookkeeping necessario
Molto leggero: **no USN/UUID/checksum/cifratura**.
- `database V2` / crate: serializzazione corretta tag+length big-endian, testo UTF-16BE, ricalcolo delle length dei contenitori (`otrk`, `ovct`).
- Path: volume-relative **senza slash iniziale**, altrimenti il match fallisce.
- Cue (Markers2): rigenerare il body base64, re-wrappare a 72 char per linea con `\n`, riaggiungere il prefisso `\x01\x01`.
- Mantenere coerenti gli altri GEOB (`BeatGrid`/`Overview`/`Autotags`) e replicare i cue nel legacy `Serato Markers_`.
- Scrivere via ID3 con mutagen (encoding raw, mime `application/octet-stream`, desc esatto `Serato Markers2`, filename vuoto).

> **Validazione contro file reali (i 3 punti che la premessa originale diceva "da validare"):**
> - **Header `\x01\x01`**: **CONFERMATO** — versione GEOB esterna `0101` in 96/96; header interno del corpo decodificato `0101` in 96/96.
> - **Wrapping base64 a 72**: **CONFERMATO** — tutte le righe intermedie esattamente 72 char (204 righe intermedie).
> - **Gruppo finale/padding**: la convenzione dominante (94/96) è **base64 standard con padding `=`** (lunghezza mod4=0) terminato da newline `\x0a`, **senza null finali**. Solo 2/96 file usano null-padding fino a un frame di dimensione fissa (payload 470B), e uno solo (Dance Monkey) mostra il "gruppo parziale" (b64 pre-null lunga 349, mod4=1). **Un encoder che emette base64 `=`-paddato + newline finale combacia con 94/96.** Questa è una correzione rispetto all'assunzione del reader `parse_serato_markers2` ("gruppo parziale + null padding"), che è in realtà il caso minoritario.
>
> **Nel repo esiste solo un reader (`parse_serato_markers2`), nessun encoder.** L'asserzione "il mio encoder è round-trip byte-identical su se stesso" non è verificabile dai file presenti (codice inesistente). La prudenza epistemica resta ragionevole, ma la motivazione fattuale ("0 file con cue") è falsa.

#### Cosa si rompe
| Errore | Conseguenza |
|---|---|
| Framing tag/length errato in `database V2`/crate | Serato salta il campo/record malformato o ignora la traccia (parser si desincronizza) |
| Testo non UTF-16BE o length sbagliata | Titoli/artisti corrotti o troncati |
| Path con slash iniziale / non volume-relative | Traccia non associata al file (offline/mancante) |
| Markers2 base64 malformato / padding sbagliato | Cue scartati; Serato può ri-analizzare e sovrascrivere i tuoi cue al prossimo caricamento |
| Scrittura ad app aperta | Serato riscrive `database V2` e sovrascrive le tue modifiche |

Nessuna corruzione a cascata (no de-sync/USN): il rischio è **locale al file toccato**.

#### Prior art
- **serato-tools** (Python): legge/scrive `database V2`, crate e i GEOB incl. `Serato Markers2`/`Markers_` con mutagen; gestisce base64 e gruppo finale (es. `kj4ezj/serato-tools`).
- **triseratops** (Rust) e la spec **`serato-tags` di Jan Holzhaus** (`github.com/Holzhaus/serato-tags`): spec definitiva dei formati GEOB e del `database V2`/crate; fonte primaria per il layout entry cue/loop/color/bpmlock.
- **seratopy** e script community per import/export crate.
- Nel sidecar del progetto è installato **mutagen 1.47** (usato per la verifica). `construct 2.10` utile per il tag+len.

---

### 2.3 Traktor Pro 4 (v4.4.2)

#### Storage
Libreria = **un unico file XML in chiaro**: `collection.nml` (6.596.610 byte, 44.669 righe, `ENTRIES=4735`), in `/Users/dj-john/Documents/Native Instruments/Traktor 4.4.2/`. Radice `<NML VERSION="20">` con `<HEAD COMPANY/PROGRAM>`, `<COLLECTION>` (una `<ENTRY>` per brano), `<PLAYLISTS>` (albero `<NODE TYPE="FOLDER|PLAYLIST|SMARTLIST">` con `<SUBNODES COUNT>`), `<INDEXING>`, `<SETS>`.

Ogni `ENTRY` contiene `LOCATION`, `ALBUM`, `MODIFICATION_INFO`, `INFO`, `TEMPO`, `LOUDNESS`, `MUSICAL_KEY` e N × `CUE_V2` (con `GRID` annidato per il beatgrid). I settings sono un secondo XML in chiaro **`Traktor Settings.tsi`** (formato NIXML: `<Entry Name=... Type=... Value=...>`). Dati collaterali: `Coverart/`, `Stripes/` (waveform), `Transients/`, `History/`, `Logs/`. Backup versionati per timestamp in `Backup/Collection/collection_2026y07m15d_01h11m39s.nml` e `Backup/Settings/`.

#### Cifratura
**NESSUNA.** `collection.nml` e `.tsi` sono XML in chiaro (leggibili con `head`/`strings`/`xxd`). Nessun cifrario, blob compresso o chiave. L'unico dato "opaco" è l'attributo `AUDIO_ID` (~350 char base64 per ENTRY): **non è cifratura ma un fingerprint acustico/spettrale proprietario NI derivato dal contenuto audio** (deterministico dal file, non dal device). È opzionale: Traktor lo rigenera in analisi.

#### Binding device/sessione
**NON legata a device/sessione.** Verificato:
1. Nessun UUID di macchina/serial hardware nel NML (i soli UUID sono `PLAYLIST`/`SMARTLIST` casuali per-lista, es. `faa9652b6b1a4cdaacbda095ed3ff114`).
2. Nessun USN / sync counter / revision number globale.
3. Nessun checksum/hash/CRC/signature: i match `grep` "CRC" sono sottostringhe casuali dentro i blob base64 `AUDIO_ID` (contesto `...TJTRSRCRCUw==`).
4. I tag radice `NML`/`HEAD`/`COLLECTION` non hanno attributi di integrità (solo `VERSION="20"`, `COMPANY`, `PROGRAM`, `ENTRIES`).

Presente `<ENTRY LOCK="1" LOCK_MODIFICATION_TIME="...">`, ma è un flag di "lock edit" **per-brano dell'utente**, non un lock di device. Il conteggio `COLLECTION ENTRIES="4735"` deve essere coerente ed è l'unico bookkeeping vero.

#### Come scrivere dati validi
Per una `ENTRY` brano valida:
- `<LOCATION DIR FILE VOLUME VOLUMEID>` con path **Traktor-encoded** (separatore `/:` + prefisso; es. `DIR="/:Library/:Application Support/:Native Instruments/:Traktor Pro 4/:Factory Sounds/:"`, `FILE="Bumpin Flava - Bumpy.mp3"`, `VOLUME="Macintosh HD"`, `VOLUMEID="Macintosh HD"`).
- `INFO` (`BITRATE`, `PLAYTIME`/`PLAYTIME_FLOAT`, `IMPORT_DATE`, `FLAGS`, `FILESIZE`, opz. `KEY`/`LABEL`/`COVERARTID`).
- `TEMPO BPM`; opzionali `LOUDNESS`, `MUSICAL_KEY VALUE` (0-23).

**Cue**: `<CUE_V2 NAME DISPL_ORDER TYPE START LEN REPEATS HOTCUE>` con `START` in **millisecondi float**, `HOTCUE=-1` per memory cue senza slot o 0-7 per hotcue; `TYPE` 0=cue, 4=grid, 5=load, 1=fade-in, ecc. Il beatgrid è un `CUE_V2 TYPE="4" NAME="AutoGrid"` con `<GRID BPM>` annidato.

**Playlist**: `<NODE TYPE="PLAYLIST" NAME><PLAYLIST ENTRIES TYPE="LIST" UUID><ENTRY><PRIMARYKEY TYPE="TRACK" KEY="Macintosh HD/:Library/:.../:file.mp3">` — il `KEY` usa **VOLUME + path concatenati** (non `DIR`/`FILE` separati) e deve corrispondere esattamente alla `LOCATION` del brano in `COLLECTION`. `AUDIO_ID` può essere omesso.

#### Bookkeeping necessario
Minimo (no crypto/sync):
1. `COLLECTION ENTRIES` = numero reale di `<ENTRY>`.
2. `PLAYLIST ENTRIES` e `SUBNODES COUNT` = conteggi reali dei figli.
3. I `PRIMARYKEY KEY` delle playlist devono matchare byte-per-byte la `LOCATION` (`VOLUME` + `/:` + `DIR` + `FILE`).
4. UUID (32 hex) per ogni nuova `PLAYLIST`/`SMARTLIST`.
5. `MODIFIED_DATE` formato `YYYY/M/D` **senza zero-pad** (es. `2026/7/14`); `MODIFIED_TIME` = **secondi dalla mezzanotte locale** (es. `73310` ≈ 20:21:50).
6. Escaping XML corretto, encoding UTF-8.

Non servono: ricalcolo hash, incremento USN, rigenerazione `AUDIO_ID`, ricifratura. Buona pratica: lasciare a Traktor la generazione di `AUDIO_ID`/`Stripes` via analisi.

#### Cosa si rompe
Traktor rilegge `collection.nml` a ogni avvio e lo riscrive a modifiche/uscita (evidenza: backup versionati). XML malformato o path-encoding sbagliato → brano `"!"` (non trovato) o intera collezione non carica. `ENTRIES` errato → incoerenza, possibile troncamento/re-scan. `PRIMARYKEY` senza `LOCATION` corrispondente → voce sparisce **silenziosamente** dalla playlist. `START` in unità sbagliate (secondi vs ms) → cue mal posizionati. **Nessun checksum**, quindi una modifica esterna non è rifiutata per integrità — il rischio è solo di parsing/coerenza. **Non toccare il file mentre Traktor è aperto** (lo sovrascrive alla chiusura).

#### Prior art
- **traktor-nml-utils** (wolkenarchitekt, Python): parser/serializer read-write del NML, dataclass per `ENTRY`/`CUE_V2`/playlist; gestisce l'encoding `/:` e il round-trip XML.
- **Mixxx** (OSS): importa `collection.nml` (beatgrid/cue/playlist).
- Tool commerciali (**Lexicon**, **rekordcloud/MIXO**, DJ Conversion Utility) scrivono NML validi Traktor↔Rekordbox/Serato.

Traktor **NON richiede alcun bookkeeping crittografico**: è il formato di libreria DJ più semplice da scrivere tra i quattro maggiori (insieme a VirtualDJ).

---

### 2.4 Engine DJ 5.0.0 (schema 3.0.2)

#### Storage
**Database SQLite 3 in chiaro** sotto `/Users/dj-john/Music/Engine Library/Database2/`. Verificato: ogni file inizia con ASCII `"SQLite format 3\0"`. Libreria principale **`m.db` (224 MB, 4397 tracce)**.

Tabelle core in `m.db`:
- `Track` (metadata + path/filename; UNIQUE su path, e UNIQUE su `originDatabaseUuid`+`originTrackId`).
- `PerformanceData` (1:1 con `Track` via `trackId` PK; contiene i BLOB cue/beatgrid/waveform).
- `Playlist` (folder+crate, linked list via `nextListId`).
- `PlaylistEntity` (membership, linked list via `nextEntityId`).
- `Smartlist` (smart crate UUID-based con regole).
- `Pack` (0 righe, bookkeeping consolidated-drive), `AlbumArt`, `Information` (1 riga: UUID libreria + `schemaVersion`).

Sub-database (ognuno una libreria SQLite completa con proprio UUID, schema 3.0.2): `rbm.db` = mirror import Rekordbox (UUID `78210615-…`, 4169 tracce; legato a `Information.lastRekordBoxLibraryImportReadCounter` in `m.db`); `hm.db` = mirror history (aggiunge `Historylist`/`HistorylistEntity`); `fsm.db`/`itm.db`/`sm.db`/`stm.db`/`trm.db` = piccoli (~124 KB) mirror per sorgente streaming (Amazon Music, Beatport/Beatsource LINK, SoundCloud, TIDAL). `OverviewData/` e `Artwork/` contengono waveform-overview e artwork referenziati dal DB.

#### Cifratura
**NESSUNA.** Tutti gli 8 DB aprono con `/usr/bin/sqlite3` senza chiave/PRAGMA; ogni file inizia col magic `SQLite format 3\0`. Nessuna stringa `PRAGMA key`/`sqlcipher` nel binario. L'unica compressione è **zlib per-colonna dentro i BLOB `PerformanceData`** — non cifratura.

#### Binding device/sessione
Legame **lasco via UUID, NON un DRM/lock/checksum/USN che gati le scritture.** Ogni DB porta un UUID di libreria in `Information` (`m.db` = `fc18a8c8-b559-4fbe-a8c8-b67f52664a5f`). Il merge cross-drive è fatto per **origin tracking**, non per sync counter: `Track.originDatabaseUuid` + `Track.originTrackId` (UNIQUE insieme) registrano da quale libreria proviene la traccia; `PlaylistEntity.databaseUuid` tagga ogni riga di membership con la sua libreria sorgente.

**Non c'è tabella ChangeLog/USN popolata**: `ChangeLog` è ora solo uno stub VIEW (`CREATE VIEW ChangeLog (id, trackId) AS SELECT 0,0 WHERE FALSE`; 0 righe) — il binario mostra che fu **DROP-pata come tabella reale** e sostituita dalla view migrando a schema 3.x, rendendo obsolete le note "ChangeLog per multi-device sync". `Pack` (`changeLogDatabaseUuid`/`changeLogId`) esiste per il packing ma è vuota. Niente checksum/lock; scrivere non richiede riprodurre alcun token device/sessione.

#### Come scrivere dati validi
Provata end-to-end su copia `/tmp`:
1. **`Track` INSERT**: colonne minime (`path`, `filename`, `title`, `artist`, `bpmAnalyzed`, `length`) → nuovo `id 4398` auto-assegnato.
2. **`PerformanceData` è creata per te** — trigger `AFTER INSERT` su `Track` esegue `INSERT INTO PerformanceData(trackId)`; verificato che la riga appare automaticamente.
3. **BLOB cue/beatgrid** scrivibili: le colonne `quickCues`/`beatData` usano `[4-byte BIG-ENDIAN uncompressed-length][zlib stream]` (es. header `quickCues` `000000a9` = 169 byte decompressi, poi `789c` zlib). `loops` usa un layout **LITTLE-ENDIAN non compresso** (no zlib; leading count byte poi IEEE double). `quickCues` decodificato = fino a **8 slot hot-cue**, ognuno: 1-byte label length + label (`"Cue 1"`) + 8-byte BE double position(ms) + 4-byte color; slot vuoti portano `-1.0` (`bff0000000000000`).
4. **Playlist + membership**: INSERT `Playlist` (`parentListId`, `nextListId`) poi `PlaylistEntity` (`listId`, `trackId`, `databaseUuid`, `nextEntityId`) — entrambi riusciti; la view `PlaylistPath` ha risolto il nome del crate; la catena linked ha camminato completa. `PRAGMA integrity_check` = ok; `PRAGMA foreign_key_check` = nessuna violazione.

#### Bookkeeping necessario
Gran parte è **automatizzata dai trigger** — è il finding chiave. **Devi**:
- (a) `Track.id` strettamente maggiore di `sqlite_sequence.seq` per `Track` (attualmente 4397) — il riciclo di id cancellati è bloccato da un trigger; usa AUTOINCREMENT / lascia assegnare a SQLite.
- (b) **Re-encodare i BLOB esattamente**: `quickCues`/`beatData` = `struct.pack('>I', len(decompressed)) + zlib.compress(decompressed)`; `loops` = LE, non compresso. Uno zlib stream fresco va bene (verificato: il blob ricompresso differisce byte-per-byte da quello dell'app ma si decomprime in payload identico).
- (c) **Mantenere tu la linked-list dove nessun trigger aiuta**: `PlaylistEntity` ha un trigger AFTER-DELETE che ripara `nextEntityId`, ma **nessun trigger di insert** — per appendere una traccia devi settare il `nextEntityId` della vecchia coda al nuovo entity id e dare al nuovo `nextEntityId=0` (coda). La testa = l'entity il cui id non è mai referenziato come `nextEntityId`.
- (d) `PlaylistEntity.databaseUuid` = l'UUID di `Information` per le tracce locali.

Cosa fanno i trigger **automaticamente**: creano `PerformanceData` all'insert di `Track`; backfill di `Track.originDatabaseUuid = (SELECT uuid FROM Information)` e `originTrackId = id` se lasciati NULL; risolvono collisioni di unicità su `Playlist.nextListId` all'insert (trucco swap `-(1+nextListId)`); bump di `Track.lastEditTime` sugli edit. **Nessuna generazione UUID, incremento USN, ricifratura o scrittura ChangeLog richiesta.**

#### Cosa si rompe
| Errore | Conseguenza |
|---|---|
| Riuso id `Track` cancellato | `RAISE(ABORT)` "Recycling deleted track id's are not allowed" |
| Cambio id `Track` esistente | Abort |
| `Track.path` duplicato | UNIQUE fail |
| Due entity con stesso (`listId`,`databaseUuid`,`trackId`) | UNIQUE fail |
| (`parentListId`,`nextListId`) duplicato bypassando i trigger | UNIQUE fail |
| Prefisso 4-byte length errato / zlib troncato-invalido | Prime non parsa quella `PerformanceData` → cue/beatgrid/waveform **spariscono silenziosamente** per la traccia |
| LE per `quickCues`/`beatData` (sono BE) o BE per `loops` (è LE) | Posizioni cue spazzatura |
| Catena `nextEntityId`/`nextListId` rotta (dangling/ciclo/due code) | Tracce spariscono dal crate o ordine errato |
| `originDatabaseUuid`/`originTrackId` errati | Misbehavior di merge-duplicati su altro device |

Nessuno di questi corrompe il file SQLite: `integrity_check` è rimasto "ok".

#### Prior art
Formato non cifrato → i tool leggono/scrivono senza chiave. **Mixxx** ha un importer Engine DJ (`EngineDjLibraryFeature` legge `m.db` inclusi i BLOB zlib `PerformanceData`, beatgrid e hot cue) — il riferimento più chiaro per il layout on-disk. Gli sforzi community "engine library" / **engine-prime** documentano lo stesso encoding `[BE length + zlib]` e le linked-list `nextListId`/`nextEntityId`. Per il lato rete (non il file DB): **StagelinQ** (es. `icedream/go-stagelinq`). Engine è più semplice sia di Rekordbox (SQLCipher + USN) sia di Serato (GEOB) perché non c'è cifratura né ChangeLog/USN popolato — i trigger assorbono la maggior parte degli invarianti.

---

### 2.5 VirtualDJ 2026 (build 8.5.8769 / 850.9246)

#### Storage
Bundle `com.atomixproductions.virtualdj`, `/Applications/VirtualDJ.app`. Libreria in `/Users/dj-john/Library/Application Support/VirtualDJ/`. **In chiaro, nessun DB proprietario cifrato.**
- **`database.xml`** (11 KB): XML UTF-8, root `<VirtualDJ_Database Version="2026">`. Un `<Song FilePath="..." FileSize="...">` per brano, con figli `<Tags>`, `<Infos>`, `<Scan>` e N `<Poi>`. `FilePath` = path **assoluto POSIX**; `FileSize` = byte reali (es. `14090421` per un mp3 ~13,4 MB).
- **`Folders/Filters/*.vdjfolder`** (7 file, 90-110 byte): XML `<FilterFolder filter="..." scope="database"/>` — sono **smartlist** (filtri), non playlist manuali (es. `filter="top 50 first seen"`, `"bpmdiff<=4 and keydiff=0"`, `"group by genre"`).
- **`extra.db`** (36 KB): SQLite **non cifrato** (header regolare). Tabelle `track_data`(sid,file,filesize,artist,title,remix), `related_tracks`(sid1,sid2), `lyrics`(lid BLOB, xml). Cache secondaria via `sid`.
- `settings.xml`, `systemreport_session.txt`: config/report. `Backup/*.zip`: copie automatiche di `database.xml` + `extra.db` + Folders.
- Playlist manuali (`VirtualFolder`) e liste live vanno in `MyLists/`, `History/`, `Sideview/` (qui vuote).

#### Cifratura
**NESSUNA** sui dati libreria. `database.xml` e i `.vdjfolder` sono XML in chiaro; `extra.db` è SQLite in chiaro. Nessun attributo checksum/hash/firma (grep checksum/md5/sha/crc = 0 hit).

> **Falso positivo da evitare**: il binario VirtualDJ contiene SQLCipher (`PBKDF2_HMAC_SHA1`, `sqlcipher_openssl_kdf`), primitive OpenSSL (SHA1/DSA-SHA1/ECDSA-SHA1) e la stringa SQL `"UPDATE content SET ... masterDbId ..."`. Questi **NON riguardano il DB VirtualDJ**, ma servono a (a) leggere/scrivere librerie di **altri** software in import/export (Engine DJ `e.db` usa lo schema "content"; Rekordbox DB6 usa SQLCipher) e (b) rete/licensing. **Lo store proprio resta plaintext.** VirtualDJ è a sua volta prior art di lettura di quei formati, a conferma che le chiavi/schemi di quei DB sono pubblici.

#### Binding device/sessione
**Nessuno** sui dati. `database.xml` non ha UUID macchina, userid, counter USN/sync o lock. L'unico identificatore per-brano è **`AudioSig`** (fingerprint audio 24 char base64, es. `"eOG4xcZxd9mn1e7G1tIQAZMK"`) calcolato dal contenuto, non dalla macchina. Il `systemreport` elenca hardware (M3 Pro, DDJ-GRV6) ma è solo diagnostica. Nessun cloud-lock obbligatorio (CloudDrive è opzionale). Il vero gate **non è crittografico ma di concorrenza**: VirtualDJ tiene la libreria in RAM e **riscrive `database.xml` all'uscita/periodicamente**; modifiche a runtime vengono sovrascritte.

#### Come scrivere dati validi
Con un editor XML/SQLite standard, senza RE di formati binari. Per un `<Song>` valido:
- `FilePath` **assoluto** + `FileSize` in byte (chiave d'identità del brano).
- `<Tags Author/Title/Album/Genre/Year/Key/Flag>`.
- `<Infos SongLength(sec, float .3f)/FirstSeen/LastModified/Bitrate/Cover>` (epoch unix per i timestamp).
- `<Scan Version/Bpm/Phase/AltBpm/Volume/Key/AudioSig/Flag/BeatGrid>` — se ometti `Scan`/`AudioSig`, VirtualDJ ri-analizza al primo caricamento ma **conserva i tuoi Tag/POI**.
- `<Poi>` con `Pos` in **secondi** (float). Tipi confermati: `automix` (con `Point=realStart/realEnd/fadeStart/fadeEnd/cutStart/cutEnd/tempoStart/tempoEnd`), `remix` (con `Name`). Il binario espone anche cue/hotcue/loop/load/beatgrid e attributi `Poi`: `Name`, `Pos`, `Num`, `Type`, `Slot`, `Point`, `Color`. Hotcue usano `Num`/`Slot`.

**Smartlist**: `<FilterFolder filter="..." scope="database"/>` in `Folders/Filters/nome.vdjfolder`. **Playlist manuale** (`VirtualFolder`): file `.vdjfolder` con `<VirtualFolder>` ed elementi `<song path="..."/>` in `MyLists/` (formato community; qui nessun campione live perché `MyLists` è vuoto). L'ordine cartelle si controlla col file `order`/`.subfolders/order`.

**Protocollo**: chiudi VirtualDJ, modifica, riavvia — rilegge all'avvio e accetta le modifiche. Backup di `database.xml` prima.

#### Bookkeeping necessario
**Minimo** — il grande vantaggio. No USN, no UUID, no ricifratura, no re-encoding blob, no linked-list. Solo igiene XML:
1. XML ben formato UTF-8 con escaping corretto (nel reale `&lt;` nel filtro `"bpmdiff&lt;=4"`; `&` → `&amp;`).
2. `FileSize` deve corrispondere al file reale (parte della chiave brano con `FilePath`).
3. `Pos` POI in secondi (float).
4. Timestamp in epoch unix.

Se aggiungi un brano senza `Scan`/`AudioSig`, l'unico bookkeeping lo fa VirtualDJ ri-analizzando. `extra.db` è opzionale/rigenerabile.

#### Cosa si rompe
XML malformato / entità non-escapate → brano scartato o parsing troncato dal punto d'errore. Modifica a runtime → sovrascrittura silenziosa dello stato in RAM. `FileSize` sbagliato o `FilePath` non assoluto/inesistente → brano "not found"/offline; possibile entry duplicata. `Pos` POI in ms invece di secondi o oltre `SongLength` → cue mal posizionato/ignorato. Corruzione totale → recovery dai `Backup/*.zip` automatici (rischio contenuto se lasci intatta `Backup`).

#### Prior art
Formato così semplice (XML piatto senza cifratura/checksum) che **non esiste un progetto OSS di riferimento** paragonabile a pyrekordbox: si manipola con parser XML generici (`lxml`/`ElementTree`). Per confronto sul bookkeeping complesso: **pyrekordbox** (Rekordbox) e **serato-tools / Deep-Symmetry crate-digger** (Serato). VirtualDJ è, insieme a Traktor, il più semplice.

---

## 3. Come scrivere in sicurezza da un tool esterno (CrateForge)

Regola trasversale non negoziabile: **sempre su copia, sempre ad app chiusa, sempre con backup.** Ogni app riscrive la propria libreria alla chiusura/commit; una scrittura esterna a runtime viene persa o, peggio (Rekordbox), corrotta.

### 3.1 Rekordbox

| Aspetto | Dettaglio |
|---|---|
| **Brani** | `db.add_content` / insert diretto `DjmdContent.create(...)` + UUID + ID + timestamp |
| **Playlist** | `db.create_playlist` / `create_playlist_folder`; **poi aggiornare `masterPlaylists6.xml`** (NODE con `Id` hex maiuscolo + `Timestamp` ms) |
| **Membership** | `db.add_to_playlist` (`DjmdSongPlaylist` con `TrackNo`) |
| **Cue** | insert `DjmdCue` (tabella in §2.1); `InFrame = round(InMsec*0.15)`; `Kind=0` memory, `>0` hot |
| **Tag** | `DjmdMyTag`/`DjmdSongMyTag`; colori via `DjmdColor` |
| **Limiti UI rimossi** | Hot cue **oltre gli 8 slot A-H** (il cap è UI, non `DjmdCue`); colori/commenti cue in batch; MyTag in batch; loop e memory cue programmatici; beatgrid/waveform via ANLZ |
| **Precauzioni** | (1) **Rekordbox CHIUSO** — non neutralizzare mai `get_rekordbox_pid` sul DB reale (il lock previene corruzione da WAL/pagine in RAM); (2) **incrementare USN** globale e settare `rb_local_usn` su ogni riga toccata; (3) UUID unici; (4) foreign key valide (`ContentID`/`ContentUUID` esistenti); (5) **aggiornare i sidecar**: `masterPlaylists6.xml` per playlist, **ANLZ `.DAT`/`.EXT`** per cue destinati a export USB/CDJ; (6) mai scrivere SQLite in chiaro — la ricifratura è automatica solo passando dall'engine sqlcipher |

### 3.2 Serato

| Aspetto | Dettaglio |
|---|---|
| **Brani/tag** | riscrivere `database V2` serializzando `otrk` (tag 4B + len 4B BE + payload), testo UTF-16BE |
| **Playlist** | scrivere `Subcrates/<nome>.crate` (`otrk`>`ptrk`, path volume-relative **senza slash iniziale**) |
| **Cue/hotcue/loop/color** | encodare GEOB `Serato Markers2` (base64, corpo `\x01\x01` + entry + terminatore `\x00`, wrap 72 char, prefisso `\x01\x01`) + legacy `Serato Markers_`; scrivere via mutagen ID3 |
| **Limiti UI rimossi** | Cue con colori RGB arbitrari e (teoricamente) indici oltre gli 8 slot UI — **da validare** (Serato può clampare >7); crate batch; LOOP/BPMLOCK programmatici |
| **Precauzioni** | (1) Serato **CHIUSO**; (2) framing tag+len esatto + UTF-16BE + length ricalcolate; (3) path volume-relative senza slash iniziale; (4) **padding Markers2 = base64 `=`-paddato + newline finale** (convenzione dominante 94/96 sui file reali), non "gruppo parziale + null"; (5) preservare gli altri GEOB (`BeatGrid`/`Overview`/`Autotags`) as-is; (6) **validare l'encoder contro un file cue-ato autentico** (nel repo esiste solo il reader — l'encoder va scritto e confrontato byte-per-byte prima della produzione; header `\x01\x01` e wrap 72 già confermati sui reali) |

### 3.3 Traktor

| Aspetto | Dettaglio |
|---|---|
| **Brani** | `<ENTRY>` con `LOCATION` (path `/:`-encoded: `DIR`/`FILE`/`VOLUME`/`VOLUMEID`), `INFO`, `TEMPO BPM`, opz. `LOUDNESS`/`MUSICAL_KEY` |
| **Cue** | `<CUE_V2 START(ms float) TYPE HOTCUE LEN REPEATS>`; beatgrid = `CUE_V2 TYPE="4" NAME="AutoGrid"` con `<GRID BPM>` |
| **Playlist** | `<NODE TYPE="PLAYLIST">` con `PRIMARYKEY KEY` = `VOLUME + "/:" + DIR + FILE`, che deve matchare la `LOCATION` |
| **Limiti UI rimossi** | Molti `CUE_V2` oltre i pochi hotcue UI; batch tag/BPM/key/rating/colori; smartlist con `SEARCH_EXPRESSION` arbitrarie; migrazione cue/griglie da/verso altre app |
| **Precauzioni** | (1) Traktor **CHIUSO** (riscrive il NML alla chiusura); (2) `COLLECTION ENTRIES`, `PLAYLIST ENTRIES`, `SUBNODES COUNT` coerenti; (3) `PRIMARYKEY KEY` = `LOCATION` byte-per-byte; (4) UUID 32-hex per nuove liste; (5) `START` in **ms float**, non secondi; (6) `MODIFIED_TIME` = secondi da mezzanotte, `MODIFIED_DATE` = `YYYY/M/D` senza zero-pad |

### 3.4 Engine DJ

| Aspetto | Dettaglio |
|---|---|
| **Brani** | INSERT `Track` (path/filename/title/artist/bpmAnalyzed/length); lasciare l'id ad AUTOINCREMENT; `PerformanceData` creata dal trigger |
| **Cue/beatgrid** | scrivere `quickCues`/`beatData` = `struct.pack('>I', len) + zlib.compress(...)`; `loops` = LE non compresso; 8 slot, vuoti = `-1.0` |
| **Playlist** | INSERT `Playlist` + `PlaylistEntity` (`databaseUuid` = UUID di `Information`); mantenere la linked-list `nextEntityId` (append: vecchia coda → nuovo id, nuovo → 0) |
| **Limiti UI rimossi** | Batch degli 8 quickCue + 8 loop su tutta la libreria con label/colori arbitrari; set/lock beatgrid; preservare cue che l'app sovrascriverebbe in re-analisi; import cross-tool (crate Engine da dati Rekordbox/Serato). **Il formato è fisso a 8+8 slot** — non si eccede la capacità hardware |
| **Precauzioni** | (1) Engine **CHIUSO**; (2) `Track.id` > `sqlite_sequence.seq`, mai riciclare id cancellati; (3) BLOB endianness corretta (cue/beat = BE, loop = LE) e prefisso length valido; (4) linked-list senza dangling/cicli/doppia coda; (5) `originDatabaseUuid`/`originTrackId` corretti; (6) verificare `PRAGMA integrity_check` e `foreign_key_check` dopo la scrittura |

### 3.5 VirtualDJ

| Aspetto | Dettaglio |
|---|---|
| **Brani** | `<Song FilePath(assoluto) FileSize(byte)>` + `<Tags>` + `<Infos SongLength(sec .3f)>` + opz. `<Scan>` |
| **Cue/POI** | `<Poi Pos(secondi) Type Num Slot Point Color Name>`; automix con `realStart`/`fadeStart`/`cutStart`/`tempoStart` |
| **Playlist** | smartlist `<FilterFolder filter="..." scope="database"/>` in `Folders/Filters/`; playlist manuale `<VirtualFolder>` con `<song path="..."/>` in `MyLists/` |
| **Limiti UI rimossi** | POI illimitati per brano (tag ripetibile, nessun cap a 8 hotcue); automix points precisi; smartlist con qualsiasi espressione; import/aggiornamento massivo |
| **Precauzioni** | (1) VirtualDJ **CHIUSO** (riscrive `database.xml` a runtime); (2) XML ben formato + escaping (`&` → `&amp;`); (3) `FileSize` = file reale; (4) `Pos` in **secondi**, non ms; (5) backup di `database.xml` (VirtualDJ tiene comunque `Backup/*.zip`) |

---

## 4. Nota di perimetro ed etica

Tutto quanto documentato riguarda **l'interoperabilità sui DATI dell'utente** — i propri brani, cue, loop, tag, playlist e beatgrid — creati o posseduti dall'utente stesso. **Non riguarda in alcun modo licenze, DRM, attivazioni o funzioni a pagamento del software.**

Punti specifici a conferma:
- La chiave DB6 di Rekordbox **protegge i dati dell'utente, non le licenze**, ed è **pubblica/documentata** (estraibile da `options.json` con Blowfish, o via Frida; già distribuita in progetti OSS come pyrekordbox). Non si sta aggirando alcun controllo di accesso a pagamento.
- Serato, Traktor, Engine DJ e VirtualDJ **non cifrano affatto** i dati utente: leggerli e riscriverli è manipolazione di file dell'utente sul suo disco.
- I lock esistenti (processo Rekordbox, concorrenza-di-scrittura nelle altre) sono **protezioni anti-corruzione**, non misure di protezione tecnologica di contenuti a pagamento: vanno rispettati per sicurezza dei dati, non aggirati.
- I `SQLCipher`/OpenSSL trovati nel binario VirtualDJ servono a leggere librerie **di terzi** in import/export, confermando che quegli schemi/chiavi sono pubblici — non a cifrare lo store proprio.
- Il "superamento del cap di 8 hot cue" è un limite di **workflow della UI**, non un limite hardware o di licenza; i limiti fisici del formato di export verso hardware (numero cue letti dai player, compatibilità nexus/nexus2, array 8+8 di Engine) **restano** e la scrittura diretta non li elimina.

In sintesi: CrateForge opera come uno strumento di **interoperabilità e portabilità della libreria musicale dell'utente tra software DJ**, analogo a pyrekordbox, serato-tools, traktor-nml-utils, Mixxx e ai convertitori commerciali (Lexicon, MIXO). Nessuna funzione descritta tocca l'attivazione o le feature a pagamento delle applicazioni.

---

## 5. Roadmap di implementazione della scrittura in CrateForge

Ordine consigliato: dal formato più semplice e a rischio minore verso il più complesso, così da consolidare l'infrastruttura (parser/serializer, backup, "app-closed guard") prima di affrontare cifratura e bookkeeping di sync.

| # | App | Cosa scrivere | Fattibilità | Rischio | Prerequisiti | Ordine |
|---|---|---|---|---|---|---|
| 1 | **VirtualDJ** | `<Song>` (tag/BPM/key), `<Poi>` cue/loop, `<FilterFolder>` smartlist, `<VirtualFolder>` playlist | Alta (XML piatto) | **Basso** | Parser XML (lxml), backup `database.xml`, app-closed guard, `FileSize` reale | 1° |
| 2 | **Traktor** | `<ENTRY>` brano+`LOCATION` `/:`-encoded, `<CUE_V2>`/`<GRID>`, `<NODE>` playlist con `PRIMARYKEY` | Alta (XML in chiaro) | **Basso** | Serializer NML, path-encoder `/:`, coerenza `ENTRIES`/`SUBNODES`, UUID liste, `START` in ms | 2° |
| 3 | **Engine DJ** | `Track`+`PerformanceData` (trigger), BLOB `quickCues`/`beatData`/`loops`, `Playlist`/`PlaylistEntity` | Alta (provata end-to-end) | **Medio** | Codec BLOB `[BE len]+zlib` (loops LE), gestione linked-list `nextEntityId`, `id` > `sqlite_sequence`, `integrity_check` post-write | 3° |
| 4 | **Serato** | `database V2`/`.crate` tag+len UTF-16BE, GEOB `Serato Markers2`+`Markers_` via mutagen | Media (encoder da scrivere) | **Medio** | Serializer tag+len, **encoder Markers2** (padding `=`+newline, wrap 72, header `\x01\x01`) validato contro file autentico, mutagen ID3 | 4° |
| 5 | **Rekordbox** | `DjmdContent`/`DjmdPlaylist`/`DjmdSongPlaylist`/`DjmdCue`/`DjmdMyTag` + `masterPlaylists6.xml` + ANLZ | Media (provata su copia) | **Alto** | SQLCipher (chiave `402fd…`), engine sqlcipher, **bookkeeping USN/UUID** (`AgentRegistry`), sync `masterPlaylists6.xml`, opz. writer ANLZ, lock di processo | 5° |

### Note di sequenziamento
- **Infrastruttura condivisa da costruire per prima (fase 1-2)**: astrazione "libreria" con `open→edit→backup→write-atomically→verify`, guardia "app chiusa" per ogni target, e round-trip test su copia. Questa infrastruttura serve identica a tutte e cinque.
- **Fase 3 (Engine)** introduce il primo codec binario (zlib + endianness) e le linked-list: da qui in poi ogni scrittura va validata con round-trip byte del payload decompresso, non del blob grezzo.
- **Fase 4 (Serato)** richiede di scrivere ex novo l'encoder Markers2 (il repo ha solo il reader) e di validarlo contro uno dei 96 file cue-ati reali; header e wrapping sono già confermati, resta da fissare il padding sullo standard `=`+newline.
- **Fase 5 (Rekordbox)** è l'ultima perché combina cifratura + bookkeeping di sync + tre sidecar (DB, XML, ANLZ): è l'unico target dove un errore di bookkeeping può causare **de-sync cloud/dispositivi**, non solo un problema locale. Riutilizzare pyrekordbox 0.4.3 come backend è la via a rischio minore; scrivere gli ANLZ va considerato una sotto-fase separata (necessaria solo per la coerenza export USB/CDJ, non per l'uso in-app).