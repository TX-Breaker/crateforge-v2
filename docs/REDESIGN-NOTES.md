# CrateForge V2 — note di redesign

Cosa è cambiato passando dalla V1 (`TrackList-Tool/crateforge`) alla V2, perché, e
cosa è stato deliberatamente lasciato fuori.

La cartella V1 **non è stata toccata**: la V2 è una copia indipendente.

---

## 1. Architettura dell'informazione

La V1 esponeva **diciannove voci di menu piatte**, nove delle quali sparivano in
modalità Semplice: l'utente non poteva distinguere diagnosi, manutenzione ed export.

La V2 tiene **tutte e diciannove le funzioni** ma le fa atterrare su **tredici
destinazioni** dentro **sei gruppi semantici**. Le pagine che rispondevano alla stessa
domanda diventano tab della stessa destinazione, invece di farsi concorrenza nella
sidebar.

### Mappa di migrazione — niente è andato perso

| # | Pagina V1 | Destinazione V2 |
|---|---|---|
| 01 | Panoramica | **Panoramica** |
| 02 | Salute libreria | **Salute** |
| 03 | Backup | **Backup** |
| 04 | File orfani | **Pulizia › Orfani** |
| 05 | Report Excel | **Report › Excel** |
| 06 | Report SIAE | **Report › SIAE** |
| 07 | Converti libreria | **Converti** |
| 08 | Da revisionare | **Tracce › filtro "Da revisionare"** |
| 09 | Registro operazioni | **Attività** |
| 10 | Impostazioni | **Impostazioni › Generale · Sicurezza · Motore** |
| 11 | Informazioni | **Impostazioni › Informazioni** |
| 12 | Ritrova file spostati | **Ritrova file › Per nome · Per impronta** |
| 13 | Duplicati (impronta) | **Pulizia › Duplicati** |
| 14 | Auto-Cue | **Arricchisci › Cue** |
| 15 | Auto-Tagger | **Arricchisci › Tag** |
| 16 | Stems | **Arricchisci › Stems** |
| 17 | Nuovi Acquisti | **Nuovi acquisti** |
| 18 | Set Planner | **Set › Analizza** |
| 19 | Set Builder | **Set › Costruisci** |

Le fusioni sono **tab dentro una pagina, mai rimozioni**. Ogni contratto IPC della
V1 ha ancora il suo chiamante: è cambiato solo l'indirizzo della rotta.

In modalità Semplice restano visibili nove destinazioni su tredici — esattamente
come la V1 nascondeva nove voci su diciannove.

---

## 2. Cosa è nuovo nella UX

- **Barra job globale.** Il progresso non vive più dentro la card della pagina: è una
  striscia della shell che sopravvive al cambio rotta, con fase, done/total, **ETA
  calcolata sul ritmo reale**, annulla e coda espandibile. La coda è vera: le
  operazioni successive partono quando la prima finisce (`lib/jobs.tsx`).
- **Notifiche e centro notifiche.** Toast per gli esiti, campanella con contatore dei
  non letti, storico di sessione filtrabile. Regola di prodotto: **un limite dichiarato
  non diventa mai un toast** — resta inline e persistente sulla pagina.
- **Palette comandi ⌘K / Ctrl+K.** Navigazione, ricerca tracce con debounce, azioni
  rapide. I comandi distruttivi sono **elencati, marcati e disabilitati**: selezionarli
  apre la pagina con il suo flusso di conferma intatto.
- **Primo avvio guidato in cinque passi** con **rilevamento multi-software**: Rekordbox,
  Traktor, VirtualDJ, Serato, Engine DJ.
- **Stati vuoti guidati** ovunque: motivo + via d'uscita, mai un trattino muto.
- **Due assi di tema** (stile × luminosità), densità delle liste, riduzione animazioni.
- **Liste virtualizzate**: una libreria da decine di migliaia di brani scorre a frame rate.

---

## 3. Modifiche al processo main

Il refactor era consentito; è stato **additivo**, mai sottrattivo.

| Aggiunta | Perché |
|---|---|
| `src/main/djSoftwarePaths.ts` + IPC `detect:djSoftware` | rilevamento di tutti i software DJ per il primo avvio. Percorsi derivati da `app.getPath`, **mai hard-coded**, ognuno verificato con `existsSync` prima di comparire. Traktor viene enumerato perché la cartella porta la versione nel nome. |
| `getLibraryDistribution` in `core/udm.ts` + IPC `library:distribution` | istogramma BPM e copertura tonalità per la Panoramica: **conteggi calcolati in SQL**, mai la libreria intera sul bridge. |
| Manifest di quarantena in `services/orphans/orphanFinder.ts` + IPC `quarantine:list` / `quarantine:restore` | senza la provenienza di ogni file "reversibile" sarebbe una parola. Il ripristino **non sovrascrive mai**: se all'origine c'è già un file, la voce viene saltata e dichiarata. |
| IPC `shell:showFolder` | apre una cartella nel file manager. Accetta **solo directory esistenti**: `shell.openPath` su un percorso arbitrario sarebbe un'esecuzione mascherata. |
| IPC `window:setOverlayTheme` | su Windows i pulsanti di sistema sono disegnati dall'OS sopra la nostra striscia: al cambio tema va aggiornato il colore. Accetta **solo colori esadecimali validati**. |
| `titleBarStyle: 'hidden'` + `titleBarOverlay` su Windows | title bar custom senza pulsanti finti: chiudi/minimizza restano nativi. |
| `assetsInlineLimit: 0` nel renderer | **bug reale trovato in verifica**: Vite inlineava i font in `data:` URI e la CSP `default-src 'self'` li bloccava, facendo ricadere l'app sui font di sistema senza dirlo. |

