# CrateForge V2 — Prompt di redesign UI/UX completo

> **Destinatario:** Claude Design / agente di sviluppo UI.
> **Obiettivo:** ricostruire l'interfaccia di CrateForge da zero, con un design moderno da
> applicazione professionale per DJ, **mantenendo il 100% delle funzionalità esistenti**.
> **Lingua di lavoro e di prodotto:** italiano (primario) + en/fr/de.

---

## 0. Regole di ingaggio (leggere prima di toccare qualsiasi file)

| | |
|---|---|
| **Sorgente (SOLA LETTURA)** | `C:\Users\Vale\Desktop\Claude-Projects\TrackList-Tool-2025-MacOS\TrackList-Tool\crateforge` |
| **Destinazione (scrittura)** | `C:\Users\Vale\Desktop\Claude-Projects\Crateforge-V2` |
| **Piattaforma di sviluppo** | Windows 10, PowerShell. L'app deve restare cross-platform (Windows + macOS). |

1. **Non modificare, non spostare, non cancellare NULLA nella cartella sorgente.** È il progetto in
   produzione. Puoi solo leggerla.
2. Il lavoro parte da una **copia integrale** del progetto sorgente in `Crateforge-V2` (esclusi
   `node_modules/`, `out/`, `release/`, `build/`, `.git/`, `*.tsbuildinfo`). Da lì in poi lavori solo
   sulla copia.
3. Il risultato deve essere **un'app Electron completa e avviabile**: `npm install && npm run dev`
   deve partire e mostrare l'app nuova, `npm test` deve essere verde, `npm run build` deve compilare.
4. **Hai libertà di refactor anche sul processo main / preload**, ma vedi §9: ci sono garanzie di
   sicurezza non negoziabili che nessun refactor può rompere.
5. Se una scelta di design entra in conflitto con una regola di sicurezza dell'app, **vince la regola
   di sicurezza**. Segnalalo nel report finale invece di aggirarla.

---

## 1. Cos'è CrateForge (contesto di prodotto)

CrateForge è un **library manager e tool di manutenzione per DJ**, compatibile con Rekordbox (nessuna
affiliazione con AlphaTheta/Pioneer DJ). Non è un software per mixare: è *il meccanico della libreria*
— si sistema qui, poi si suona in Rekordbox.

Autore: **TX-Breaker**, in collaborazione con **Rekordbox DJ Italia Group**.

**Filosofia del prodotto, da preservare e anzi rendere più leggibile nel nuovo design:**

- **Onestà tecnica.** Ogni funzione dichiara in-app i propri limiti *prima* di eseguire.
- **Mai toccare gli originali.** Ogni operazione lavora su copie; ogni esito dichiara *dove* ha
  scritto (database interno / copia / XML da importare / — solo opt-in — file originali).
- **Dry-run di default** su tutte le operazioni di massa.
- **Doppia conferma** (parola chiave digitata + checkbox) su ogni azione potenzialmente distruttiva.
- **Quarantena reversibile**, mai cancellazione diretta.
- **Log completo** ed esportabile di ogni operazione.
- **Due modalità utente:** *Semplice* (default) ed *Esperto* (sblocca funzioni sperimentali).

Questa filosofia è un **asset di design**: la V2 deve renderla visibile e rassicurante, non
nasconderla dietro l'estetica.

### Stack attuale

- Electron 33 + electron-vite + TypeScript 5.6
- React 18, Tailwind 3.4, shadcn/ui (componenti locali), Radix UI, lucide-react
- `better-sqlite3` (database interno "UDM"), `exceljs`, `fast-xml-parser`, `xmlbuilder2`, `music-metadata`
- Sidecar Python (`python-sidecar/`) per leggere il `master.db` cifrato di Rekordbox in sola lettura
- Vitest per i test

---

## 2. Stato attuale della UI (cosa stai sostituendo)

### 2.1 Shell

`src/renderer/src/App.tsx`: sidebar fissa da 224px (`w-56`) + `<main>` con padding, routing gestito da
un `useState<PageId>` e una catena di 19 `{active === 'x' && <XPage />}`. Nessun router, nessuna
transizione, nessuna gerarchia: **19 voci di menu tutte allo stesso livello**, di cui 9 nascoste in
modalità Semplice.

### 2.2 Design system attuale

- `src/renderer/src/index.css`: variabili shadcn standard (`--background`, `--primary`, …) in
  light/dark. Palette **completamente neutra** (grigi zinc), `--warning` giallo, `--destructive` rosso.
- `tailwind.config.js`: mappatura colori + `borderRadius` da `--radius: 0.5rem`, plugin
  `tailwindcss-animate` (installato ma quasi mai usato).
- Font: system stack (`-apple-system`, `Segoe UI Variable`, …).
- Componenti in `components/ui/`: `button.tsx`, `card.tsx`, `dialog.tsx`, `misc.tsx`
  (Switch, Progress, Label, Checkbox, Input, Badge, Alert, Tabs).

