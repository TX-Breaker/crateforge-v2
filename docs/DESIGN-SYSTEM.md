# CrateForge V2 — Design System (implementazione)

Questo documento descrive il design system **come è stato implementato**, non come è
stato disegnato. La specifica originale di Claude Design è in
`docs/design-reference/` (HTML navigabile); qui c'è la traduzione in token, classi e
componenti reali, con i nomi che si usano nel codice.

Regola di fondo: **il colore porta informazione, mai decorazione**. E il vincolo
assoluto ereditato dalla specifica: **nessun neon, nessun glow, nessun gradiente
saturo, nessun bordo pulsante — in nessun tema, su nessun elemento.**

---

## 1. Token

I token vivono in [`src/renderer/src/index.css`](../src/renderer/src/index.css) come
variabili CSS, e sono esposti a Tailwind in
[`tailwind.config.js`](../tailwind.config.js) come `rgb(var(--token) / <alpha-value>)`,
così ogni utility supporta l'alpha (`bg-accent/15` funziona ovunque).

I nomi sono **di ruolo, mai di aspetto**: `surface-2` è "la superficie delle card",
non "grigio scuro". È questo che permette allo stesso componente di rendersi onesto
in tutte e sei le combinazioni di tema.

| Token | Ruolo |
|---|---|
| `canvas` | sfondo dell'app, dietro ogni pannello |
| `surface-1` | sidebar, topbar, barra job, statusbar |
| `surface-2` | card, pannelli, intestazioni di tabella |
| `surface-3` | input, chip, blocchi annidati |
| `surface-hover` | hover di riga e di bottone ghost |
| `surface-expert` | colonna di navigazione quando la modalità Esperto è attiva |
| `line-subtle` / `line` / `line-strong` | cuciture, bordi, bordo in focus |
| `ink-hi` / `ink-mid` / `ink-lo` / `ink-disabled` | testo primario, secondario, terziario, disabilitato |
| `accent` / `accent-hover` / `accent-ink` | stato attivo, focus, il singolo valore chiave di una schermata |
| `warning` / `warning-ink` | limite dichiarato, dry-run, funzione sperimentale, dato mancante |
| `destructive` / `destructive-ink` | azione irreversibile, scrittura su originali o master.db, errore |
| `success` / `success-ink` | operazione conclusa, verifica superata |

### Assi del tema

Due impostazioni indipendenti, persistite separatamente nelle settings dell'UDM:

- `themeStyle` → `studio` | `neutral` | `oled` (attributo `data-style` su `<html>`)
- `theme` → `light` | `dark` | `system` (classe `dark` su `<html>`)

`system` risolve sulla luminosità del sistema operativo **mantenendo lo stile scelto**.
Cinque palette: quattro coprono le combinazioni stile × luminosità, la quinta è OLED,
che esiste per spegnere i pixel e quindi **forza lo scuro** — con l'interruttore di
luminosità disattivato e il motivo scritto accanto, invece di un comando inerte.

| Palette | canvas | surface-2 | accento | note |
|---|---|---|---|---|
| Studio · Dark (default) | `#0A0B0D` | `#16191D` | `#E8912E` | pannelli stratificati, cuciture appena visibili, accento caldo |
| Studio · Light | `#F1EFEB` | `#FBFAF8` | `#B86A15` | base carta calda invece del bianco puro; accento scurito per l'AA |
| Neutral · Dark | `#0E0F11` | `#1C1E22` | `#7FA8CC` | più freddo e piatto, densità più bassa |
| Neutral · Light | `#F7F7F8` | `#FFFFFF` | `#3D6C99` | quasi bianco, filetti netti, ombre minime |
| OLED · sempre scuro | `#000000` | `#0F1012` | `#EC983A` | pixel spento; l'elevazione la portano i bordi, non le ombre; testo mai bianco puro (alone) |

L'accento è **desaturato sotto la soglia neon** in tutte e quattro le palette ed è
sempre uno solo per tema.

### Densità

`data-density` su `<html>` guida `--row-h` / `--row-font`:
`comfortable` = 46px, `compact` = 30px. Vale per ogni lista dell'app.

---

## 2. Tipografia

Due famiglie, **bundlate localmente** come woff2 via `@fontsource` — la CSP del
renderer (`default-src 'self'`) vieta font remoti, e per lo stesso motivo
`electron.vite.config.ts` imposta `assetsInlineLimit: 0`: un font inlineato in
`data:` verrebbe bloccato, con il risultato silenzioso di un'app che ricade sui font
di sistema.

