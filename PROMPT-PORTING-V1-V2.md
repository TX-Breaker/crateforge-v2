# Prompt per Claude Code — portare le logiche di CrateForge V1 nella V2

> Copia tutto il testo sotto la riga e incollalo come primo messaggio in una
> nuova sessione di Claude Code aperta su `C:\Users\Vale\Desktop\Claude-Projects\Crateforge-V2`.

---

Lavori su **CrateForge V2** in `C:\Users\Vale\Desktop\Claude-Projects\Crateforge-V2`.

C'è una versione precedente, **V1**, in
`C:\Users\Vale\Desktop\Claude-Projects\TrackList-Tool-2025-MacOS\TrackList-Tool\crateforge`
(anche su GitHub: `https://github.com/TX-Breaker/crateforge`).

La V2 è nata come fork della V1 e ha una **GUI completamente ridisegnata**. Dopo
il fork, sulla V1 è stato fatto molto lavoro di *logica* (interoperabilità tra
software DJ) che nella V2 manca. Il tuo compito è **portare quelle logiche nella
V2 adattandole alla sua GUI**, non il contrario.

## Regola numero uno: la GUI della V2 non si tocca

Il redesign della V2 è lavoro già fatto e approvato. Non riportare le pagine
della V1. In particolare NON devono essere toccati, se non per aggiungere le
chiamate alle nuove funzioni:

- `src/renderer/src/app/` (routes, shell: Sidebar, Topbar, TitleBar, JobBar, Statusbar)
- `src/renderer/src/pages/` (OverviewPage, TracksPage, ConvertPage, CleanupPage,
  RelocatePage, EnrichPage, SetsPage, ReportsPage, ActivityPage, ArrivalsPage,
  onboarding/FirstRun)
- `src/renderer/src/components/` (CommandPalette, NotificationCenter,
  ShortcutsDialog, data/CamelotWheel, data/Charts, data/TrackList, data/Waveform,
  ui/fields)
- `src/renderer/src/lib/` (router, jobs, library, notifications, platform, i18n)

Le pagine della V1 (`ConverterPage.tsx`, `Dashboard.tsx`, `SiaePage.tsx`, …) sono
**solo un riferimento per capire quali chiamate IPC servono**. Nella V2 quelle
funzioni vanno agganciate alle pagine corrispondenti già esistenti
(es. la conversione sta in `ConvertPage.tsx`, la pulizia in `CleanupPage.tsx`).

Prima di scrivere codice nel renderer, **leggi** `redesign-v2.MD` e il design
system in `docs/`: rispetta i componenti, i pattern e il tono già stabiliti.

## PRIORITÀ ZERO — tre difetti già trovati, da correggere PRIMA di tutto il resto

Una review del codice V2 (con verifica avversariale) ha confermato questi
problemi. Riguardano la scrittura sui file dell'utente: vanno chiusi prima di
aggiungere qualunque funzione nuova.

**1. `export:seratoCues` ignora il filtro e riscrive TUTTA la libreria** — grave
`src/renderer/src/pages/ConvertPage.tsx:240` passa `{ source: convertSource }`
con un cast `as never`, ma `src/main/ipc.ts:584-590` filtra solo su
`sel.playlistIds` e **ignora `source`**. Conseguenza: l'utente converte una
libreria e CrateForge riscrive i tag ID3 di *tutti* i file audio dell'UDM.
Il cast `as never` esiste proprio per zittire l'errore di tipo che segnalava
questo. Fix: onorare `sel.source` nell'handler (come fa già
`src/adapters/common.ts:49-51`) e togliere il cast, oppure allineare i tipi.
Aggiungere un test che verifica che con `source` valorizzato vengano toccati
solo i file di quella sorgente.

**2. La scrittura nei file originali non ha conferma** — serio
`ConvertPage.tsx:547`: la scrittura dei cue dentro gli MP3 parte da un semplice
`<Button variant="secondary">`. Niente `DangerConfirmDialog`, niente conteggio
dei file coinvolti, nessuna verifica del gate `directWrites` lato UI. La V1 per
la stessa azione richiede gate + conferma da digitare. Fix: doppia conferma con
numero di file, coerente con il resto della V2.