### 2.3 Problemi da risolvere (diagnosi, non opinione)

1. **Zero identità.** Sembra un template shadcn di default: nessun elemento comunica "DJ", "audio",
   "libreria musicale". Il logo/branding compare solo nella pagina Informazioni.
2. **Navigazione piatta.** 19 voci senza raggruppamenti; l'utente non capisce quali funzioni sono
   diagnosi, quali manutenzione, quali export, quali sperimentali.
3. **Feedback frammentato.** Il progresso job (`JobProgressBar`) è duplicato dentro ogni pagina e
   sparisce se cambi pagina; gli esiti sono `<Alert>` statici che si accumulano in fondo alla card.
   Non esiste alcun sistema di notifiche.
4. **Nessuna animazione.** Cambio pagina istantaneo, nessuna transizione di stato, nessun feedback di
   caricamento oltre a una progress bar e a un `…` testuale.
5. **Stati vuoti muti.** A libreria non importata le pagine mostrano `—` o testo grigio, senza guidare
   al passo successivo.
6. **Dati musicali non valorizzati.** BPM, key Camelot, waveform, durata, salute libreria sono
   renderizzati come testo `font-mono` in righe di tabella. Materiale perfetto per data-viz, sprecato.
7. **Densità sbagliata.** Liste con `max-h-48 overflow-auto` e righe `text-xs`; nessuna virtualizzazione
   su librerie da decine di migliaia di tracce.
8. **Onboarding assente.** Al primo avvio l'utente vede una dashboard vuota con tre bottoni di import.

---

## 3. Inventario funzionale COMPLETO (nulla di questo può sparire)

Le 19 pagine attuali, con la funzione e il contratto IPC che devono continuare a coprire.
**Ogni funzione elencata deve esistere nella V2**, eventualmente riorganizzata in una IA migliore.

### Modalità Semplice (sempre visibili)

| # | Pagina | File attuale | Funzione | IPC usate |
|---|---|---|---|---|
| 1 | **Panoramica** (Dashboard) | `pages/Dashboard.tsx` | Stat card (brani/playlist/da revisionare), banner preflight (sidecar + chiave), import collection XML, import diretto `master.db` (con auto-rilevamento del percorso Rekordbox), import da Traktor/VirtualDJ/Engine, apertura guida export | `library.stats`, `library.ingestXml`, `library.ingestMasterdb`, `library.importForeign`, `library.importSerato`, `sidecar.check`, `rekordbox.defaultPaths`, `preflight.get/rerun/onUpdate`, `dialog.openFile` |
| 2 | **Salute libreria** | `pages/HealthPage.tsx` | Punteggio 0–100 + 8 righe diagnostiche (BPM/key/genere/anno mancanti, da revisionare, duplicati, senza hot cue, con impronta) con percentuali e suggerimenti "dove sistemarlo" | `health.get` |
| 3 | **Backup** | `pages/BackupPage.tsx` | Backup smart incrementale: piano (dry-run con conteggio file e byte) poi esecuzione; scelta cartella musica + cartella backup | `backup.plan`, `backup.execute`, `dialog.openDirectory`, `jobs.onProgress` |
| 4 | **File orfani** | `pages/OrphansPage.tsx` | Scansione disco vs libreria, selezione multipla, quarantena reversibile o eliminazione — entrambe con doppia conferma e dry-run | `orphans.scan`, `orphans.quarantine`, `orphans.remove` |
| 5 | **Report Excel** | `pages/ReportPage.tsx` | Generazione .xlsx (opzioni: notazione Camelot, raggruppa per artista) + anteprima in-app del foglio generato | `report.generate`, `report.view`, `dialog.saveFile` |
| 6 | **Report SIAE** | `pages/SiaePage.tsx` | Lettura cronologia di riproduzione dal `master.db`, elenco sessioni, export foglio SIAE con locale e data evento | `siae.readHistory`, `siae.sessions`, `siae.export` |
| 7 | **Converti libreria** | `pages/ConverterPage.tsx` | Matrice di compatibilità import/export per software, export verso Rekordbox XML / Traktor .nml / VirtualDJ XML, card "Serato: non ancora" con motivazione, guida all'import | `exporter.limits`, `exporter.rekordboxXml`, `exporter.traktorNml`, `exporter.virtualdjXml` |
| 8 | **Da revisionare** | `pages/ReviewPage.tsx` | Tabella paginata delle tracce con tag corrotti/mojibake, con motivo e percorso file | `library.page({ needsReview: true })` |
| 9 | **Registro operazioni** | `pages/LogPage.tsx` | Tabella log operazioni (quando/operazione/esito/dettaglio) + export .txt | `oplog.list`, `oplog.exportTxt` |
| 10 | **Impostazioni** | `pages/SettingsPage.tsx` | Tema (chiaro/scuro/auto), lingua (it/en/fr/de), switch modalità Esperto, **gate di sicurezza** `directWrites` e `masterDbWrites` (con conferma nativa nel main), token Discogs, stato sidecar, download chiave | `settings.get/set`, `security.setGate`, `sidecar.check`, `sidecar.downloadKey` |
| 11 | **Informazioni** | `pages/AboutPage.tsx` | Credits, logo Rekordbox DJ Italia, disclaimer marchi | — |