- **Be Vietnam Pro** — interfaccia, TUTTE le scritte: prosa, etichette, bottoni,
  titoli di pagina e header di sezione. Il peso di base è **500**, dichiarato una
  volta sul `body` di `index.css`; i titoli (`text-display`, `text-title`,
  `text-section`) salgono a **600**, ed è la differenza di peso a separare un titolo
  dal testo che gli sta sotto.
  Il 500 sta sul `body` e NON dentro i token di `fontSize` per un motivo meccanico:
  in Tailwind le utility di corpo escono dopo quelle di peso, quindi un peso infilato
  in `text-body` vincerebbe su ogni `font-semibold` scritto nei componenti.
- **JetBrains Mono** — dati, e solo dati. Obbligatoria per ogni numero: BPM, key
  Camelot, durata, conteggi, percentuali, ETA, percorsi, hash. Con `tabular-nums` le
  cifre non ballano mentre un contatore sale. Il tentativo di usarla anche per
  l'interfaccia è stato fatto e revertito (`c33103d`): a corpo 13 in una lista densa
  una monospaziata costa larghezza e non aggiunge niente.

Sei ruoli, niente in mezzo (classi Tailwind, valori in `tailwind.config.js`):

| Classe | Uso |
|---|---|
| `text-display` | 40/44, -0.03em, 600 — titoli di primo avvio |
| `text-title` | 24/30, -0.02em, 600 — titolo di pagina |
| `text-section` | 15/20, 600 — titolo di card, header di sezione, stati vuoti |
| `text-body` | 13/19, 500 — default per tutta la prosa d'interfaccia |
| `text-caption` | 11.5/16, 500 — note, testo d'aiuto, timestamp |
| `text-eyebrow` | mono 11, 0.14em, 500 — etichette di gruppo maiuscole |
| `text-data`, `text-data-lg`, `text-data-xl` | mono tabellare 12.5 / 27 / 34 per i valori |

> Niente `text-xs` sparso a sentimento. Se serve un settimo livello, il layout è sbagliato.

---

## 3. Spazio, raggi, elevazione, movimento

- **Spaziatura** — base 4px (scala Tailwind): 4 icona↔testo, 8 gruppo inline,
  12 gap tra controlli, 16 padding card, 24 gap tra card, 32 gap di sezione.
- **Raggi** — `rounded-chip` 4, `rounded-control` 6, `rounded-card` 10,
  `rounded-dialog` 14, `rounded-full` per pillole e meter.
- **Elevazione** — `shadow-e1` controllo sollevato, `shadow-e2` popover e toast,
  `shadow-e3` dialog e palette. Il livello e0 è solo bordo.
- **Movimento** — `duration-press` 120ms (hover/press), `duration-swap` 180ms
  (tab e pannelli), `duration-route` 220ms (cambio pagina), `duration-dialog` 280ms,
  `duration-theme` 240ms (cross-fade del tema). Count-up dei numeri 600ms.
  Easing condiviso: `ease-swift` = `cubic-bezier(.2,0,0,1)`.

**Reduced motion**: sotto `prefers-reduced-motion: reduce` — oppure con
`data-motion="reduce"`, che l'utente può forzare dalle impostazioni — ogni durata
collassa a 0.01ms. Niente si muove, niente si rompe, nessuna informazione va persa.

---

## 4. Componenti

Costruiti sulle primitive Radix già presenti nel progetto: il redesign sostituisce
la pelle, **mai il comportamento di accessibilità sottostante**.

| File | Contenuto |
|---|---|
| `components/ui/button.tsx` | 5 varianti (primary, secondary, ghost, destructive, warning), 5 taglie, stato `working` con spinner |
| `components/ui/card.tsx` | Card + header/title/description/content/footer, `Eyebrow`, `SectionHeading`, `StatTile`, `Skeleton` |
| `components/ui/misc.tsx` | Switch, Progress (determinato e indeterminato), Meter, Label, Field, Checkbox, Input, Select, Segmented, Stepper, Badge, FilterChip, Notice, Tabs, Tooltip, EmptyState, KeyValue |
| `components/ui/dialog.tsx` | Dialog a elevazione e3 |
| `components/ui/fields.tsx` | `PathField` (sola lettura + Sfoglia) |

