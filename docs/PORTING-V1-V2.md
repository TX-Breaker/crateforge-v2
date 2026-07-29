# Porting delle logiche V1 → V2

La V2 è nata come fork della V1 quando l'interfaccia è stata ridisegnata. Dopo
il fork, sulla V1 è proseguito il lavoro di **interoperabilità tra software DJ**
che nella V2 mancava. Questo documento registra che cosa è stato portato, che
cosa è stato deliberatamente lasciato indietro e **perché** — così la prossima
persona non rifà le stesse indagini.

Regola seguita in tutto il porting: **la GUI della V2 non si tocca.** Le pagine
esistenti hanno ricevuto solo le chiamate alle nuove funzioni; nessuna pagina
della V1 è stata reimportata.

---

## 1. Engine DJ — lettura corretta e scrittura nuova

### Il bug dei percorsi (engineReader)

I path dei brani in Engine sono relativi alla cartella **`Engine Library`**, non
alla cartella che la contiene. Il codice partiva da una radice un livello più in
alto e poi tagliava a mano un singolo `../` dal path.

Le due imprecisioni **si compensano** finché il path comincia con `..` — ed è il
caso di tutte le 114 tracce della libreria reale usata come riferimento, dove
entrambe le versioni trovano 114/114 file. Divergono invece sui brani conservati
**dentro** la libreria (path senza `..`), che con il vecchio codice finivano
fuori dalla cartella e risultavano introvabili.

Ora la radice è `Engine Library` e la risoluzione è delegata a `resolve()`, che
applica correttamente un numero qualsiasi di `..`. Il caso che divergeva è
coperto da un test (`tests/engineImport.test.ts`).

### Codec e writer

- `src/adapters/engine/engineCodec.ts` — codec dei blob `PerformanceData`.
  `quickCues` big-endian compressi zlib con framing `[uint32 BE lunghezza
  decompressa][stream]`; `loops` **non** compressi e **little-endian**. Le
  posizioni sono in **sample**, quindi servono la sample rate del brano (non
  44100 fisso).
- `src/adapters/engine/engineWriter.ts` — genera una **libreria Engine nuova**.

**Perché una libreria nuova e non una modifica di quella dell'utente:** del
database di Engine sappiamo leggere forma d'onda e griglia dei beat ma non
ricrearle byte per byte. Riscrivere il database esistente metterebbe a rischio
dati che non sapremmo rigenerare. Lo schema viene copiato da un `m.db` indicato
dall'utente, così la libreria prodotta ha la versione della sua installazione e
non una nostra ipotesi.

