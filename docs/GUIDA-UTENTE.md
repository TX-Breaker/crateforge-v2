# Guida a CrateForge — spiegata semplice, per DJ (anche per niente tecnici)

> Questa guida parte da **zero**. Non dà per scontato niente. Se sai già cos'è
> un hot cue puoi saltare i riquadri "In parole povere", ma leggerli non fa male.
> Regola d'oro, valida dall'inizio alla fine: **CrateForge non tocca mai i tuoi
> file originali.** Lavora su copie e crea file nuovi. Puoi sbagliare senza paura.

Indice:

1. [Cos'è CrateForge (e cosa NON è)](#1-cosè-crateforge-e-cosa-non-è)
2. [Le parole che devi conoscere (glossario semplice)](#2-le-parole-che-devi-conoscere-glossario-semplice)
3. [I 5 programmi DJ: dove tengono i dati e come esportano](#3-i-5-programmi-dj-dove-tengono-i-dati-e-come-esportano)
4. [Come CrateForge legge ogni programma (cosa devi dargli)](#4-come-crateforge-legge-ogni-programma-cosa-devi-dargli)
5. [Usare CrateForge la prima volta, passo per passo](#5-usare-crateforge-la-prima-volta-passo-per-passo)
6. [Le ricette pronte (le conversioni più richieste)](#6-le-ricette-pronte-le-conversioni-più-richieste)
7. [Cosa si conserva e cosa si perde (e perché)](#7-cosa-si-conserva-e-cosa-si-perde-e-perché)
8. [Le 5 regole di sicurezza da non violare mai](#8-le-5-regole-di-sicurezza-da-non-violare-mai)
9. [Quando qualcosa non va (problemi comuni)](#9-quando-qualcosa-non-va-problemi-comuni)
10. [Domande frequenti](#10-domande-frequenti)

---

## 1. Cos'è CrateForge (e cosa NON è)

**In una frase:** CrateForge è il **meccanico della tua libreria musicale**. Non
è un programma per mixare. È l'attrezzo che sistema, converte e traspora la tua
libreria da un software DJ a un altro.

> **In parole povere:** immagina di avere tutta la tua musica organizzata dentro
> Rekordbox — con i punti di attacco (cue), i colori, le playlist. Adesso ti
> ritrovi con un lettore Denon che vuole Engine DJ, o un amico che usa Serato, o
> passi a Traktor. Rifare tutto a mano sarebbe un incubo. CrateForge fa il
> trasloco al posto tuo.

**Cosa fa CrateForge:**

- **Legge** la tua libreria da Rekordbox, Serato, Traktor, VirtualDJ o Engine DJ.
- **Converte** i dati (brani, cue, loop, beatgrid, playlist) in un formato che
  un altro programma sa importare.
- **Scrive** un file nuovo (o una libreria nuova) da dare all'altro programma.
- Ti aiuta anche con manutenzione: backup, brani orfani, report Excel, controllo
  encoding dei tag, duplicati, ecc.

**Cosa CrateForge NON fa:**

- ❌ Non mixa e non suona la musica. Quello lo fai nel tuo software DJ.
- ❌ Non modifica i tuoi file originali. **Mai.** Crea sempre file nuovi.
- ❌ Non "inietta" magicamente i dati dentro l'altro programma: ti dà un file, e
  **sei tu** a importarlo con un clic (te lo spieghiamo passo passo). Questo è
  voluto: così controlli sempre cosa entra nella tua libreria.

> **Perché il file va importato a mano?** Perché è più sicuro. Se un giorno
> qualcosa va storto, hai il file davanti agli occhi e decidi tu se importarlo.
> Nessun automatismo nascosto che ti rovina la libreria.

---

## 2. Le parole che devi conoscere (glossario semplice)

Non serve impararle a memoria: torna qui quando trovi una parola che non ti è chiara.

- **Libreria (o Collection/Collezione):** l'elenco di tutti i tuoi brani con le
  loro informazioni (titolo, artista, BPM, key…). Ogni software la salva a modo suo.
- **Traccia / Brano:** una canzone nella tua libreria.
- **BPM:** le pulsazioni al minuto, cioè quanto è veloce il brano.
- **Key (tonalità):** la nota musicale del brano. Spesso mostrata in **Camelot**
  (tipo `8A`, `5B`): serve per mixare brani "in accordo" tra loro.
- **Cue point:** un segnaposto dentro il brano. Premi il pad e il brano salta lì.
  - **Hot cue:** i cue "veloci", assegnati ai pad (di solito max 8).
  - **Memory cue:** un segnaposto che vedi sulla forma d'onda ma non è su un pad.
- **Loop:** un pezzo di brano che si ripete (ha un inizio e una fine).
- **Beatgrid (griglia):** la "griglia" che il software disegna sul brano per
  sapere dove cadono le battute. Serve al sync. Ha due cose importanti:
  - il **BPM** (quanto sono fitte le righe),
  - il **downbeat / punto d'aggancio (anchor)**: **dove** cade la prima battuta.
    Se il brano ha 2 secondi di silenzio all'inizio, l'aggancio NON è a zero.
- **Playlist (o Crate):** un elenco di brani che hai raggruppato (es. "Warm up",
  "Peak time"). Le **smartlist** sono playlist automatiche basate su regole
  (es. "tutti i brani a 5 stelle").
- **Tag:** le informazioni scritte **dentro** il file audio (come l'etichetta di
  una bottiglia). Alcuni software (Serato) tengono i cue proprio qui.
- **Export / Esportazione:** creare un file da dare a un altro programma.
- **Import / Importazione:** far leggere quel file all'altro programma.
- **XML / NML:** sono solo **formati di file** (come .doc o .pdf, ma per librerie
  DJ). L'XML è di Rekordbox, l'NML è di Traktor. A te non serve aprirli: li
  produce e li legge CrateForge.

---

## 3. I 5 programmi DJ: dove tengono i dati e come esportano

Ogni programma organizza la libreria a modo suo. Questa sezione ti dice, per
ciascuno: **dove** sono i dati, **come si esporta** (con i clic reali) e **cosa**
esce. Sono le stesse cose che CrateForge legge o scrive.

### 3.1 Rekordbox (Pioneer / AlphaTheta)

- **Dove tiene i dati:** in un database interno (`master.db`, protetto) più i file
  di analisi. È il software più "chiuso".
- **Come si esporta (il modo giusto):**
  1. Apri Rekordbox.
  2. Menu in alto → **File**.
  3. Clicca **"Esporta Collezione in formato xml"** (in inglese: *Export Collection
     in xml format*).
  4. Scegli dove salvarlo e dai un nome (es. `LaMiaLibreria.xml`). Salva.
  5. Aspetta la barra di avanzamento: se hai migliaia di brani ci mette un po'.
- **Cosa esce in quell'XML:** **tutto** — brani, BPM, key, i cue (fino a 8 hot cue
  per brano), i memory cue, i loop, i colori dei cue, la **beatgrid vera** e le
  playlist.
- **Attenzione al limite degli 8 hot cue:** anche se dentro Rekordbox un brano può
  avere più di 8 hot cue, **l'XML ne esporta solo 8**. Non è un limite di
  CrateForge: è proprio Rekordbox che nell'XML si ferma a 8.
- **Come si RI-importa un XML in Rekordbox** (questo serve dopo, quando CrateForge
  ti dà un XML da far leggere a Rekordbox): NON si usa il menu File→Importa. Si fa
  così:
  1. Rekordbox → **Preferenze** → **Visualizzazione** (View) → **Layout**.
  2. Metti la spunta su **"rekordbox xml"**. Ora, nella colonna a sinistra,
     comparirà una voce **"rekordbox xml"**.
  3. Nelle preferenze imposti anche **quale file XML** leggere (il file che ti ha
     dato CrateForge).
  4. Apri quella voce "rekordbox xml" a sinistra, trovi le playlist del file, e le
     **trascini** dentro la tua collezione o le importi con il tasto destro
     ("Importa nella Collezione").

### 3.2 Serato DJ Pro

- **Dove tiene i dati:** in una cartella nascosta `_Serato_` (sono le crate) **e**,
  soprattutto, **dentro i tag dei file audio** (i cue, i loop, la beatgrid e i
  colori sono scritti nel file MP3/etc., non in un database esterno).
- **Come si esporta:** **non si esporta.** Davvero. Serato **non ha** una funzione
  "esporta in un file di scambio". Il menu tasto-destro su una crate ha rinomina,
  colore, analizza… ma **nessun "Export"**. Le impostazioni Libreria non hanno
  export. È fatto così di proposito.
- **Quindi come si porta via da Serato?** In due modi:
  1. Il programma di destinazione **legge direttamente** Serato (VirtualDJ ed
     Engine DJ lo fanno; anche Rekordbox ha una conversione da Serato).
  2. Un attrezzo come **CrateForge legge i cue dai tag dei file** (è proprio il suo
     punto di forza per Serato).
- **Cosa serve sapere:** siccome i cue Serato stanno nei tag dei **file audio**,
  per leggerli CrateForge deve poter arrivare **ai file**, non solo alla cartella
  `_Serato_` (vedi §4.2).

### 3.3 Traktor Pro 4 (Native Instruments)

- **Dove tiene i dati:** in un unico file di testo chiamato `collection.nml`. Quel
  file **è** la tua libreria Traktor.
- **Come si esporta (per playlist):**
  1. Apri Traktor.
  2. A sinistra, apri **Playlists**, tasto destro su una playlist.
  3. Clicca **"Export Playlist as nml/m3u"**.
  4. Nella finestra: scegli la destinazione e il **formato NML** (l'M3U salva solo
     l'elenco dei percorsi, senza cue).
  5. **IMPORTANTE:** togli la spunta a **"Copy Tracks To Destination"** se NON vuoi
     copiare anche tutti i file audio (di default è **attiva** e copia i brani!).
  6. OK.
- **Non c'è un "esporta tutta la collezione":** perché il `collection.nml` è già la
  libreria intera. Se ti serve tutto, dai a CrateForge direttamente quel file.
- **Cosa esce:** brani, cue, loop, e la **beatgrid** (Traktor la salva con il punto
  d'aggancio reale). I colori dei cue **non** ci sono (Traktor non li salva per cue).

### 3.4 VirtualDJ

- **Dove tiene i dati:** in un file `database.xml` (la libreria) e in file
  `.vdjfolder` (le playlist). I cue (chiamati **POI**) stanno **dentro** il
  `database.xml`.
- **Come si esporta:** VirtualDJ **non** ha un export verso un formato di scambio.
  Le playlist si possono salvare come m3u; c'è la "Sincronizza su CloudDrive" per la
  portabilità. Ma il vero "file libreria" è il `database.xml`, che CrateForge legge
  direttamente.
- **VirtualDJ è soprattutto un "aggregatore":** sa **leggere** le librerie degli
  altri (Rekordbox, Serato, Traktor, Engine). Quindi spesso, per andare **verso**
  VirtualDJ, basta che VirtualDJ legga la sorgente… ma per i cue completi il modo
  pulito è dargli un `database.xml` scritto da CrateForge.

### 3.5 Engine DJ (Denon / InMusic)

- **Dove tiene i dati:** in database SQLite dentro `Engine Library/Database2/`. I
  cue e i loop stanno in blocchi dati compressi (`PerformanceData`).
- **Come si esporta:** Engine è pensato per l'interop.
  - In alto ci sono due schede: **IMPORT** ed **EXPORT**.
  - **EXPORT** apre il **Sync Manager**: scegli le playlist e le esporti **su una
    chiavetta USB / SD** (per i lettori Denon/Prime). Serve un drive fisico. Non
    produce un file di scambio: crea una libreria Engine sul drive.
- **Come IMPORTA (molto importante):** Engine è anche un **aggregatore**. Nella
  barra laterale ha:
  - **Rekordbox Library** (icona "rb"): ti dice a schermo — *"esporta la collezione
    Rekordbox come XML, poi qui clicca **Update Library** e scegli quel file XML"*.
    → **Engine importa direttamente l'XML di Rekordbox.**
  - **Serato Library**: legge la tua libreria Serato in sola lettura.

> **La scoperta che ti semplifica la vita:** l'**XML di Rekordbox è la lingua
> universale.** Engine DJ lo importa, VirtualDJ lo aggrega, e Rekordbox lo
> re-importa. Perciò, qualunque sia la tua sorgente, il percorso più affidabile è
> **sorgente → XML Rekordbox fatto da CrateForge → destinazione**.

---

## 4. Come CrateForge legge ogni programma (cosa devi dargli)

Quando in CrateForge scegli la **sorgente**, il programma ti chiede un file o una
cartella. Ecco cosa dare per ciascuno:

| Sorgente | Cosa dare a CrateForge | Dove si trova (di solito, su Mac) |
|---|---|---|
| **Rekordbox** | Il file **XML** che hai esportato (§3.1) — oppure il `master.db` in modalità avanzata | dove l'hai salvato / `~/Library/Pioneer/rekordbox/` |
| **Serato** | La cartella con la tua **musica** (così legge i cue dai tag dei file), oppure la cartella `_Serato_` | `~/Music/_Serato_` e la cartella dei brani |
| **Traktor** | Il file **`collection.nml`** (o un `.nml` di playlist esportato) | `~/Documents/Native Instruments/Traktor .../` |
| **VirtualDJ** | Il file **`database.xml`** | `~/Library/Application Support/VirtualDJ/` |
| **Engine DJ** | Il file **`m.db`** dentro `Engine Library/Database2/` | `~/Music/Engine Library/Database2/` |

> **Nota Serato (importante):** i cue Serato sono nei tag dei **file audio**. Se
> selezioni solo la cartella `_Serato_` (che contiene solo l'indice, non l'audio)
> potresti non vedere i cue. **Meglio puntare CrateForge alla cartella dove stanno
> i brani** (es. `~/Music`): così legge i tag e trova tutti i cue.

---

## 5. Usare CrateForge la prima volta, passo per passo

Mettiamo che tu non abbia mai aperto CrateForge. Facciamo finta insieme.

### Passo 0 — Prima di tutto: un backup

Non saltarlo. Anche se CrateForge non tocca gli originali, **un backup della
libreria del programma di partenza** ti fa dormire tranquillo. Ogni programma ha
il suo backup (Rekordbox: File → Libreria → Fai il backup; Serato fa backup
automatici; ecc.). Fallo.

### Passo 1 — Apri CrateForge

Vedrai una barra laterale a sinistra con le varie funzioni (Dashboard,
Convertitore, Backup, Report, ecc.) e, in alto, la possibilità di scegliere lingua
(it/en) e tema (chiaro/scuro).

> **Prima cosa da capire:** c'è una modalità **Semplice** e una **Esperto** (nelle
> Impostazioni). Da Semplice vedi solo le funzioni sicure e comuni. Le funzioni
> avanzate (che scrivono direttamente sui file) sono nascoste finché non attivi
> Esperto. **Lascia Semplice** finché non ti serve altro.

### Passo 2 — Esporta dalla sorgente (se serve)

Se parti da **Rekordbox**, esporta prima l'XML (§3.1). Se parti da **Traktor**,
sai già dov'è il `collection.nml`. Se parti da **Serato/VirtualDJ/Engine**, non
devi esportare niente: darai a CrateForge il file/cartella giusti (§4).

### Passo 3 — Vai sul Convertitore

1. Nella barra laterale, apri la pagina **Convertitore** (o "Converter").
2. Scegli la **sorgente** (da dove leggi: Rekordbox, Serato, Traktor, VirtualDJ,
   Engine).
3. CrateForge ti chiede il file/cartella: dagli quello giusto (vedi la tabella §4).
4. Scegli la **destinazione** (verso dove converti).
5. Parte una **anteprima**: CrateForge ti mostra quanti brani, quante playlist,
   quanti cue ha trovato, e — molto importante — un **avviso con i limiti** di quel
   canale (per esempio "gli hot cue oltre l'8° si perdono via XML"). Devi spuntare
   "ho letto" per andare avanti: è una cosa buona, leggi davvero.

### Passo 4 — Genera il file

1. Clicca **Esporta / Converti**.
2. CrateForge crea un **file nuovo** (non tocca niente di tuo). Ti dice **dove**
   l'ha salvato.
3. Spesso appare una **guida a schermo** con lo schema di come importarlo nella
   destinazione. Seguila.

### Passo 5 — Importa nella destinazione

Questo lo fai **tu**, nel programma di arrivo. Le istruzioni precise per ogni
destinazione sono nella sezione ricette (§6). In sintesi:

- **Verso Rekordbox:** attiva "rekordbox xml" nelle Preferenze e trascina le
  playlist (§3.1).
- **Verso Traktor:** Traktor legge il file `.nml` che CrateForge ha scritto.
- **Verso VirtualDJ:** VirtualDJ legge il `database.xml` scritto da CrateForge.
- **Verso Engine DJ:** usa il file **XML Rekordbox** e la funzione **Update
  Library** dentro Engine (§3.5).

### Passo 6 — Controlla in destinazione

Carica un paio di brani nel programma di arrivo e verifica: ci sono i cue? La
griglia è a posto? Le playlist ci sono? **La verifica finale la fa il tuo
orecchio e i tuoi occhi**, non il computer.

---

## 6. Le ricette pronte (le conversioni più richieste)

Ogni ricetta è una sequenza di passi. Segui quella che ti serve.

### Ricetta A — Da Rekordbox a Engine DJ (per lettori Denon/Prime)

1. In **Rekordbox**: File → **Esporta Collezione in formato xml** → salva
   `libreria.xml`.
2. In **CrateForge**: Convertitore → sorgente **Rekordbox** (dagli `libreria.xml`)
   → destinazione **Rekordbox XML** (sì, XML: è la lingua che Engine capisce).
   Genera il file.
   - *In alternativa* CrateForge può darti direttamente un XML pronto; l'importante
     è avere un **XML in formato Rekordbox**.
3. In **Engine DJ**: barra laterale → **Rekordbox Library** ("rb") → **Update
   Library** → scegli l'XML. Engine importa brani, playlist e cue.
4. Poi, se ti serve sulla chiavetta per il lettore: **EXPORT → Sync Manager →**
   scegli le playlist **→ esporta su USB**.

### Ricetta B — Da Serato a Rekordbox

1. In **CrateForge**: Convertitore → sorgente **Serato** → **punta alla cartella
   della tua musica** (così legge i cue dai tag) → destinazione **Rekordbox XML**.
   Genera `da-serato.xml`.
2. In **Rekordbox**: Preferenze → Visualizzazione → Layout → spunta **"rekordbox
   xml"** e imposta il file `da-serato.xml`.
3. A sinistra apri **"rekordbox xml"**, trascina le playlist nella tua Collezione.

### Ricetta C — Da Traktor a Rekordbox (o viceversa)

- **Traktor → Rekordbox:** in CrateForge, sorgente **Traktor** (dagli il
  `collection.nml`) → destinazione **Rekordbox XML** → importa in Rekordbox come
  nella Ricetta B, passo 2–3.
- **Rekordbox → Traktor:** esporta l'XML da Rekordbox, in CrateForge sorgente
  **Rekordbox** → destinazione **Traktor (NML)** → apri il `.nml` risultante in
  Traktor.

### Ricetta D — Da VirtualDJ a qualsiasi cosa

1. In **CrateForge**: sorgente **VirtualDJ** (dagli il `database.xml`) →
   destinazione a scelta (Rekordbox XML, Traktor NML).
2. Importa nella destinazione come nelle ricette sopra.

### Ricetta E — Voglio solo un report Excel della mia libreria

1. In **CrateForge**: pagina **Report**.
2. Scegli la sorgente, opzioni (Camelot sì/no, evidenzia tag mancanti…).
3. Genera il `.xlsx`. Lo apri con Excel/Numbers.

> **Regola universale delle ricette:** se non sai quale destinazione scegliere, usa
> **Rekordbox XML**. È il formato che quasi tutti sanno importare (Engine,
> VirtualDJ, e Rekordbox stesso).

---

## 7. Cosa si conserva e cosa si perde (e perché)

Nessuna conversione tra software è perfetta al 100%, perché ogni programma salva le
cose in modo diverso. Ecco la verità, spiegata semplice.

**Si conserva bene (quasi sempre):**

- Titolo, artista, album, genere, anno, **BPM**, **key/Camelot**, durata.
- I **cue** e i **loop** come posizione nel tempo.
- Le **playlist** (l'elenco dei brani).
- I **colori** dei cue **quando** sorgente e destinazione li supportano entrambi
  (es. Serato ↔ Rekordbox XML).

**Si perde o cambia (limiti veri, non colpa di CrateForge):**

- **Oltre 8 hot cue:** il canale XML di Rekordbox tiene solo 8 hot cue. Se un brano
  ne aveva di più, i pad dal 9° in su non passano.
- **Memory cue verso alcuni software:** VirtualDJ ed Engine non hanno il concetto di
  "memory cue" identico a Rekordbox. Verso VirtualDJ, oggi, i memory cue **non
  vengono riscritti** (limite noto).
- **Colori dei cue con Traktor:** Traktor non salva un colore per cue, quindi da/verso
  Traktor il colore non c'è.
- **Beatgrid (griglia):** CrateForge ora conserva il **punto d'aggancio reale** e il
  BPM per Rekordbox, Traktor e VirtualDJ (prima appiattiva tutto all'inizio). Per
  **Engine** l'aggancio non viene ancora estratto dai dati compressi, quindi verso
  Engine la griglia riparte da zero: se un brano ha silenzio iniziale, potresti
  dover correggere l'aggancio nel software di arrivo.
- **Verso Serato:** oggi CrateForge **legge** Serato ma non **scrive** verso Serato
  (scrivere significherebbe modificare i tag dei tuoi file audio, cosa rischiosa).
  Per portare roba **in** Serato, usa l'import nativo di Serato o passa dai software
  che Serato sa leggere.
- **Smartlist:** le playlist "automatiche" (a regole) diventano playlist normali o
  vengono segnalate: le regole non si trasferiscono.

> **Come regolarti:** CrateForge **ti avvisa prima** di ogni conversione con la
> lista di cosa non passa. Leggi quell'avviso. Se una cosa è per te vitale (es. i
> colori), scegli una rotta che la conserva.

---

## 8. Le 5 regole di sicurezza da non violare mai

1. **Backup prima di tutto.** Della libreria di partenza. Sempre.
2. **Gli originali non si toccano.** CrateForge lavora su copie; tienili tu così.
   Non usare funzioni "scrittura diretta" (modalità Esperto) se non sai cosa fai.
3. **Chiudi il programma DJ quando lavori sul suo database.** Se Rekordbox è
   aperto mentre qualcosa tocca il suo `master.db`, rischi conflitti. Meglio a
   programma chiuso.
4. **Importa a mano e controlla.** Non fidarti al buio: dopo l'import, apri un paio
   di brani e verifica cue e griglia.
5. **Un passo alla volta.** Converti una playlist di prova prima di fare tutta la
   libreria. Se il risultato ti convince, procedi col resto.

---

## 9. Quando qualcosa non va (problemi comuni)

- **"Non trovo il file da dare a CrateForge."** Vedi la tabella §4 per i percorsi.
  Su Mac molte cartelle sono nascoste: in Finder premi `Cmd+Shift+.` per vedere i
  file/cartelle nascosti (come `_Serato_`).
- **"Ho convertito da Serato ma non vedo i cue."** Hai puntato CrateForge alla
  cartella `_Serato_` invece che alla cartella della **musica**? I cue Serato sono
  nei tag dei file: punta alla cartella dei brani (§4.2).
- **"In Rekordbox non compare il file XML che ho importato."** Non si usa
  File→Importa. Devi attivare **"rekordbox xml"** nelle Preferenze (Visualizzazione
  → Layout) e trascinare le playlist dalla voce che appare a sinistra (§3.1).
- **"Ho perso degli hot cue."** Probabilmente il brano ne aveva più di 8 e sei
  passato per l'XML di Rekordbox, che ne tiene 8. È un limite del formato.
- **"La griglia è sfasata dopo la conversione verso Engine."** Engine non riceve
  ancora il punto d'aggancio reale da CrateForge: ri-aggancia la griglia in Engine
  (o parti da una sorgente con griglia già a zero).
- **"Traktor mi ha copiato tutti i file audio quando ho esportato la playlist."**
  Nella finestra di export Traktor c'era la spunta **"Copy Tracks To Destination"**
  attiva: la prossima volta toglila (§3.3).
- **"Il sidecar / la lettura diretta non funziona."** CrateForge funziona lo stesso
  in **modalità solo-XML**: esporta l'XML dal tuo programma e dallo a CrateForge.
- **(Windows) L'antivirus segnala CrateForge o il sidecar.** È un falso positivo
  comune con i programmi Python impacchettati: ripristina il file dalla cronologia
  dell'antivirus e aggiungi la cartella alle esclusioni.

---

## 10. Domande frequenti

**"CrateForge può rovinare la mia libreria Rekordbox?"**
No, in uso normale. Legge il `master.db` in sola lettura (e nella maggior parte dei
casi lavora sull'XML che esporti tu). Non scrive nel database cifrato di Rekordbox.

**"Devo essere online?"**
No. CrateForge lavora in locale. (Solo alcune funzioni opzionali, come completare i
tag mancanti da un archivio musicale online, usano internet — e te lo dicono.)

**"Perché a volte mi chiede il file audio e a volte no?"**
Dipende da dove il software tiene i cue. Serato li tiene nei file audio, quindi
serve arrivare ai file. Rekordbox/Traktor/VirtualDJ/Engine li tengono nella
libreria, quindi basta il file libreria.

**"Qual è la strada più sicura per spostarmi tra software?"**
Passa dall'**XML di Rekordbox**. È il formato che più programmi sanno importare
(Engine con "Update Library", VirtualDJ come aggregatore, Rekordbox stesso).

**"Ho un lettore Denon (Prime/SC). Come porto la mia libreria Rekordbox?"**
Ricetta A: Rekordbox → XML → Engine DJ (Update Library) → Sync Manager → USB.

**"E se voglio andare VERSO Serato?"**
Oggi CrateForge non scrive verso Serato (per non toccare i tag dei tuoi file).
Usa l'import nativo di Serato o passa da un software che Serato legge.

---

*Questa guida è basata su prove reali fatte con Rekordbox 7.2.16, Traktor Pro 4,
VirtualDJ 2026, Engine DJ e Serato DJ Pro 4.0.6 su macOS. I nomi dei menu possono
variare leggermente per versione e lingua del programma.*