### Modalità Esperto (sperimentali, ognuna con disclaimer obbligatorio)

| # | Pagina | File attuale | Funzione | IPC usate |
|---|---|---|---|---|
| 12 | **Ritrova file spostati** (Relocator) | `pages/RelocatorPage.tsx` | Trova i file con percorso rotto, li ricerca in una nuova root per nome file (dry-run → XML di aggiornamento); sezione separata **match per impronta** che ritrova anche i file rinominati | `relocator.findBroken`, `relocator.matchAndWrite`, `relocatorFp.match`, `relocatorFp.writeXml` |
| 13 | **Duplicati (impronta)** | `pages/DedupPage.tsx` | Fingerprint acustico (fpcalc/Chromaprint) → gruppi di duplicati veri, selezione per gruppo, quarantena con doppia conferma | `dedup.run`, `orphans.quarantine` |
| 14 | **Auto-Cue** | `pages/AutoCuePage.tsx` | Analisi onset/energia (aubio) → fino a 8 cue proposti per traccia, **waveform SVG interattiva con marker trascinabili**, elaborazione batch con annulla, salvataggio singolo o massivo | `cues.analyze`, `cues.save`, `library.page`, `jobs.cancel` |
| 15 | **Auto-Tagger** | `pages/TaggerPage.tsx` | Completamento anno/genere via MusicBrainz o Discogs (sole query testuali, 1 req/s, solo match ad alta confidenza), proposte da approvare una a una, applicazione su UDM o — opt-in — sui file originali | `tagger.propose`, `tagger.apply` |
| 16 | **Stems** | `pages/StemsPage.tsx` | Separazione voce/batteria/basso (Demucs) su file nuovi, operazione lunga e annullabile | `stems.run`, `jobs.cancel` |
| 17 | **Nuovi Acquisti** (Inbox / Sync Daemon) | `pages/InboxPage.tsx` | Sorveglianza cartella mentre l'app è aperta, coda di nuovi file, preparazione XML con playlist "CrateForge – Nuovi Acquisti", dismissione elementi | `watcher.start/stop/status/scan/onNewItems`, `inbox.list/setStatus/prepareXml` |
| 18 | **Set Planner** | `pages/PlannerPage.tsx` | Analisi read-only di una playlist: transizioni armoniche problematiche (ruota Camelot), salti BPM > 6%, tracce-ponte suggerite | `planner.playlists`, `planner.analyze` |
| 19 | **Set Builder** | `pages/SetBuilderPage.tsx` | Costruzione scaletta da traccia di partenza: lunghezza, curva BPM (up/flat/down), risultato ordinato con BPM+Camelot, export XML o — opt-in con conferma "MASTERDB" — scrittura playlist diretta nel `master.db` | `setbuilder.build`, `setbuilder.exportXml`, `masterdb.createPlaylist` |

### Componenti trasversali da conservare (nella sostanza, non nella forma)

| Componente | File | Cosa fa | Cosa deve diventare |
|---|---|---|---|
| `DangerConfirmDialog` | `components/DangerConfirmDialog.tsx` | Doppia conferma: digita la parola chiave (`ELIMINA`, `MASTERDB`, …) **e** spunta "ho capito i rischi" | Resta identico nel comportamento, ridisegnato: gerarchia visiva della gravità, animazione d'ingresso, bottone armato solo a doppia conferma completa |
| `SaveTargetNotice` | `components/SaveTargetNotice.tsx` | Badge che dichiara sempre dove è finito un salvataggio: `udm` / `copy` / `xml` / `original` / `masterdb` | Elemento di design di primo piano: deve essere impossibile non vederlo |
| `RekordboxDiff` | `components/RekordboxDiff.tsx` | Nota inline "rispetto a Rekordbox" per ogni pagina (testi nel namespace `rbdiff`) | Ridisegnare come "insight card" ricorrente, non come banner grigio |
| `JobProgress` | `components/JobProgress.tsx` | Ascolta `jobs.onProgress` (jobId/phase/done/total) e mostra fase + % | **Diventa la barra job globale** (§6.2) |
| `GuideDialog` | `components/GuideDialog.tsx` | Guide passo-passo: export XML da Rekordbox, import XML in Rekordbox | Ridisegnare come guida a step illustrati |
| `ExcelViewer` | `components/ExcelViewer.tsx` | Anteprima paginata del .xlsx generato | Tabella dati moderna |
| `Waveform` | `components/Waveform.tsx` | SVG con envelope RMS (max ~480 bucket, dal sidecar) + marker cue trascinabili con pointer capture | **Elemento signature del prodotto** (§5.5) |