**3. `PROGRESS.md` è un fossile della V1 e mente sullo stato** — grave
Non è mai stato aggiornato dopo il fork (`git log -- PROGRESS.md` → solo il
commit di baseline). Dice `[ ] Export Engine/Serato: RIMANDATO` mentre nella V2
sono implementati; dice "10 pagine" (sono 13), "it/en" (sono 4 lingue),
"176 test" (sono 231). E dichiara `[x]` l'icona dell'app mentre la cartella
`build/` non esiste e **l'eseguibile spedito porta l'icona di default di
Electron** (verificato estraendo le risorse dal binario).
Fix: riscrivere `PROGRESS.md` sullo stato reale della V2, e creare
`build/icon.png` (≥512px, meglio 1024) + `build/icon.ico`.

Difetti minori confermati, da sistemare quando si tocca quell'area:
- `components/data/TrackList.tsx:232`: i filtri "Senza key/BPM/genere" agiscono
  solo sulla finestra scaricata → buchi vuoti nella lista e contatore sbagliato.
  Vanno spinti nell'IPC (`library:page`) o va corretto il conteggio.
- `pages/ReportsPage.tsx:177`: le sessioni SIAE non si caricano al mount (manca
  `useEffect`) → sembra che non ci siano dati. *Difetto ereditato dalla V1.*
- `pages/ReportsPage.tsx`: perso il pulsante "Apri un file esistente" del
  visualizzatore Excel presente nella V1.
- `lib/library.tsx:96`: scarica l'intera inbox solo per contarne gli elementi
  (viola "mai bulk data su IPC"): serve un IPC che restituisca il conteggio.
- `CommandPalette.tsx:111`: `useMemo` senza `navigate`/`close` nelle dipendenze.
- Versione applicazione hardcoded in `SettingsPage.tsx:428` e `Sidebar.tsx:62`.

## Cosa manca nella V2 (verificato file per file)

### A. File assenti — vanno portati dalla V1

1. `src/adapters/engine/engineCodec.ts` — codec dei blob `PerformanceData` di
   Engine DJ (quickCues e loops). **Verificato**: ri-codificando ogni blob di
   una libreria reale si riottengono gli stessi byte, 114/114 quickCues e
   114/114 loops.
