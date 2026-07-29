# CrateForge V2

Library manager e utility di manutenzione per DJ. **Compatibile con Rekordbox** (non affiliato ad AlphaTheta/Pioneer DJ).

Sviluppato da **TX-Breaker** in collaborazione con **Rekordbox DJ Italia Group**.

> CrateForge non è un software per mixare: è il "meccanico" della tua libreria. Sistemi qui, poi suoni in Rekordbox.

## Novità della V2 — interfaccia ricostruita

La V2 mantiene **tutte** le funzioni della V1 e ne riscrive l'interfaccia da zero sul
design system in [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md). In breve:

- **Tredici destinazioni in sei gruppi** al posto di diciannove voci piatte: le pagine
  che rispondevano alla stessa domanda sono diventate tab (mappa completa in
  [`docs/REDESIGN-NOTES.md`](docs/REDESIGN-NOTES.md)).
- **Due assi di tema** — stile `Studio` o `Neutro`, luminosità chiaro/scuro/auto:
  quattro palette, sei combinazioni, tutte con contrasto AA.
- **Barra job globale** con fase, avanzamento, ETA, annulla e coda: sopravvive al
  cambio pagina.
- **Notifiche** con toast e centro notifiche; i limiti dichiarati restano però inline
  e persistenti sulla pagina, dove vanno letti prima di agire.
- **Palette comandi** (⌘K / Ctrl+K) per navigare, cercare tracce e lanciare azioni.
  Nessun comando distruttivo è eseguibile da qui.
- **Primo avvio guidato** che rileva Rekordbox, Traktor, VirtualDJ, Serato ed Engine DJ
  verificando ogni percorso su disco prima di mostrarlo.
- **Liste virtualizzate**, waveform su canvas con cue trascinabili, ruota di Camelot
  interattiva, grafici di distribuzione BPM e copertura tonalità.
- Quattro lingue a parità garantita da compilatore e test; `prefers-reduced-motion`
  rispettato ovunque.

Le regole di sicurezza non sono cambiate di una virgola: gate espliciti, doppia
conferma, dry-run, quarantena reversibile, dichiarazione della destinazione di ogni
scrittura, registro completo.

## Cosa fa (Fase 1)