### i18n — vincolo strutturale

- `lib/i18n.ts` — dizionario piatto per navigazione e testi comuni, 4 lingue, tipizzato (`MsgKey`).
- `lib/i18nPages.ts` — 2113 righe, un namespace per pagina per lingua, con segnaposto `{n}`.
- `tests/i18nParity.test.ts` verifica la **parità di chiavi tra le 4 lingue**: se aggiungi una stringa
  in italiano devi aggiungerla anche in en/fr/de, altrimenti il test fallisce.

**Ogni testo nuovo introdotto dal redesign va tradotto in tutte e 4 le lingue.** Nessuna stringa
hard-coded nei componenti.

---

## 4. Direzione di design richiesta

### 4.1 Principio guida

> **Attrezzatura da studio, non giocattolo da club.**
> L'utente è un DJ che sta facendo manutenzione alla propria libreria — spesso migliaia di file,
> spesso operazioni lunghe, sempre con la paura di rompere qualcosa. L'interfaccia deve trasmettere
> **precisione, controllo e sicurezza**, con l'eleganza di un software professionale moderno.

### 4.2 DUE FAMIGLIE DI TEMA, scelte dall'utente

Il selettore tema nelle Impostazioni deve offrire **due assi indipendenti**:

- **Asse 1 — Stile:** `Studio` | `Neutro`
- **Asse 2 — Luminosità:** `Chiaro` | `Scuro` | `Auto (sistema)`

→ 6 combinazioni, tutte da implementare e curate. Persistite in `settings` come chiavi separate
(`themeStyle`, `theme`). Il cambio tema è **animato** (transizione morbida di colori, non un flash).

#### Tema A — "Studio" (pro DJ / hardware da club)

Ispirato ad attrezzatura professionale: CDJ, mixer, rack da studio.

- **Superfici stratificate**: fondo profondo, pannelli leggermente più chiari, bordi sottili quasi
  impercettibili, ombre morbide. Sensazione di pannelli fisici sovrapposti.
- **Materiale**: leggero effetto vetro/metallo sugli elementi flottanti (barra job, palette comandi,
  dialog) — blur di sfondo contenuto, mai sfocatura pesante che costa performance.
- **Accento**: **un solo colore caldo/tecnico**, tipo ambra-arancio da display di attrezzatura, oppure
  un blu acciaio. Usato con parsimonia: stato attivo, focus, valori chiave.
- **Tipografia**: sans geometrica per l'interfaccia, **monospace tabellare per tutti i valori
  numerici** (BPM, key, durate, conteggi, percentuali) — le cifre non devono mai ballare quando
  cambiano.
- **Texture**: ammesso un grain/noise sottilissimo sulle superfici grandi, se non degrada le
  performance.

#### Tema B — "Neutro" (premium software, stile Linear/Arc)

- Grigi raffinati e ariosi, molto respiro, gerarchia costruita con spaziatura e peso tipografico più
  che con il colore.
- Un unico accento sobrio, bordi netti, ombre minime.
- Densità leggermente più bassa del tema Studio.

### 4.3 VINCOLO ASSOLUTO: NIENTE NEON

**Nessun colore neon, nessun glow, nessun bagliore, nessun cyberpunk, nessun gradiente saturo
ciano/magenta/verde acido, nessun testo luminescente, nessun bordo che pulsa colorato.**

Questo è un requisito esplicito del committente e non è negoziabile in nessuna delle due famiglie di
tema. Il colore va usato **come informazione** (stato, gravità, categoria), mai come decorazione.
La palette dati per waveform, grafici e ruota Camelot deve restare **desaturata e leggibile**, con
contrasto AA garantito in tutte e 6 le combinazioni di tema.

### 4.4 Semantica del colore (invariante)

| Significato | Uso |
|---|---|
| **Neutro** | Stato normale, informazione |
| **Warning** | Limite dichiarato, dry-run, funzione sperimentale, dati mancanti |
| **Destructive** | Azione irreversibile, scrittura su originali/master.db, errore |
| **Success** | Operazione conclusa, verifica superata |
| **Accento** | Stato attivo, focus, valore in evidenza — mai per decorare |

La modalità **Esperto** deve essere riconoscibile a colpo d'occhio in tutta la shell (non solo un
badge in cima alla sidebar): l'utente deve sempre sapere quando le funzioni pericolose sono sbloccate.

### 4.5 Tipografia e densità

- Scala tipografica esplicita e coerente (display / titolo pagina / titolo sezione / corpo / caption /
  mono-dati). Niente `text-xs` sparso a caso come oggi.
- Numeri tabellari ovunque compaiano dati (`font-variant-numeric: tabular-nums`).
- Densità regolabile: valuta un'impostazione **Comoda / Compatta** per le liste lunghe (opzionale ma
  gradita).

---

## 5. Cosa deve avere una UI da DJ moderna (elementi richiesti)

### 5.1 Shell riprogettata