### I tre componenti che portano la promessa di sicurezza

- **`SaveTargetNotice`** — la dichiarazione della destinazione di scrittura. Cinque
  target (`udm`, `copy`, `xml`, `original`, `masterdb`), colore che sale con il
  rischio, riga a piena larghezza. Compare **prima** (cosa succederà) e **dopo**
  (cosa è successo). Mai collassata, mai dietro una disclosure. `SaveTargetBadge` è
  la forma compatta per la tabella di Attività.
- **`DangerConfirmDialog`** — doppia conferma invariata dalla V1 (parola chiave
  esatta + checkbox), con in più il **pannello dei fatti**: cosa sta per succedere,
  in numeri, prima ancora di digitare la parola chiave.
- **`Notice`** — avviso inline persistente. I limiti dichiarati vivono qui, sulla
  pagina; nei toast va **solo l'esito**.

### Componenti dati

- **`data/Waveform.tsx`** — canvas: bande di struttura, griglia beat a due densità
  (battuta tenue, frase marcata), marker cue trascinabili con pointer capture e snap
  opzionale a una battuta. Nessuna riproduzione audio: scelta di prodotto.
- **`data/CamelotWheel.tsx`** — anello interno minore (A), esterno maggiore (B),
  tinte Mixed In Key, riempimenti passati per un correttore di contrasto che scurisce
  finché un inchiostro non supera 4.6:1. Le etichette sono **sempre** stampate: la
  compatibilità non dipende mai dal solo colore. La logica armonica arriva da
  `core/harmony.ts`, non è reimplementata.
- **`data/TrackList.tsx`** — lista virtualizzata (`@tanstack/react-virtual`) con
  finestra di pagine da 200 righe, due densità, selezione con shift/ctrl-click che
  sopravvive a scroll e filtri, barra azioni di massa agganciata al fondo della lista.
- **`data/Charts.tsx`** — `CountUp`, `HealthRing`, `BpmHistogram`, `KeyCoverage`.
  Nessuna libreria di charting: sono forme semplici, e sotto una CSP che vieta
  risorse remote l'SVG costa meno di un runtime.

---

## 5. Shell

Cinque zone persistenti. Le tre strisce orizzontali non si smontano mai: un job in
corso e lo stato del motore di lettura sopravvivono a ogni navigazione.

| Zona | Altezza | Contenuto |
|---|---|---|
| Title bar | 40px (macOS) / 34px (Windows) | striscia di trascinamento; su Windows i pulsanti restano quelli di sistema via Window Controls Overlay |
| Sidebar | 252px, collassabile a 68px | sei gruppi semantici, contatori vivi, punti sulle destinazioni Esperto |
| Topbar | 54px | breadcrumb + titolo, dimensione libreria, campanella con non letti, switch luminosità, badge modalità |
| Contenuto | fluido | gutter 24px, cross-fade 220ms al cambio rotta, posizione di scroll memorizzata per rotta |
| Barra job | 46px | compare solo mentre c'è lavoro: fase, progresso, done/total, ETA, annulla, coda espandibile |
| Statusbar | 30px | motore di lettura, database attivo, cartella sorvegliata, riepilogo job, lingua |

**Segnale della modalità Esperto** (proposta B della specifica): l'intera colonna di
navigazione passa a un tono più caldo, prende un chip in testata, e ogni destinazione
sperimentale porta un punto. Persistente e inequivocabile, non costa spazio di layout
e non compete con un avviso vero.

---

## 6. Regole (la lista corta)

**Fare**

- Usare il colore come informazione — stato, gravità, categoria — mai come decorazione.
- Accompagnare ogni segnale di colore con un'icona o una parola.
- Comporre i numeri in mono tabellare, sempre.
- Dichiarare la destinazione di una scrittura prima e dopo che avvenga.
- Tenere il limite dichiarato inline e persistente; nel toast solo l'esito.
- Dare a ogni stato vuoto un motivo e una via d'uscita.
- Tenere le animazioni sotto i 280ms e lasciare che `prefers-reduced-motion` le spenga tutte.

**Non fare**