Verifica: ri-codificando ogni blob della libreria reale si riottengono **gli
stessi byte** (`tests/engineCodec.test.ts`, si auto-salta se la libreria non
c'è).

---

## 2. Perdite silenziose nei writer

Una perdita muta è il difetto peggiore in un convertitore: il DJ se ne accorge
sul palco. Tre erano presenti nella V2.

| Dove | Cosa spariva | Ora |
|------|--------------|-----|
| `vdjWriter` | le **memory cue** cadevano fuori dalla catena if/else | emesse come `Poi Type="remix"`, che è ciò che il reader rilegge |
| `vdjWriter` | il **colore** del cue non veniva mai scritto | scritto come `Poi@Color` |
| `vdjWriter` | le **playlist** non venivano esportate | file `.vdjfolder` sotto `Folders/` |
| `xmlWriter` (Rekordbox) | hot cue e loop **oltre l'ottavo pad** venivano scartati | degradati a memory (`Num="-1"`), che Rekordbox supporta |
| `nmlWriter` (Traktor) | i **colori** dei cue sparivano senza dirlo | il formato NML non li ha: perdita dichiarata nei warning |

Tutti e tre i writer restituiscono ora `warnings: string[]`, e `ConvertPage` li
mostra all'utente invece di lasciarli nel registro operazioni. La mappa dei
campi della pagina è stata corretta di conseguenza: diceva "loop: nessun
equivalente", non più vero da quando i loop viaggiano.

---

## 3. Serato — scrittura di cue, loop e crate

Serato non ha un file di libreria da importare: i cue vivono nei tag GEOB
`Serato Markers2` **dentro i file audio**. È quindi una scrittura sugli
originali, e passa dal gate delle scritture dirette (`directWrites`).

Disciplina per ogni file: hash → backup verificato con hash → scrittura →
rilettura di verifica → **rollback** su qualunque errore.

Due scelte che contano più del formato:

1. **Preservare ciò che non si capisce.** Le entry che non interpretiamo
   (`COLOR`, `BPMLOCK`, `FLIP`, e qualunque cosa Serato aggiunga) vengono
   rimesse identiche. Un writer scritto come "inverso del reader" le
   cancellerebbe.
2. **Fermarsi davanti all'ignoto.** Se dopo il parsing restano byte non
   riconosciuti — segno di una versione di Serato più recente — la scrittura
   viene **annullata** e il file ripristinato.

I **crate** (playlist) hanno un limite dichiarato: il formato non ha un
round-trip verificato contro un crate scritto da Serato, perché nella libreria
di riferimento non ne esisteva nessuno. Per questo un crate esistente **non
viene mai sovrascritto**: viene saltato e segnalato. Quando si potrà verificare
il round-trip su un crate reale, il vincolo si può togliere.

---

## 4. Diagnosi e prestazioni

- **`src/main/networkPath.ts`** — riconosce percorsi UNC e unità di rete
  mappate. I database DJ sono SQLite, che su SMB non riesce a prendere i lock:
  la lettura fallisce con "impossibile aprire il database" anche con i permessi
  giusti (è lo stesso motivo per cui Engine DJ rifiuta una cartella Musica su
  NAS). L'avviso compare su import ed errori, con l'indicazione di copiare la
  libreria su un disco locale.
- **`syncDaemon`** — confrontava i path grezzi, quindi lo stesso brano
  rientrava in coda a ogni scansione se il filesystem restituiva il nome in NFD
  (accenti su macOS) o con un case diverso (Windows). Ora usa
  `canonicalizePath`, come già fa `orphanFinder`, con un indice in memoria per
  scansione: nessuna migrazione di schema.
- **`reportViewer`** — rileggeva e riparsava l'intero `.xlsx` a ogni pagina.
  Ora il workbook resta in cache, invalidata su `mtime` + dimensione così un
  report rigenerato non viene mai servito stantio.

---

## 5. Setup autonomo di Python

Nell'app distribuita il sidecar è un binario PyInstaller: **Python non serve**,
e il preflight ora lo dichiara invece di lasciarlo indovinare.

Dai sorgenti serve un interprete, e non basta lanciare `python`: su Windows quel
comando è spesso lo **stub del Microsoft Store**, che non esegue nulla e apre il
negozio; e un Python di sistema vero non ha `mutagen` né `pyrekordbox`, che
vivono nel virtualenv del progetto. `src/main/pythonRuntime.ts` cerca in ordine
il **venv del progetto**, il launcher `py -3` e infine il PATH, e **verifica ogni
candidato eseguendolo**.

Quando manca solo il virtualenv, l'app lo crea e installa le dipendenze da sola,
in background (l'installazione dura minuti), aggiornando il preflight a fine
lavoro. Una volta per sessione, disattivabile con l'impostazione
`pythonAutoSetup`.

---

## 6. Cosa NON è stato portato, e perché

- **`src/core/platformProfile.ts`** (V1). I percorsi delle librerie DJ sono già
  coperti — meglio — da `src/main/djSoftwarePaths.ts`, che verifica ogni
  candidato su disco prima di dichiararlo trovato; le scorciatoie da tastiera
  da `src/renderer/src/lib/platform.ts`. Portarlo avrebbe creato due fonti di
  verità sugli stessi dati. Di conseguenza non esiste nemmeno l'IPC
  `platform:detect`.
- **Le pagine della V1** (`ConverterPage.tsx`, `Dashboard.tsx`, `SiaePage.tsx`…)
  sono servite solo a capire quali chiamate IPC servissero.
- **`_serato_volume_root` per Windows**: risultava già corretto nella V2
  (drive letter, separatori normalizzati, `$RECYCLE.BIN` saltato). Nessuna
  modifica necessaria.

---

## 7. Limiti che restano dichiarati

- **Crate Serato**: nessun round-trip verificato contro un crate scritto da
  Serato → i crate esistenti non si sovrascrivono.
- **Forma d'onda e griglia di Engine** (`overviewWaveFormData`, `beatData`) non
  vengono scritte di proposito: si sanno leggere ma non ricreare byte per byte.
  Engine le rigenera alla prima analisi.
- **Downbeat da Engine**: `beatData` non è decodificato, la griglia si
  ricostruisce a BPM costante.
- **Colori verso Traktor**: il formato NML non ha un colore per cue. Perdita
  intrinseca del formato.
- **Serato ha 8 pad**: arrivando da Engine o VirtualDJ, i cue oltre l'ottavo non
  hanno posto e vengono contati nei warning.

---

## 8. Come si verifica

```bash
npm run typecheck
node scripts/run-vitest.cjs run
```

Il runner gira dentro Electron per l'ABI di `better-sqlite3`: **`npx vitest` non
funziona**. I test che dipendono da librerie reali della macchina si
auto-saltano con `describe.skipIf(...)`, così restano verdi altrove.