- **Sidebar con gruppi semantici**, collassabile, con icone sempre visibili in stato collassato.
  Raggruppamento suggerito (puoi proporne uno migliore, motivandolo):
  - *Libreria* — Panoramica, Salute, Da revisionare
  - *Manutenzione* — Backup, File orfani, Ritrova file spostati, Duplicati
  - *Arricchimento* — Auto-Cue, Auto-Tagger, Stems
  - *Set & Playlist* — Set Builder, Set Planner, Nuovi Acquisti
  - *Export & Report* — Converti libreria, Report Excel, Report SIAE
  - *Sistema* — Registro, Impostazioni, Informazioni
- **Le funzioni Esperto restano nascoste in modalità Semplice** (comportamento attuale da preservare),
  ma quando sono visibili devono essere marcate come tali.
- **Topbar**: titolo pagina + breadcrumb, ricerca globale (⌘K/Ctrl+K), indicatore stato libreria
  (n. tracce), campanella notifiche, switch tema rapido, badge modalità.
- **Statusbar in basso**: stato sidecar/preflight, database attivo, job in corso.
- macOS: la finestra usa `titleBarStyle: 'hiddenInset'` — il layout deve lasciare spazio ai semafori
  in alto a sinistra. Windows: `autoHideMenuBar: true`. Valuta una title bar custom coerente su
  entrambi i sistemi (facoltativo, ma se la fai deve funzionare su entrambi).

### 5.2 Dashboard degna del nome

Non più tre stat card e due bottoni. Deve rispondere a colpo d'occhio a: *com'è messa la mia libreria
e cosa devo fare adesso?*