- Niente neon, glow, gradienti saturi, bordi pulsanti. In nessun tema, su nessun elemento.
- Niente colore senza etichetta.
- Niente movimento decorativo: se un'animazione non spiega un cambio di stato, va tolta.
- Niente successo muto e niente errore muto: tutto atterra in Attività.
- **Nessuna azione distruttiva raggiungibile dalla palette comandi o da una scorciatoia.**
- Nessuna stringa hard-coded: quattro lingue, parità imposta dal compilatore e dai test.
- Nessuna risorsa remota: font, icone e dati sono bundlati — la CSP del renderer vieta la rete.

**Accessibilità**

- Contrasto del corpo ≥ 4.5:1 in tutte e sei le combinazioni; testo grande e icone ≥ 3:1.
- Focus ring 2px accento + 2px offset, uguale ovunque.
- Target minimo 28×28px; 40px sui percorsi distruttivi.
- Copertura da tastiera completa, ruoli Radix conservati.

---

## 7. Conformance (§08 del documento di riferimento)

Il documento di riferimento chiude con una checklist dei valori che, alla prima
costruzione, erano **stati specificati e persi in traduzione**. Questa sezione dice
dove siamo, perché un elenco di difformità senza uno stato è solo una lamentela.

### Chiuse

| Regola | Com'era | Com'è |
|---|---|---|
| Palette cue applicata, non solo dichiarata | `cuePalette.ts` non importato da nessun componente | `cueColor()` è l'unico punto che assegna una tinta a un cue: l'etichetta vince sul colore del file, e un colore estraneo diventa neutro invece di passare al disegno |
| Legenda della palette (§8.1) | assente | `CueLegend`, sotto la forma d'onda, sempre visibile, otto slot in ordine |
| Bande di struttura | alpha fisso 12%, nessuna etichetta | .05 / .07 sui due drop, etichetta mono 9px +0.1em in alto a sinistra, seme di 1px fra le bande, etichetta in accento solo sui drop |
| Contrasto delle caselle di copertura | `opacity` sull'intera casella, etichetta fino a 1.5:1 | tinta miscelata verso il fondo e inchiostro scelto per contrasto; casella a zero = superficie neutra, non invisibile |
| Ruota di Camelot al cambio tema | inchiostri memoizzati sul dato: restavano quelli della palette precedente | memoizzati sul tema |
| Forma d'onda al cambio tema | ridisegnata solo al resize | il tema è fra le dipendenze del disegno |
| Anello del punteggio | tratto 7 | tratto 9 su 118, come il documento |
| Accento sull'istogramma BPM | picco **e** barra sotto il puntatore | solo il picco; il puntatore schiarisce |
| Contatori a zero | sparivano | restano, spenti a `text-disabled`: "0" è la risposta utile |
| Densità globale | Tracce, Pulizia, Set | anche Attività e Report |
| Stati vuoti senza uscita | 8 su 14 | zero: `action` è obbligatoria nel tipo, e `tone="success"` distingue "non c'è niente" da "non ho trovato niente" |
| Stringhe non localizzate | `SELECTED`/`HOVER` nella ruota, `Close` nei dialog | quattro lingue come tutto il resto |
| Esadecimali fissi nei componenti | `#0A0B0D`, `#8A9099` nella forma d'onda | token di ruolo |
| Test di conformità | assertion testuali sul sorgente | le regole che sono funzioni pure vengono **eseguite**: `cueColor` contro colori Serato/Rekordbox, contrasto di ogni tonalità in tutte e cinque le palette |

### Divergenze consapevoli

- **OLED è una quinta palette** che il documento di riferimento non prevede (lui ne
  conta quattro per sei combinazioni). Nasce da un requisito d'uso — in cabina, al
  buio, su schermi OLED — e ridefinisce ogni token per intero. Va contata quando si
  parla di "tutti i temi": i test di contrasto la includono.
- **Tipografia**: il documento dice Archivo, l'app usa Be Vietnam Pro con base 500.
  Scelta esplicita del committente, presa dopo il documento.

### Aperto

- **Le bande di struttura non compaiono ancora**, perché l'analizzatore non le emette:
  `python-sidecar/sidecar.py` propone i cue ma non i bordi delle sezioni. Il renderer è
  pronto e disegna a specifica non appena `analyze` restituisce `bands`. I bordi devono
  arrivare da lì — sono un risultato d'analisi, e calcolarli nell'interfaccia
  significherebbe inventarli.
- L'analizzatore usa **quattro** degli otto slot (intro, drop, breakdown, outro):
  build, second drop, vocal e loop sono dichiarati e disegnabili, ma nessuno li propone.