2. `src/adapters/engine/engineWriter.ts` — genera una **libreria Engine nuova**
   (mai modificare quella dell'utente): brani, hot cue, loop, copertine,
   playlist. **Validato aprendo la libreria generata in Engine DJ 5.0 reale.**
3. `src/main/networkPath.ts` — riconosce percorsi UNC e unità di rete mappate
   e produce un avviso comprensibile (SQLite non regge i lock su SMB: è ciò che
   fa fallire Engine DJ quando la cartella Musica sta su un NAS).
4. `src/core/platformProfile.ts` — profilo OS: scorciatoie da tastiera per
   sistema (Ctrl vs ⌘), percorsi tipici delle librerie dei 5 software, comandi
   da terminale. **Attenzione**: la V2 ha già `src/main/djSoftwarePaths.ts` che
   copre il rilevamento dei percorsi in modo suo e più aggiornato. **Non
   duplicare**: porta da `platformProfile.ts` solo la parte scorciatoie/comandi
   e appoggiati a `djSoftwarePaths.ts` per i percorsi. Se `djSoftwarePaths.ts`
   basta già, non introdurre `platformProfile.ts` affatto.

### B. Correzioni a file che nella V2 esistono ma sono vecchi

5. **`src/adapters/engine/engineReader.ts` — BUG GRAVE ancora presente.**
   Riga ~182: `resolve(dirname(dbPath), '..', '..')` risale un livello di
   troppo. I path dei brani in Engine sono relativi alla cartella
   `Engine Library`, NON a quella che la contiene. Misurato: con il codice
   attuale 0/114 file vengono trovati, con `resolve(dirname(dbPath), '..')`
   114/114. Inoltre la risoluzione dev'essere `resolve(libRoot, rawPath)` e non
   un `join` che taglia a mano un solo `..`.
6. **`src/adapters/virtualdj/vdjWriter.ts`** (69 righe nella V2, 177 nella V1):
   - le **memory cue venivano scartate in silenzio** → vanno emesse come
     `Poi Type="remix"` (è l'inverso esatto di ciò che legge `vdjReader`);
   - il **colore del cue non veniva mai scritto** benché il reader lo legga;
   - hot cue senza pad e loop senza lunghezza: conservare la posizione invece
     di perderli;
   - **playlist**: in VirtualDJ non stanno nel `database.xml` ma come file
     `.vdjfolder` sotto `Folders/`, con un `<song path="…"/>` per brano;
   - il writer deve restituire `warnings: string[]`.
7. **`src/adapters/rekordbox/xmlWriter.ts`**: quando gli 8 pad sono pieni, hot
   cue e loop in eccesso venivano **scartati**. Vanno degradati a memory
   (`Num="-1"`), che Rekordbox supporta, e dichiarati nei warning. Senza questo,
   importando da Engine (8 cue + 8 loop per brano) si perde metà dei punti.
8. **`src/services/watcher/syncDaemon.ts`**: confronta i path grezzi. Va usato
   `canonicalizePath` (NFC + case) come fa già `orphanFinder`, con un indice in
   memoria per scansione — niente migrazioni di schema.
9. **`src/services/excel/reportViewer.ts`**: rilegge e riparsa l'intero `.xlsx`
   a ogni pagina. Serve una cache del workbook invalidata su `mtime` + `size`.
10. **`python-sidecar/sidecar.py` — `_serato_volume_root`**: riconosce solo i
    mount macOS (`/Volumes/...`). Su Windows deve estrarre il drive della
    cartella `_Serato_`, normalizzare i separatori e saltare `$RECYCLE.BIN`.

### C. Comandi del sidecar assenti nella V2

11. `write-serato-cues` — scrive hot cue **e loop** nei tag GEOB
    `Serato Markers2` dei file audio. Include gli helper `_serato_split_entries`,
    `_serato_build_markers2`, `_serato_cue_entry`, `_serato_loop_entry`.
    Disciplina obbligatoria per file: hash → backup verificato → scrittura →
    rilettura di verifica → rollback su qualunque errore.
    **Preserva tutto ciò che non interpreta** (COLOR, BPMLOCK, FLIP e ogni entry
    sconosciuta) e **annulla la scrittura** se il blob contiene byte non
    riconosciuti.
12. `write-serato-crates` — scrive le playlist come `Subcrates/*.crate`.
    Formato: campi `[tag 4 char][uint32 BE lunghezza][payload]`, `vrsn` più un
    `otrk` per brano con `ptrk` = percorso relativo al volume.
    **Non sovrascrive mai un crate esistente** (vedi "limiti noti").

### D. Handler IPC assenti nella V2

13. `export:engineLibrary` — genera la libreria Engine (chiede cartella di
    destinazione e un `m.db` esistente come modello dello schema).
14. `export:seratoCues` — scrive cue e loop nei file audio. **Dietro il gate
    delle scritture dirette** (`getSetting(db,'directWrites') !== '1'` →
    errore esplicito), perché modifica gli originali.
15. `export:seratoCrates` — scrive i crate.
16. `platform:detect` — solo se decidi di portare `platformProfile.ts`.

Vanno esposti nel `preload` e agganciati alle pagine V2 già esistenti.

## Dettagli di formato già misurati (non rifare il reverse engineering)

**Serato — GEOB `Serato Markers2`**: `01 01` + base64 **con il padding `=`
conservato**, newline ogni 72 caratteri, poi NUL fino alla dimensione del frame.
Entry: `nome NUL` + `uint32 BE lunghezza` + payload.
- `CUE` (13 byte + nome): `00 | index | uint32 BE posizione ms | 00 | RGB | 00 00` + nome NUL-terminated
- `LOOP` (21 byte + nome): `00 | index | uint32 BE inizio | uint32 BE fine | FF FF FF FF | 00 | RGB | 00 | bloccato` + nome
- Serato ha **8 pad**; i loop reali hanno tutti colore `#27AAE1`.

**Engine DJ — `PerformanceData`**:
- framing: `[uint32 BE lunghezza dei dati DECOMPRESSI][stream zlib livello 6]`
- `quickCues`: `int64 BE numero slot`, poi per slot `uint8 lunghezza etichetta` +
  etichetta UTF-8 + `double BE posizione in SAMPLE` + `4 byte ARGB`; in coda
  **17 byte** = `double BE main cue adjusted | uint8 flag | double BE default`
- `loops`: **NON compresso**, **little-endian**: `int64 LE numero slot`, poi per
  slot `uint8 len` + etichetta + `double LE inizio` + `double LE fine` +
  `uint8 inizio impostato` + `uint8 fine impostata` + `4 byte ARGB`
- alpha `0xFF` = slot occupato; slot vuoto = posizione `-1.0`, colore `00000000`
- le posizioni sono in **SAMPLE**: servono la sample rate dal `trackData`
  (`double BE` all'inizio), non 44100 fisso
- **copertine**: file in `Engine Library/Artwork/<base64url(SHA-1)>.jpg`, e in
  `AlbumArt` una riga con `hash` = i 20 byte dello SHA-1 in binario;
  `Track.albumArtId` DEVE essere `NULL` e mai `0` (c'è una foreign key)
- **playlist**: due liste concatenate — `Playlist.nextListId` e
  `PlaylistEntity.nextEntityId`, con `0` come terminatore;
  `PlaylistEntity.databaseUuid` = `Information.uuid`
- **path dei brani**: relativi alla cartella `Engine Library`, con `..` multipli
  (es. `../../Desktop/Musica/x.mp3`)

## Come lavorare (il metodo che ha funzionato)

1. **Non fidarti della documentazione, misura.** Ogni formato sopra è stato
   ricavato leggendo file reali. Se qualcosa non torna, guarda i byte.
2. **Lavora sempre su copie** delle librerie dell'utente. Gli originali si
   aprono in sola lettura. Mai scrivere su un file originale senza backup
   verificato con hash e rollback automatico.
3. **Il criterio di sicurezza per ogni writer è il round-trip**: decodifica →
   ri-codifica → i byte devono tornare identici. Se non lo dimostri, il writer
   non è pronto e va dichiarato tale, non spedito.
4. **Ciò che non è rappresentabile va DICHIARATO** nei warning, mai scartato in
   silenzio. Una perdita muta è il peggior difetto possibile in un convertitore:
   il DJ se ne accorge sul palco.
5. **Preserva ciò che non capisci.** Quando riscrivi una struttura, rimetti
   identiche le parti che non sai interpretare invece di ometterle.
6. **Test che si auto-saltano**: i test che dipendono dalle librerie reali della
   macchina devono usare `describe.skipIf(...)`, così la CI resta verde altrove.
7. Il runner dei test è `node scripts/run-vitest.cjs run` (gira dentro Electron
   per l'ABI di `better-sqlite3`); `npx vitest` NON funziona.

## Limiti noti da mantenere dichiarati

- **Crate Serato**: il formato non ha un round-trip verificato contro un crate
  scritto da Serato. Per questo il writer non sovrascrive mai un crate
  esistente. Se l'utente crea una playlist in Serato, la verifica si può chiudere.
- **Forma d'onda e griglia di Engine** (`overviewWaveFormData`, `beatData`) non
  vengono scritte di proposito: si sanno leggere ma non ricreare byte per byte.
  Engine le rigenera alla prima analisi.
- **Downbeat da Engine**: `beatData` non è decodificato, la griglia si
  ricostruisce a BPM costante.
- **Colori verso Traktor**: il formato NML non ha un colore per cue. Perdita
  intrinseca, va solo dichiarata.
- **Serato ha 8 pad**: da Engine/VirtualDJ i cue oltre l'ottavo non hanno posto.

## Ordine di lavoro consigliato

0. **I tre difetti di "PRIORITÀ ZERO"**, in quest'ordine: filtro Serato ignorato,
   conferma sulla scrittura negli originali, `PROGRESS.md` + icona. Sono i due
   che toccano i file dell'utente più quello che mente sullo stato: vanno chiusi
   prima di aggiungere funzioni.
1. Fix `engineReader` (bug dei path) — è quello che rompe tutto il resto.
2. `engineCodec` + `engineWriter` + IPC + aggancio a `ConvertPage`.
3. Fix `vdjWriter` e `xmlWriter` (perdite silenziose).
4. Sidecar: `write-serato-cues` e `write-serato-crates` + IPC + aggancio.
5. `networkPath`, poi `syncDaemon` e `reportViewer`.
6. Profilo OS solo se non è già coperto da `djSoftwarePaths.ts`.

Dopo ogni blocco: `npm run typecheck`, `node scripts/run-vitest.cjs run`, e un
commit con messaggio che spiega **perché**, non solo cosa.

Al termine ricompila (`npm run dist`) e verifica che il sidecar impacchettato
risponda al `ping` e contenga i comandi nuovi.