- Health score come elemento visivo forte (radiale animato, non un cerchio con bordo `border-4`)
- Distribuzione BPM e distribuzione key/Camelot della libreria
- Andamento crescita libreria se il dato è ricavabile (altrimenti ometti, non inventare)
- Card "azioni consigliate" derivate dai dati reali di `health.get` (es. *"1.284 tracce senza hot cue
  → apri Auto-Cue"*), che portano direttamente alla pagina giusta
- Stato ultimo import e ultimo backup
- Se la libreria è vuota → **stato di primo avvio guidato**, non una dashboard di trattini

### 5.3 Ruota Camelot

Componente riutilizzabile, usato in Set Planner, Set Builder e nella dashboard: ruota armonica
interattiva che evidenzia le key compatibili rispetto a una traccia selezionata, e mostra le
transizioni problematiche di una scaletta. Colori desaturati, leggibili in tutti e 6 i temi.
La logica esiste già in `src/core/camelot.ts` e `src/core/harmony.ts`: **riusala, non riscriverla**.

### 5.4 Liste tracce professionali

- Virtualizzazione obbligatoria (librerie da 50.000+ tracce)
- Colonne configurabili, ordinamento, ricerca con debounce, filtri rapidi
- Selezione multipla con shift-click e ⌘/Ctrl-click, contatore selezione persistente, azioni bulk in
  una barra contestuale che appare in fondo quando c'è una selezione
- Riga traccia densa e leggibile: artista/titolo, BPM, key Camelot, durata, badge stato (tag mancanti,
  da revisionare, senza cue, duplicato)
- Skeleton loading, non `…`

### 5.5 Waveform — elemento signature

Il componente `Waveform.tsx` attuale (envelope RMS SVG + marker cue trascinabili) va **riscritto come
componente di punta**:

- Rendering su `<canvas>` per performance (o SVG ottimizzato se dimostri che regge)
- Marker cue trascinabili con feedback fluido, snap opzionale, tooltip con timecode
- Colori cue rispettati, etichette leggibili, zoom se sensato
- Nessuna riproduzione audio (scelta di prodotto: l'ascolto resta in Rekordbox) — ma l'interazione di
  posizionamento deve risultare precisa e piacevole
- Deve funzionare bene sia in tema Studio sia in tema Neutro

### 5.6 Micro-interazioni e animazioni

Obbligatorie, ma **al servizio della comprensione**, mai gratuite:

- Transizioni di pagina (fade/slide breve, coerente con la direzione della navigazione)
- Animazioni di lista (entrata/uscita di risultati, riordino)
- Numeri che si animano verso il valore (conteggi, health score) — con `tabular-nums` per non ballare
- Progress determinato e indeterminato distinti visivamente
- Stati hover/press/focus definiti su tutto ciò che è interattivo
- Skeleton su ogni caricamento
- Feedback di successo/errore chiaro e non invasivo
- **Ogni animazione deve rispettare `prefers-reduced-motion`**: con motion ridotto l'app resta
  completamente usabile, senza movimento superfluo.
- Durate brevi (120–280 ms per la maggior parte), easing coerente, nessuna animazione che blocchi
  l'interazione.

### 5.7 Accessibilità (non opzionale)

- Contrasto AA minimo su tutti i testi, in tutte e 6 le combinazioni tema
- Navigazione completa da tastiera, focus ring sempre visibile
- Ruoli/label ARIA corretti (Radix aiuta: continua a usarlo)
- Nessuna informazione veicolata **solo** dal colore (sempre icona o testo di supporto)
- Target cliccabili adeguati

---

## 6. Nuove funzionalità UX richieste (tutte e quattro)

### 6.1 Notifiche toast + centro notifiche

- Toast non bloccanti per: esito operazioni, job completati/falliti, nuovi file rilevati dal watcher
  "Nuovi Acquisti", warning di preflight.
- Varianti: info / success / warning / destructive, con azione opzionale (*Apri cartella*, *Vedi
  dettagli*, *Annulla*).
- **Centro notifiche** raggiungibile dalla campanella in topbar: storico consultabile della sessione,
  con timestamp, filtro per tipo, "segna tutte come lette", link alla pagina/log pertinente.
- I toast **non sostituiscono** gli avvisi di sicurezza inline: un warning che dichiara un limite
  prima di un'operazione resta inline e persistente. I toast servono agli **esiti**.
- Le notifiche devono essere localizzate (4 lingue).

### 6.2 Barra job globale + coda

- Il progresso non vive più dentro la card della pagina: **barra job persistente** (statusbar o
  pannello flottante) sempre visibile, che sopravvive al cambio pagina.
- Mostra: nome operazione, fase corrente (le fasi esistenti: `scan`, `copy`, `ingest-xml`,
  `ingest-masterdb`, `orphan-scan`, `excel`, `relocate-scan` + quelle che aggiungerai), progresso
  determinato o indeterminato, conteggio `done/total`, **ETA stimata**, pulsante **Annulla**.
- **Coda visibile** con espansione a pannello: job in corso + accodati + ultimi completati.
- Alla fine del job: toast di esito + voce nel centro notifiche + riga nel Registro operazioni.
- L'IPC attuale emette `job:progress` con `{ jobId, phase, done, total }` e supporta `job:cancel`.
  Se ti serve un modello a più job concorrenti puoi estendere il main (§9), purché resti compatibile
  con il comportamento esistente e la cancellazione continui a funzionare.

### 6.3 Command palette ⌘K + scorciatoie

- Palette (Ctrl+K su Windows, ⌘K su macOS) con:
  - navigazione a tutte le pagine (rispettando la visibilità Semplice/Esperto)
  - ricerca tracce nella libreria (usa `library.page({ search })`, con debounce)
  - azioni rapide: importa XML, genera report, avvia backup, cambia tema, cambia lingua, attiva/
    disattiva modalità Esperto
- **Le azioni distruttive non si eseguono dalla palette**: la palette può solo *portare* alla pagina
  con il flusso di conferma. Nessuna scorciatoia deve poter innescare una quarantena, una
  cancellazione o una scrittura su `master.db`.
- Scorciatoie da tastiera per le operazioni frequenti + **cheatsheet** consultabile (es. `?`), tutte
  localizzate e con label corrette per piattaforma (⌘ su mac, Ctrl su Windows).

### 6.4 Onboarding + empty state guidati — **con rilevamento multi-software**

**Requisito esplicito del committente:** l'onboarding non deve rilevare solo Rekordbox, ma **tutti i
software DJ supportati dall'app**.

Al primo avvio (nessuna libreria importata), wizard a step:

1. **Benvenuto** — cosa fa CrateForge e cosa non fa (il "meccanico della libreria"), con le tre
   promesse di sicurezza: mai sugli originali, dry-run, doppia conferma.
2. **Rilevamento automatico installazioni DJ** — l'app scansiona i percorsi noti e mostra una card per
   ciascun software trovato, con percorso, tipo di file rilevato e stato "pronto all'import":
   - **Rekordbox** — `master.db` + `options.json` (logica già esistente in
     `src/main/rekordboxPaths.ts`, riusala)
   - **Traktor** — `collection.nml` (reader già esistente: `src/adapters/traktor/nmlReader.ts`)
   - **VirtualDJ** — database XML (reader: `src/adapters/virtualdj/vdjReader.ts`)
   - **Serato** — cartella `_Serato_` (reader: `src/adapters/serato/index.ts`)
   - **Engine DJ** — Engine Library (reader: `src/adapters/engine/engineReader.ts`)

   **Come implementarlo correttamente:** crea un modulo di rilevamento nel main (es.
   `src/main/djSoftwarePaths.ts`) sul modello di `rekordboxPaths.ts` — percorsi **calcolati dalla home
   dell'utente via `app.getPath()`, mai hard-coded**, con `existsSync` per la verifica, per Windows e
   macOS. Esponi il risultato via una nuova IPC (es. `detect:djSoftware`).

   **Verifica sempre i percorsi con `existsSync` e degrada in silenzio**: se un software non c'è, la
   sua card non compare (o compare come "non rilevato" con opzione *Sfoglia manualmente*). **Non
   dichiarare mai come "rilevato" un percorso che non hai verificato sul filesystem.** Le posizioni di
   default variano per versione e installazione: prevedi sempre più candidati e il fallback manuale.

3. **Import** — l'utente sceglie da quale software importare (uno o più); si riusano le IPC esistenti
   (`ingestMasterdb`, `ingestXml`, `importForeign`, `importSerato`); progresso mostrato nella barra job
   globale.
4. **Prima diagnosi** — a import concluso, si mostra l'health score e le 2–3 azioni consigliate.
5. **Preferenze** — tema (stile + luminosità), lingua, modalità Semplice/Esperto con spiegazione di
   cosa sblocca.

L'onboarding è **saltabile** e **ripetibile** dalle Impostazioni. Stato persistito in `settings`.

**Empty state**: ogni pagina, quando non ha dati, mostra un'illustrazione/icona coerente, una frase
che spiega *perché* è vuota e un bottone che porta all'azione che la riempie. Mai un `—` muto.

---

## 7. Stack tecnico consentito

Hai libertà di aggiungere dipendenze moderne. Indicazioni:

| Ambito | Consigliato |
|---|---|
| Animazioni | `framer-motion` (o `motion`) |
| Toast | `sonner` |
| Command palette | `cmdk` |
| Virtualizzazione liste | `@tanstack/react-virtual` |
| Grafici | libreria leggera a tua scelta, oppure SVG/canvas custom (spesso preferibile per waveform e ruota Camelot) |
| Routing | opzionale (`react-router` in memory history), oppure un router interno tipizzato — l'attuale catena di `&&` va comunque sostituita |
| Stato | Context già presente; se serve, `zustand` per lo stato job/notifiche |
| Base UI | Radix (già in progetto) + shadcn/ui riscritto sul nuovo design system |

**Vincoli tecnici non negoziabili sulle dipendenze:**

- **CSP severa**: `index.html` dichiara
  `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`.
  → **Tutto deve essere bundlato localmente**: niente CDN, niente font remoti, niente chiamate di rete
  dal renderer. Se usi font custom, includili come asset locali.
- Il renderer gira con `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
  → Nessuna dipendenza che richieda accesso a Node dal renderer.
- Bundle: mantieni l'avvio rapido. Motiva nel report ogni dipendenza aggiunta.

---

## 8. Cosa devi produrre in `C:\Users\Vale\Desktop\Claude-Projects\Crateforge-V2`

1. **Progetto completo e funzionante** — copia della sorgente con il renderer riscritto,
   `npm install && npm run dev` avvia l'app nuova.
2. **`src/renderer/` interamente ricostruito**: design system, shell, 19 pagine (riorganizzate come
   proponi), componenti trasversali, sistema notifiche, barra job, command palette, onboarding.
3. **Design system documentato** — `docs/DESIGN-SYSTEM.md`: token colore per le 6 combinazioni di
   tema, scala tipografica, spaziature, raggi, ombre, durate ed easing delle animazioni, regole d'uso
   dei componenti.
4. **`docs/REDESIGN-NOTES.md`** — cosa è cambiato rispetto alla V1, mappatura vecchia pagina → nuova
   collocazione, decisioni di design con motivazione, dipendenze aggiunte e perché, cosa **non** hai
   fatto e perché.
5. **i18n completa** — tutte le stringhe nuove in it/en/fr/de, `tests/i18nParity.test.ts` verde.
6. **Test verdi** — `npm test` passa. Se un test dipendeva dalla vecchia UI, adattalo *senza ridurne
   la copertura*; se aggiungi logica UI significativa, aggiungi test.
7. **README aggiornato** con screenshot/descrizione della nuova interfaccia.

---

## 9. Vincoli di sicurezza — NON NEGOZIABILI

Puoi rifattorizzare il main, ma **nessuna di queste garanzie può essere indebolita**. Sono il motivo
per cui l'app è affidabile.

1. **Mai scritture sui file originali** (audio o database) se non tramite i gate espliciti già
   esistenti (`directWrites`, `masterDbWrites`), che passano da **conferma nativa nel main** — non da
   `settings.set`. Questo canale (`security:setGate`) deve restare intatto.
2. **Doppia conferma** (parola chiave digitata + checkbox) su ogni azione distruttiva. Il pattern di
   `DangerConfirmDialog` va conservato nel comportamento; puoi solo migliorarlo.
3. **Dry-run di default** su tutte le operazioni di massa: prima l'anteprima, poi la conferma.
4. **Quarantena reversibile**, mai cancellazione diretta senza percorso di ripristino.
5. **Ogni esito dichiara la destinazione** (`SaveTargetNotice`): database interno, copia, XML,
   originali, master.db. Nessun salvataggio silenzioso.
6. **Ogni operazione finisce nel log** (`oplog`), esportabile.
7. **Il renderer resta sandboxed**: `contextIsolation: true`, `nodeIntegration: false`,
   `sandbox: true`, tutto passa dal `contextBridge` in `src/preload/index.ts`.
8. **Nessuna navigazione fuori dall'app**, apertura esterna solo `http/https` (handler già presente in
   `src/main/index.ts`): non toccare.
9. **Il sidecar Python legge il `master.db` cifrato in sola lettura**; Node non apre mai il DB cifrato.
   Se il sidecar manca → **modalità solo-XML**, con tutte le funzioni ancora usabili. La UI deve
   comunicare questa degradazione con chiarezza, non nasconderla.
10. **Nessuna chiamata di rete dal renderer.** Le uniche query esterne (MusicBrainz/Discogs) partono
    dal main con rate-limit; non spostarle nel renderer.
11. Se estendi il contratto IPC (job multipli, rilevamento software, notifiche persistite): **aggiungi,
    non rimuovere**, e mantieni tipizzazione e validazione degli input come nel codice attuale.

---

## 10. Metodo di lavoro suggerito

**Fase 0 — Studio.** Leggi la sorgente in sola lettura: `App.tsx`, tutte le pagine, `components/`,
`lib/i18n.ts`, `lib/i18nPages.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `README.md`,
`PROGRESS.md`. Costruisci la mappa completa funzione → IPC → stato UI prima di disegnare qualsiasi cosa.

**Fase 1 — Copia e setup.** Copia il progetto in `Crateforge-V2` (esclusi build artifact e
`node_modules`), verifica che la baseline compili e che i test passino *prima* di cambiare la UI.
Questa è la tua rete di sicurezza.

**Fase 2 — Design system.** Token, temi (6 combinazioni), tipografia, componenti base. Costruisci una
pagina/route interna di anteprima dei componenti (kitchen sink) per validarli in tutti i temi.

**Fase 3 — Shell.** Sidebar a gruppi, topbar, statusbar, routing con transizioni, barra job globale,
sistema notifiche, command palette.

**Fase 4 — Pagine.** Una alla volta, partendo da Dashboard → Salute → le altre. Ogni pagina deve
restare funzionante contro le IPC reali prima di passare alla successiva.

**Fase 5 — Onboarding e rilevamento multi-software.** Modulo di detection nel main + wizard.

**Fase 6 — Rifinitura.** Animazioni, empty state, accessibilità, performance su libreria grande,
verifica dei 6 temi, `prefers-reduced-motion`, i18n completa, test.

**Fase 7 — Report.** `docs/REDESIGN-NOTES.md` + README + istruzioni di avvio.

---

## 11. Criteri di accettazione (checklist finale)

- [ ] `npm install && npm run dev` avvia l'app nuova senza errori
- [ ] `npm test` verde, inclusa la parità i18n a 4 lingue
- [ ] `npm run build` compila
- [ ] Tutte e 19 le funzioni della V1 sono presenti e funzionanti
- [ ] Modalità Semplice/Esperto funziona: le funzioni Esperto sono nascoste in Semplice e la modalità
      attiva è sempre riconoscibile
- [ ] Tutti i gate di sicurezza, le doppie conferme, i dry-run e i `SaveTargetNotice` sono al loro posto
- [ ] Tema: 2 stili × 3 luminosità = 6 combinazioni, tutte curate e con contrasto AA
- [ ] **Nessun elemento neon, glow o gradiente saturo, in nessun tema**
- [ ] Toast + centro notifiche funzionanti e localizzati
- [ ] Barra job globale che sopravvive al cambio pagina, con fase, %, ETA e annulla
- [ ] Command palette ⌘K/Ctrl+K con navigazione, ricerca tracce e azioni rapide — **senza azioni
      distruttive**
- [ ] Onboarding che rileva **Rekordbox, Traktor, VirtualDJ, Serato ed Engine DJ** con verifica reale
      dei percorsi su Windows e macOS, e fallback manuale
- [ ] Empty state guidato su ogni pagina
- [ ] Liste virtualizzate, fluide su libreria da decine di migliaia di tracce
- [ ] Waveform interattiva riscritta e performante
- [ ] Ruota Camelot funzionante, basata su `core/camelot.ts` e `core/harmony.ts`
- [ ] `prefers-reduced-motion` rispettato ovunque
- [ ] Nessuna stringa hard-coded: tutto in i18n, 4 lingue
- [ ] CSP rispettata: zero risorse remote
- [ ] La cartella sorgente originale è **inalterata**

---

## 12. In caso di dubbio

- **Funzionalità vs estetica** → vince la funzionalità.
- **Estetica vs sicurezza** → vince la sicurezza.
- **Animazione vs performance su libreria grande** → vince la performance.
- **Dubbio su un percorso di installazione di un software DJ** → verifica con `existsSync` e offri il
  fallback manuale; non inventare percorsi né dichiarare rilevamenti non verificati.
- **Dubbio su un comportamento della V1** → leggi il codice sorgente, non indovinare. Se resta
  ambiguo, conserva il comportamento attuale e segnalalo nel report.