- **Backup Smart Incrementale** — snapshot di `master.db` + `options.json`, poi copia solo i file musicali nuovi/modificati (confronto mtime+size, hash opzionale con verifica d'integrità).
- **Cacciatore di File Orfani** — diff tra disco e libreria; gli orfani vanno in una **quarantena reversibile**, mai eliminati.
- **Report Excel** — .xlsx nativo con artista, titolo, versione (estratta dal filename quando il tag manca), durata, BPM, key (opzione Camelot), tag mancanti evidenziati in rosso, filtri attivi.
- **Converter Anti-Lock-in** — export verso Traktor (.nml), VirtualDJ (XML + playlist `.vdjfolder`), Rekordbox XML, **Engine DJ** (genera una libreria nuova: la tua non viene toccata) e **Serato** (cue e loop nei tag dei file audio, con backup verificato e ripristino automatico; le playlist come crate, senza mai sovrascrivere quelli esistenti). Ciò che il formato di arrivo non sa rappresentare viene dichiarato, mai scartato in silenzio — vedi [docs/PORTING-V1-V2.md](docs/PORTING-V1-V2.md).
- **Relocator** (modalità Esperto) — ritrova i file spostati per nome file e genera un XML di aggiornamento da re-importare.
- **Gestione encoding** — tag con caratteri corrotti/mojibake finiscono in "Da revisionare" e non inquinano gli export.

## Cosa fa (Fase 2 — modalità Esperto, sperimentale)

Funzioni visibili solo attivando la modalità **Esperto** nelle impostazioni; ognuna
dichiara i propri limiti in-app prima di eseguire.

- **Duplicati per impronta acustica** — `fpcalc`/Chromaprint calcola un Acoustic ID
  (simhash) per ogni brano: trova i doppioni veri anche con nomi file diversi.
  I duplicati selezionati vanno in quarantena reversibile (doppia conferma).
  L'Acoustic ID compare anche nel Report Excel.
- **Relocator per impronta** — ritrova i file anche se **rinominati**, confrontando
  le impronte già calcolate. Genera il solito XML di aggiornamento.
- **Auto-Cue assistito** — propone fino a 8 cue (intro/drop/breakdown/outro) con
  euristiche su onset ed energia (aubio). Tu li rivedi, li correggi e decidi se
  salvarli: nessun algoritmo sostituisce il tuo orecchio.
- **Auto-Tagger** — completa anno/genere mancanti interrogando MusicBrainz con
  **sole query testuali** artista/titolo (mai upload audio), rate-limit 1 req/s,
  solo match con confidenza alta; proposte da approvare una a una.
- **Stems (Demucs)** — separazione voce/batteria/basso in file nuovi, on-demand e
  annullabile. Operazione lunga e pesante, dichiarata come tale.

## Cosa fa (Fase 3 — power user, modalità Esperto)

- **Nuovi Acquisti (Sync Daemon)** — sorveglia una cartella *mentre CrateForge è
  aperto*: i nuovi file audio vengono analizzati, normalizzati e messi in coda.
  Quando decidi tu, generi un XML (con playlist "CrateForge – Nuovi Acquisti")
  e lo importi a mano in Rekordbox. Nessuna iniezione automatica nel database.
- **Set Planner** — analisi read-only di una playlist: transizioni armoniche
  problematiche (ruota di Camelot), salti di BPM oltre il 6%, tracce-ponte
  suggerite dalla libreria. Limite dichiarato: l'energia reale del brano non è
  nel database, il BPM fa da proxy.

### Livello AI del sidecar (opzionale)

Le funzioni Auto-Cue e Stems richiedono librerie extra, volutamente separate dal
sidecar base per non comprometterne l'affidabilità:

```bash
# nello stesso venv del sidecar
pip install --prefer-binary -r python-sidecar/requirements-ai.txt
```

Senza queste librerie l'app funziona comunque: i comandi AI falliscono con un
messaggio chiaro, tutto il resto resta operativo. Nota compatibilità: `essentia`
e `madmom` non hanno wheel per Windows (vedi commenti in `requirements-ai.txt`);
il backend attuale usa `aubio`+`numpy`.

### Regole di sicurezza non negoziabili

- **Mai** scritture sui file originali (database o audio): tutto avviene su copie.
- Doppia conferma esplicita (parola chiave + checkbox) su ogni azione potenzialmente distruttiva.
- Dry-run di default sulle operazioni di massa.
- Log completo di ogni operazione, esportabile.

## Architettura

- **Electron + TypeScript + React** (electron-vite). UI shadcn/ui + lucide-react.
- **UDM**: SQLite in chiaro (`better-sqlite3`, WAL) nella cartella `userData`. Node possiede schema e migrazioni.
- **Sidecar Python** (`python-sidecar/`): `pyrekordbox` + `sqlcipher3` per leggere il `master.db` cifrato (in sola lettura) e `fpcalc` per il fingerprint. Node passa il percorso UDM con `--udm-path` allo spawn; Python scrive solo nelle tabelle di ingestion. **Node non apre mai il database cifrato.**
- Se il sidecar manca o la chiave non è estraibile → **modalità solo-XML**: tutte le funzioni restano usabili sull'export collection XML di Rekordbox.

## Prerequisiti

- Node.js ≥ 20 e npm
- Python 3.9+ **solo per lo sviluppo dai sorgenti**: nell'app installata il
  sidecar è un binario e Python non serve. L'app rileva da sola l'interprete
  (virtualenv del progetto, launcher `py -3`, PATH) e, se manca solo il
  virtualenv, lo crea e installa le dipendenze in background al primo avvio.
- (Facoltativo) `fpcalc`/Chromaprint nel PATH per il fingerprint

## Build

```bash
cd crateforge
npm install                # installa deps e ricompila better-sqlite3 per Electron

# Sidecar Python (facoltativo ma consigliato)
#   macOS/Linux:
bash python-sidecar/build_sidecar.sh
#   Windows:
powershell -ExecutionPolicy Bypass -File python-sidecar/build_sidecar.ps1

npm test                   # suite Vitest (231 test; quelli su librerie reali si auto-saltano)
npm run build              # bundle main/preload/renderer
npm run dist               # pacchetto installabile (dmg/zip · nsis/portable)
```

In sviluppo: `npm run dev`.

### Nota sui test e l'ABI nativo

`postinstall` ricompila `better-sqlite3` per l'ABI di **Electron**; per questo `npm test` esegue Vitest dentro il runtime di Electron (`ELECTRON_RUN_AS_NODE`, vedi `scripts/run-vitest.cjs`). Non serve (e non va fatto) alcun `npm rebuild` manuale.

### Fixture cifrate per i test

Il file `master.db` cifrato di test si genera **solo in Python** (regola v4: nessun linguaggio diverso da Python tocca il cifrato, nemmeno nei test):

```bash
python python-sidecar/make_encrypted_fixture.py   # richiede sqlcipher3-wheels
```

In alternativa puoi usare un vero master.db di test impostando `CRATEFORGE_TEST_MASTERDB`.

## Firma e warning all'avvio

I build locali e di CI **non sono firmati**:

- **macOS (Gatekeeper)**: "app non verificata" — serve un certificato Apple Developer + notarizzazione per eliminarlo. Come aprirla comunque:
  - **macOS 15 (Sequoia) e successivi**: il vecchio bypass "tasto destro → Apri" NON funziona più per le app non notarizzate. Procedi così: prova ad aprire l'app (il dialogo la blocca), poi vai in **Impostazioni di Sistema → Privacy e Sicurezza**, scorri alla sezione Sicurezza e clicca **"Apri comunque"** (chiede la password admin, una sola volta per app).
  - **macOS 13/14**: tasto destro sull'app → **Apri** → Apri.
  - In alternativa, da Terminale (rimuove la quarantena): `xattr -dr com.apple.quarantine /Applications/CrateForge.app`
- **Windows (SmartScreen)**: "app non riconosciuta" — serve un certificato di code-signing. Workaround: Ulteriori informazioni → Esegui comunque.

## Falsi positivi antivirus (Windows)

Il sidecar è impacchettato con **PyInstaller**, che Windows Defender a volte segnala per errore (succede a moltissimi progetti Python legittimi: il bootstrap di PyInstaller "somiglia" a un packer). Per ridurre il problema il sidecar è costruito in modalità `--onedir` (molti meno falsi positivi di `--onefile`).

Se il sidecar sparisce o l'app dice "modulo di lettura diretta non disponibile":

1. Apri **Sicurezza di Windows → Protezione da virus e minacce → Cronologia protezione**.
2. Ripristina il file segnalato (`crateforge-sidecar.exe`).
3. Aggiungi la cartella di installazione di CrateForge alle **esclusioni**.

Anche senza sidecar l'app resta pienamente usabile in modalità solo-XML.

## Limiti noti (onestà tecnica)

Limiti del canale XML di Rekordbox — mostrati anche nell'app prima di ogni export:

- L'import XML **aggiunge/aggiorna ma non rimuove** nulla dalla collection.
- Massimo **8 hot cue** per brano.
- Colori memory cue, MyTag, smartlist e **loop attivi non passano**.
- L'import finale in Rekordbox è **manuale** ("Import to Collection"): nessun automatismo totale, per scelta.

Da Rekordbox 6.6.5 l'estrazione automatica della chiave del database può fallire: in quel caso l'app degrada in modalità solo-XML con istruzioni passo-passo (il fallback `download-key` di pyrekordbox è previsto come opzione Esperto, con disclaimer).

## CI

`.github/workflows/build.yml`: matrix macOS + Windows → artifact `.dmg`/`.zip` e `.exe` (non firmati).

## Trademark

Rekordbox, Pioneer, AlphaTheta, Serato, Traktor, Engine DJ e VirtualDJ sono marchi dei rispettivi proprietari. CrateForge dichiara compatibilità, nessuna affiliazione.