**Nessuna garanzia di sicurezza è stata indebolita.** Gate con conferma nativa,
doppia conferma, dry-run di default, quarantena reversibile, `SaveTargetNotice` su
ogni esito, oplog completo, renderer sandboxed, sidecar in sola lettura, nessuna
chiamata di rete dal renderer: tutto invariato.

---

## 4. Dipendenze aggiunte

| Pacchetto | Perché |
|---|---|
| `framer-motion` | transizioni di rotta, entrata/uscita della barra job e della coda |
| `sonner` | toast, con stile riscritto sui token |
| `cmdk` | palette comandi |
| `@tanstack/react-virtual` | liste tracce virtualizzate |
| `@radix-ui/react-popover` | centro notifiche in topbar |
| `@fontsource/archivo`, `@fontsource/jetbrains-mono` | font bundlati localmente (la CSP vieta i font remoti) |

Nessuna libreria di charting: i grafici sono SVG scritti a mano, più leggeri di un
runtime e senza risorse esterne.

---

## 5. i18n

Struttura invariata (`i18n.ts` per navigazione e testi comuni, `i18nPages.ts` per le
pagine), ma la parità ora è **imposta due volte**:

- **a compile-time**: il tipo `PageDict` è derivato dal dizionario italiano, quindi
  en/fr/de non compilano se manca o avanza una chiave;
- **a test-time**: `tests/i18nParity.test.ts`, invariato.

Francese e tedesco stanno in `i18nPagesFrDe.ts` solo per leggibilità: stesse chiavi,
stesso tipo. Le etichette sono state tenute corte abbastanza da reggere la crescita
del tedesco senza spezzare la navigazione. Le scorciatoie sono risolte per
piattaforma a render time (⌘ su macOS, Ctrl su Windows) in ogni lingua.

---

## 6. Scostamenti dalla specifica di design, dichiarati

1. **Tab Quarantena.** La specifica la descrive come "l'annulla delle prime due", ma
   la V1 non registrava da dove veniva ogni file spostato. Invece di simulare un
   ripristino a indovinare, la V2 **scrive un manifest** al momento della quarantena e
   ripristina solo ciò che il manifest documenta. Per le quarantene fatte con la V1
   (senza manifest) la tab mostra la cartella e permette di aprirla, ma non può
   ripristinare: non c'è modo onesto di sapere dove andavano quei file.
2. **Cattura live SIAE.** La specifica mostra la pagina SIAE con la sola cronologia;
   la V1 aveva un selettore "live" non implementato. La V2 dichiara il limite in un
   avviso invece di mostrare un controllo che non fa nulla.
3. **Voci distruttive nella palette.** La specifica le vuole "elencate ma disabilitate".
   Sono elencate, marcate con lucchetto e la loro selezione **apre la pagina**: un
   elemento completamente inerte in una lista di comandi sembra un bug.
4. **Anteprima SIAE.** La specifica mostra una tabella di anteprima delle righe del
   foglio; l'IPC della V1 non espone le righe di una sessione prima dell'export.
   La V2 mostra i metadati della sessione (brani, data) e dichiara cosa conterrà il
   foglio. Aggiungere l'anteprima richiederebbe una nuova query: non è stato fatto
   per non allargare il contratto IPC oltre il necessario.

---

## 7. Verifica

- `npm run typecheck` — pulito.
- `npm test` — **185 test verdi** (erano 176: la parità i18n è cresciuta con i nuovi
  namespace).
- `npm run build` — bundle main, preload e renderer.
- `npm run test:ipc` — 64 `invoke` ↔ 64 `handle`, 3 eventi: nessun disallineamento.
- `npm run test:ui` — giro completo di 13 destinazioni e 13 tab sul bundle reale:
  nessuna pagina bianca, nessuna chiave i18n grezza, nessun controllo senza nome
  accessibile, quattro palette distinte, densità e reduced-motion attivi, palette
  comandi con le voci distruttive marcate, rientro da Esperto (13 voci) a Semplice (9).
- `npm run test:flows` — primo avvio completo (5 passi, 5 card di rilevamento nei tre
  stati, import → diagnosi) e barra job → toast → centro notifiche con progresso vero.
- `node tests/ui/drive-real.mjs` — app **reale** pilotata via CDP: IPC vivi, preflight
  con sidecar avviabile e chiave pronta, rilevamento che trova il Rekordbox di questa
  macchina e dichiara "non trovato" per gli altri, e `settings.set('directWrites')`
  **rifiutato dal main** — il gate regge a runtime, non solo sulla carta.

Dettagli e comandi in [`tests/ui/README.md`](../tests/ui/README.md).

### Cosa ha trovato la sessione di test

Tre gap reali di accessibilità, corretti:

1. i tre bottoni di luminosità in topbar erano di sola icona e restavano **senza nome
   accessibile** (il tooltip non conta per tastiera e screen reader);
2. le **checkbox di riga** della lista tracce erano ventiquattro caselle mute;
3. l'input dello **stepper** in Set e i due **select** di Converti non avevano nome
   (l'etichetta sopra il controllo non lo nomina).

Verificati con l'albero di accessibilità di Chromium (`Accessibility.getFullAXTree`),
non con un'euristica sul DOM: la prima versione del controllo segnalava anche gli
switch, che invece sono correttamente nominati dalla `<label>` che li avvolge.
