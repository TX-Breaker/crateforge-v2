# Catalogo operazioni CrateForge per programma

*Report tecnico basato sull'ispezione in sola lettura delle librerie reali presenti su questo Mac (Rekordbox 7.2.14, Serato DJ Pro, Traktor Pro 4.4.2, VirtualDJ 2026, Engine DJ 3.0.2).*

---

## 1. Executive summary

Il catalogo raccoglie **146 operazioni** distribuite su 5 ecosistemi DJ, tutte ancorate a dati verificati sulle librerie reali dell'utente (6102 brani Rekordbox, 4351 mp3 Serato, 4735 ENTRY Traktor, 10 Song VirtualDJ + backup, 4397 Track Engine).

| Stato | Operazioni | % |
|---|---:|---:|
| Già in CrateForge (`gia-in-crateforge`) | 39 | 27% |
| Parziale (`parziale`) | 44 | 30% |
| Da fare (`da-fare`) | 63 | 43% |
| **Totale** | **146** | **100%** |

### Distribuzione per programma

| Programma | Operazioni | Già fatte | Parziali | Da fare |
|---|---:|---:|---:|---:|
| Rekordbox | 35 | 16 | 4 | 15 |
| Serato DJ Pro | 25 | 3 | 7 | 15 |
| Traktor Pro 4 | 35 | 9 | 11 | 15 |
| VirtualDJ 2026 | 30 | 9 | 11 | 10 |
| Engine DJ | 21 | 2 | 11 | 8 |

**Lettura chiave:** l'*import* (leggere le librerie) è largamente coperto in tutti e 5 i software; il collo di bottiglia è la **scrittura/export nativa** verso i formati proprietari, che sblocca la vera migrazione senza perdita di cue, loop, colore e gain.

### 5-8 interventi a più alto impatto

| # | Intervento | Programmi | Perché è prioritario |
|---|---|---|---|
| 1 | **Writer nativo verso Serato (GEOB Markers2 nei file)** | Serato | È l'unico modo reale di "esportare in Serato" (i cue stanno nei tag, non in un XML). Oggi X→Serato manca del tutto. |
| 2 | **Writer nativo Engine DJ (m.db + PerformanceData)** | Engine | Sblocca *→Engine completo con cue+loop+colori oltre il cap 8 del canale Rekordbox XML. |
| 3 | **Superare cap 8 hot cue + loop del Collection XML** | Rekordbox | Su brani reali con 11 hot cue negli slot 1-14 il canale XML ne perde 3+ e scarta i loop; serve scrittura diretta `DjmdCue`. |
| 4 | **Preservare colore cue + rating + gain nel round-trip** | Traktor, VDJ, Serato, Engine | Metadati letti ma non riscritti: ogni conversione azzera colori, stelle e loudness. Fix a basso costo, alto valore percepito. |
| 5 | **Relocator che scrive in-place nei DB nativi** | Tutti | I path (assoluti RB/VDJ, relativi Serato/Engine, VOLUME Traktor) rompono le librerie a ogni spostamento; il relocator esiste ma non riscrive ancora i DB nativi. |
| 6 | **Backup incrementale pre-conversione unificato** | Tutti | Passaggio bloccante prima di ogni scrittura distruttiva; parzialmente presente ma non agganciato a tutti gli adapter. |
| 7 | **Materializzazione/traduzione smart-list** | Traktor, VDJ, Serato, Engine, RB | Smartlist/FilterFolder/Smart Crate diventano liste statiche o spariscono in ogni conversione. |
| 8 | **Import HISTORY reale per SIAE** | Engine (hm.db), Serato, VDJ, Traktor, RB | Report SIAE dai brani effettivamente suonati, non dall'intera libreria. RB già pronto (201 sessioni), Engine/altri da collegare. |

---

## 2. Sezioni per programma

### 2.1 Rekordbox 7.2.14 (Pioneer / AlphaTheta)

**Cosa è emerso dalla libreria reale:** `master.db` ~300 MB cifrato SQLCipher (chiave DB6 in cache), 48 tabelle, letto via pyrekordbox 0.4.3. Conteggi veri: **6102 brani, 3368 cue, 158 playlist** (136 normali, 18 cartelle, 4 smart), 99 MyTag con 3406 assegnazioni, 23 banchi Sampler, 201 sessioni di history (619 righe). Metadati ricchissimi e popolati (Rating/ColorID/DJPlayCount 6102/6102). **Quirk verificati:** BPM = intero ×100; `InFrame = floor(InMsec*0.15)` a 150 fps (il round sbaglia nel 47% dei casi); Kind ordinale non contiguo (4 riservato ai loop); hot cue reali fino allo slot 14; colore cue = indice palette, RGB veri solo in ANLZ/XML; FolderPath **assoluto**; backup nativi cifrati e rotanti (max 3).

| Operazione | Categoria | Perché utile | Come implementarla | Fatt. | Prio. | Stato |
|---|---|---|---|---|---|---|
| Import completo master.db cifrato | conversione | Sblocca la libreria che nessun altro tool legge; senza, l'import nativo perde tutti i cue | Sidecar `cmd_ingest_masterdb` pyrekordbox; BPM/100, KeyID→Camelot, `_rb_cue_row` su DjmdCue | alta | alta | **gia** |
| Convertitore RB→Serato/Traktor/VDJ/Engine | conversione | Nativamente RB→Traktor/Serato non esistono o cappano a 8 cue | ConverterPage X→Y, UDM pivot, writer nml/vdj/xml, GEOB Serato | alta | alta | **gia** |
| Superare cap 8 hot cue e perdita loop XML | conversione | Un brano reale ha 11 hot cue slot 1-14: via XML se ne perdono 3+, i loop spariscono | Cap solo nel writer target; per superare XML serve scrittura diretta DjmdCue | media | alta | parziale |
| Backup incrementale verificato a hash | backup | I backup nativi sono cifrati e rotanti (3): un errore si propaga | `incrementalBackup.ts` planBackup+executeBackup, step bloccante pre-conversione | alta | alta | **gia** |
| Restore selettivo dai backup | backup | RB non offre restore granulare; 5 zip da 1.77 GB + 3 backup cifrati | Aprire backup cifrati con chiave DB6, diff su conteggi/UUID/usn, UI anteprima | media | media | da-fare |
| Ritrova file spostati (nome + Chromaprint) | riparazione | Path assoluto: ogni spostamento blocca i brani | `relocator.ts` matchByFilename + sidecar fingerprint → relocationXml | alta | alta | **gia** |
| Riparazione path direttamente nel master.db | riparazione | Elimina il reimport XML: link riparato in-place | Aggiornare FolderPath/FileNameL su copia, gestire usn, ricifrare | media | media | da-fare |
| File orfani su disco | manutenzione | Recupera musica mai importata | `orphanFinder.ts` scansione FS vs path DB | alta | media | **gia** |
| Voci fantasma (file inesistente) | manutenzione | La libreria ha smart playlist 'A SUPPRIMER'; RB mostra solo la '!' | `fs.existsSync` per track, incrocio con relocation_matches, estende health.ts | alta | media | da-fare |
| Deduplica per impronta acustica | dedup | RB deduplica solo per path/tag; esiste già smart playlist 'Doublons' | sidecar fingerprint-batch → acoustic_id, health.duplicateGroups | alta | media | **gia** |
| Report Salute libreria | analisi | RB non offre vista d'insieme | `health.ts` computeHealth, COUNT SQL su UDM, punteggio 0-100 | alta | media | **gia** |
| Report Excel | reportistica | Analisi/inventario fuori da RB | services/excel su UDM | alta | bassa | **gia** |
| Report SIAE / borderò | reportistica | Adempimento manuale; 201 sessioni non producono il modulo | sidecar read-history DjmdHistory → siaeReport.ts | alta | media | **gia** |
| Export tracklist / cue-sheet dei set | reportistica | Riusa i 619 record history per promozione set/radio | Formatter Node su play_history, TXT/CSV/Markdown | alta | bassa | da-fare |
| Migrazione MyTag verso altri software | conversione | 99 MyTag + 3406 assegnazioni: struttura più ricca, oggi persa | sidecar DjmdMyTag(albero) + DjmdSongMyTag → playlist/tag target | media | media | da-fare |
| Conversione criteri smart playlist | playlist | Le 4 smart list diventano statiche perdendo l'auto-update | Parse colonna SmartList → IR regole → QUERY Traktor/filter VDJ/rules Engine | media | bassa | da-fare |
| Scrittura diretta playlist nel master.db | playlist | Le playlist CrateForge appaiono subito in RB | sidecar masterdb-create-playlist su copia ricifrata, blocca se RB aperto | media | media | **gia** |
| Scrittura diretta cue nel master.db | conversione | Unico modo di portare cue esterni in RB oltre gli 8 slot con loop | Insert low-level DjmdCue, InFrame=floor(InMsec*0.15), Kind non contiguo | bassa | media | parziale |
| Auto-Cue (analisi + generazione) | analisi | Molti brani entrano senza cue | sidecar analyze-cues → NormCue nel pivot | media | media | **gia** |
| Auto-Tagger (MusicBrainz/Discogs) | manutenzione | BPM/key/genere/anno mancanti abbassano salute e rompono smart list | services/tagger, write-tags + UDM | media | media | **gia** |
| Migrazione gain/rating/colore/beatgrid | conversione | Perdite dovute al modello dati, non ai formati | UDM v6 gain_db/rating/track_color/beatgrid; foreignImport li mappa | media | media | **gia** |
| Report statistiche riproduzione (DJPlayCount) | analisi | Classifiche più/meno/mai suonati (631 play reali) | Ingerire DJPlayCount → play_count, incrocio play_history | alta | bassa | da-fare |
| Backup/export banchi Sampler | backup | 23 banchi + 160 sample: lavoro accumulato non migrabile | sidecar DjmdSampler + DjmdSongSampler → manifest + copia file | media | bassa | da-fare |
| Migrazione Hot Cue Banklist | conversione | Feature RB7 non gestita da nessun canale (qui vuota) | sidecar djmdHotCueBanklist → set NormCue etichettati | bassa | bassa | da-fare |
| Watcher Nuovi Acquisti | sync | Automatizza ingest senza import manuale | services/watcher → inbox_items → inboxXml | alta | bassa | **gia** |
| Set Planner e Set Builder | playlist | Prep set armonici; RB non ha planner esportabile | services/planner+setbuilder, camelot.ts/harmony.ts | alta | bassa | **gia** |
| Separazione stems (Demucs) | analisi | Materiale creativo che RB non produce | sidecar stems | media | bassa | **gia** |
| Export USB PIONEER standalone | conversione | Export nativo copia tutto o richiede RB aperto | Struttura /PIONEER via pyrekordbox export device | bassa | bassa | da-fare |
| Consolidamento libreria (raccogli + ripath) | manutenzione | Brani sparsi su Music/Desktop/volumi esterni | copyWithVerify in struttura Artista/Album + XML/DB relocation | media | bassa | da-fare |
| Normalizzazione notazione key | manutenzione | Notazioni diverse rompono il mix armonico cross-software | core/camelot.ts, export nella notazione preferita | alta | bassa | parziale |
| Audit qualità file (bitrate/formato/SR) | analisi | File scadenti si sentono su impianti grossi | Ingerire BitRate/SampleRate/FileType, soglie in Salute | alta | bassa | da-fare |
| Pulizia: non in playlist / mai suonati / non analizzati | manutenzione | Pota materiale morto in 6102 brani | Query UDM LEFT JOIN + Analysed/DJPlayCount | alta | bassa | da-fare |
| Migrazione commenti e ISRC | conversione | Commnt (3780) + ISRC (245) usati per mix e SIAE | Aggiungere comment/isrc all'UDM, mappare ai writer | alta | bassa | da-fare |
| Merge di due librerie Rekordbox | sync | Nessun merge nativo affidabile; cloud a pagamento all-or-nothing | Import doppio source, dedup acoustic_id, merge playlist | media | bassa | da-fare |
| Beatgrid reale via ANLZ | analisi | Griglia sintetica disallinea i cue su tempo variabile | Parser ANLZ custom (PQT2 dà ConstError su pyrekordbox) | bassa | bassa | parziale |

**Pain point:** path assoluto che rompe i link a ogni spostamento; migrazione cross-software che perde silenziosamente hot/memory/loop (cap 8 XML); DB cifrato e opaco; backup cifrati e rotanti (max 3); duplicati accumulati; metadati incompleti; MyTag e Sampler prigionieri; history da estrarre a mano per SIAE; smart list che perdono i criteri; nessun report di salute; consolidamento manuale enorme; scrittura diretta rischiosa e non supportata nativamente.

---

### 2.2 Serato DJ Pro

**Cosa è emerso dalla libreria reale:** `_Serato_/` con `database V2` (binario, record `otrk`, path **relativi al volume**), `Subcrates/` con la sola `Serato Stems/Stems.crate`, `SmartCrates/` vuota, 9 zip incrementali in `Export Backups/`. **NESSUNA sessione History** (SIAE non alimentabile finché non si registrano set). 4351 mp3, sottoinsieme con tag GEOB decodificati con mutagen: `Serato Markers2` (base64: CUE/LOOP/COLOR/BPMLOCK), `Serato BeatGrid`, `Serato Autotags` (bpm/autogain/gain), `Serato Markers_` legacy, `Overview` (~4KB) e `Offsets_` (~21KB) cache. **Bonus:** GEOB JSON di Mixed In Key (CuePoints/Key/Energy). **Conferma chiave:** Serato "esporta" scrivendo cue+beatgrid+gain **nei tag dei file**, non in un XML — quindi export = scrivere GEOB + rigenerare database V2 e .crate.

| Operazione | Categoria | Perché utile | Come implementarla | Fatt. | Prio. | Stato |
|---|---|---|---|---|---|---|
| Import completo Serato (DB V2 + crate + cue GEOB) | conversione | Ponte d'ingresso: i cue stanno nei tag, non in un XML | `cmd_read_serato` + parse_serato_markers2 + _read_serato_crates | alta | alta | **gia** |
| Conversione Serato→RB/Engine/Traktor/VDJ | conversione | Caso d'uso n.1 del DJ che cambia software | Import Serato → UDM → writer esistenti; verificare mappa colori | alta | alta | parziale |
| **Export/Scrittura verso Serato (GEOB Markers2)** | conversione | Unico vero modo di esportare in Serato; oggi X→Serato manca | `cmd_write_serato` mutagen, corpo binario 0x0101, base64 72char, solo copie | alta | alta | da-fare |
| Scrittura BeatGrid + database V2 + .crate | conversione | Senza griglia/DB i brani appaiono non analizzati o fuori playlist | Encoder BeatGrid 0x0100, encoder DB V2/.crate inverso di _serato_fields | media | alta | da-fare |
| Import BeatGrid nell'UDM | conversione | Oggi la griglia va persa convertendo verso RB/Engine | parse_serato_beatgrid → beatgrid_bpm/anchor_ms in _serato_import_one | alta | alta | da-fare |
| Import Autotags (autogain/gain/bpm) | conversione | Il gain si perde e cambiano i volumi relativi del set | parse 3 stringhe null-term → gain UDM | alta | media | da-fare |
| Import colore traccia (entry COLOR) | conversione | Color coding passa a RB/Engine solo se lo leggiamo | Ramo name=='COLOR' in parse_serato_markers2 → track_color | alta | media | da-fare |
| Import cue legacy 'Serato Markers_' | riparazione | Su file vecchi i cue stanno solo nel formato legacy | parse offset fissi, fallback se Markers2 assente | media | media | da-fare |
| Import Flip | conversione | Editing performativi salvati nel file, altrimenti persi | Ramo FLIP in Markers2, salvare come cue speciali/blob | bassa | bassa | da-fare |
| Loop attivi (import + export) | flip-loop | Loop memorizzati sono strumenti di set; RB XML li scarta | Import già fatto; export entry LOOP nel Markers2 | alta | media | parziale |
| Color coding: mappatura palette Serato↔RB↔Engine | color-coding | Senza mappatura i colori diventano casuali | Modulo colorMap nearest-color rgb→palette target | alta | media | da-fare |
| Backup completo Serato (crate + DB + cue nei file) | backup | Il backup nativo NON include i tag nei file | Estendere backup + dump GEOB via mutagen, zip verificato hash | alta | alta | parziale |
| Relocate file spostati per Serato | riparazione | Path relativi al volume: cambiare disco rompe tutto | relocator (fpcalc) + writer database V2/.crate su pfil/ptrk | media | alta | parziale |
| Editor cue nei file (senza Serato) | gestione-cue | Sistemare cue in batch senza ri-analisi | UI su cue UDM + cmd_write_serato, tutti i container audio | media | media | da-fare |
| Pulizia/strip tag (Overview, Offsets_, doppioni) | manutenzione | ~25KB cache ridondante/traccia, centinaia di MB | mutagen delall per desc, mantieni Markers2+beatgrid, report byte | alta | media | da-fare |
| Import Mixed In Key (CuePoints/Key/Energy) | conversione | Cue/analisi di qualità che Serato ignora in parte | json.loads dei GEOB desc {CuePoints,Key,Energy} → UDM | alta | media | da-fare |
| Import/Export Smart Crate (regole) | smart-crates | Automazioni che nessun export XML porta; Engine ha Smartlist | Reader .scrate (rurt/rult/rart), IR regole → Engine/RB intelligent | media | media | da-fare |
| Salute libreria Serato | analisi | Individua problemi prima di un set/conversione | Estendere health.ts: risolvibilità path, BeatGrid/Markers2, base64 | alta | media | parziale |
| Ricostruzione database V2 da crate + tag | riparazione | Recupero d'emergenza se il DB è azzerato/corrotto | Walk file GEOB → otrk, .crate → playlist, nuovo DB su copia | media | media | da-fare |
| Ispeziona/ripristina Export Backups | backup | Serato accumula zip ma senza diff/restore granulare | Unzip, parse DB V2 + Subcrates, diff, restore mirato | alta | bassa | da-fare |
| Auto-Cue scritto nei tag Serato | gestione-cue | Cue di partenza a centinaia di brani, usabili subito | Output Auto-Cue → cmd_write_serato, colore/label standard | alta | media | parziale |
| Sync/merge cue bidirezionale Serato↔RB | sync | Preparare i cue una volta sola, ritrovarli in entrambi | UDM hub, merge per indice/posizione, write su entrambi | media | bassa | da-fare |
| Report Excel Serato | reportistica | Panoramica stampabile/condivisibile | services/excel su UDM dopo import | alta | bassa | **gia** |
| Dedup per impronta | manutenzione | Librerie accumulano duplicati da import ripetuti | Dedup fpcalc esistente sui path Serato | alta | bassa | **gia** |
| Report SIAE da sessioni Serato | reportistica | Obbligo per DJ in Italia | Parser .session → siae (nessuna sessione presente ora) | media | bassa | parziale |

**Pain point:** nessun formato di export/XML (cue, beatgrid, gain **nei tag file**), migrazione = incubo manuale; path relativi al volume che si rompono; file rinominati fuori da Serato spariscono dal DB pur conservando i cue nel tag; doppio formato cue (Markers_ + Markers2) e file gonfi (~25KB cache/traccia); smart crate e colori non passano via XML; nessun backup che catturi i cue-nei-file; impossibile pulire/azzerare cue senza aprire Serato; dati Mixed In Key non consolidati; recupero cue da file quando il DB è corrotto.

---

### 2.3 Traktor Pro 4 (Native Instruments)

**Cosa è emerso dalla libreria reale:** `collection.nml` VERSION="20", **4735 ENTRY** (confermato). Tutte le tracce su "Macintosh HD". Metadati ricchi: **RANKING 0-255** (rating), **LOUDNESS PEAK/PERCEIVED/ANALYZED_DB** 4735/4735 (autogain), **MUSICAL_KEY 0-23**, COMMENT usato come tag da 1776 tracce ("PLAYLIST"/"Già in Playlist"). **CUE_V2: 4822** (grid TYPE=4 ×4744, cue/hotcue TYPE=0 ×75, loop TYPE=5 ×3); gli hot cue portano **COLOR=#RRGGBB** oggi scartato. Playlist ad albero con radice `$ROOT`, 3 SMARTLIST (SEARCH_EXPRESSION: `$RATING==5`, `$IMPORTDATE>=MONTHS_AGO(1)`, `$PLAYED==TRUE`) + 5 PLAYLIST. Cache Stripes/Transients/Coverart (128 sottocartelle). Il reader **ignora** RANKING/LOUDNESS/COMMENT/COLOR-cue/AUDIO_ID/anchor reale; il writer emette VERSION="19" (errata), forza grid a START=0 e **appiattisce le cartelle**. L'UDM ha già le colonne pronte ma restano NULL per Traktor.

| Operazione | Categoria | Perché utile | Come implementarla | Fatt. | Prio. | Stato |
|---|---|---|---|---|---|---|
| Import collection.nml → UDM | conversione | Punto d'ingresso di ogni conversione Traktor→altro | `nmlReader.ts` readTraktorNml | alta | alta | **gia** |
| Export UDM → collection.nml | conversione | Consente X→Traktor | `nmlWriter.ts` writeTraktorNml (correggere VERSION) | alta | alta | **gia** |
| Conversione Traktor ↔ RB/Serato/Engine/VDJ | conversione | Il DJ cambia software senza rifare la libreria | ConverterPage + adapters, Traktor cablato bidirezionale | alta | alta | **gia** |
| Import RATING (RANKING 0-255 → stelle) | conversione | Preserva anni di valutazioni, oggi perse nel round-trip | Leggere @RANKING, rating=round(RANKING/51) → NormTrack.rating | alta | alta | da-fare |
| Export RATING (stelle → RANKING) | conversione | Le stelle da RB/Serato compaiono in Traktor | Aggiungere RANKING all'INFO nel writer | alta | alta | da-fare |
| Import gain/loudness (LOUDNESS → gain_db) | gain-loudness | Livelli coerenti passando ad altri software | Leggere PERCEIVED_DB → gainDb, conservare peak | alta | alta | da-fare |
| Export gain + LOUDNESS | gain-loudness | Autogain immediato dopo import in Traktor | ele LOUDNESS con PERCEIVED_DB=gain_db | alta | media | da-fare |
| Normalizzazione loudness (target LUFS) | gain-loudness | Set con volume uniforme senza toccare i file | sidecar ffmpeg/pyloudnorm, gain=target-LUFS | media | media | da-fare |
| Preserva colore hot cue (COLOR ↔ cues.color) | gestione-cue | Codice-colore intro/drop/vocal sopravvive | mapCue color=@COLOR; writer attr COLOR su CUE_V2 | alta | alta | parziale |
| Round-trip cue hot/memory/loop | gestione-cue | Cue e loop non collidono sui pad | Esiste (usedHot set, TYPE 0/5) | alta | media | **gia** |
| Beatgrid anchor reale (non START=0) | gestione-cue | Beatgrid allineata dopo conversione, niente drift | Leggere CUE_V2 TYPE=4 START come anchor; usarlo nel writer | media | media | parziale |
| Auto-Cue e scrittura nell'NML | gestione-cue | 75 cue su 4735 tracce: quasi tutte senza cue | Collegare cues:analyze all'export come CUE_V2 TYPE=0 | alta | media | parziale |
| Materializza Smartlist in playlist statica | smartlist | Le 3 smartlist si perdono in ogni conversione | `traktorSmartlist.ts` parser ($RATING,$IMPORTDATE,$PLAYED...) su UDM | media | alta | da-fare |
| Traduci Smartlist → intelligent playlist RB | smartlist | Mantiene la playlist dinamica invece di appiattirla | Mappare operatori sul nodo intelligent di rekordbox/xmlWriter | media | bassa | da-fare |
| Import tag da COMMENT (MyTag-like) | analisi | 1776 tracce usano COMMENT come tag | Leggere @COMMENT, regex marcatori → tag/comment UDM | media | media | da-fare |
| Preserva gerarchia cartelle playlist | conversione | Struttura curata resta intatta esportando | NODE FOLDER ricorsivi da parent_id invece di filter(!is_folder) | media | media | da-fare |
| Riparazione VOLUME/path in-place nell'NML | riparazione | Elimina di massa i '!' rossi dopo cambio disco | Parse NML, rimappa VOLUME/DIR sul nuovo mount, riscrive attributi | media | alta | parziale |
| Ritrova file spostati + riscrivi LOCATION | riparazione | File riorganizzati riagganciati dentro Traktor | relocator + writer che aggiorna LOCATION in-place | media | media | parziale |
| Duplicati usando AUDIO_ID | manutenzione | Rilevamento quasi istantaneo, zero decodifica | Esporre @AUDIO_ID, DedupPage modalità AUDIO_ID | alta | media | parziale |
| Backup incrementale NML (+.tsi, cache) | backup | Rollback sicuro; l'NML è il cuore | BackupPage/services/backup, aggiungere collection.nml e .tsi | alta | alta | **gia** |
| File orfani (ENTRY → file inesistente) | manutenzione | Pulisce i fantasmi prima di una conversione | orphans:scan su UDM (già valido per path Traktor) | alta | media | **gia** |
| Salute libreria Traktor | analisi | Qualità metadati prima di suonare/convertire | health:get generico su UDM | alta | media | **gia** |
| Rileva tracce non analizzate | analisi | Sapere quali brani analizzare prima del set | Marcare needs_review se manca TEMPO/LOUDNESS | alta | bassa | da-fare |
| Report Excel della collezione | reportistica | Inventario stampabile del crate | report:generate, aggiungere rating/gain | alta | bassa | **gia** |
| Report SIAE da cronologia | reportistica | Adempimento obbligatorio in Italia | siae:readHistory su cartella History/session .nml | media | media | parziale |
| Stems: separazione + container .stem.mp4 | stem | Abilita gli Stem Deck di Traktor | stems:run + muxing .stem.mp4 (ffmpeg + atomi ni-stem) | bassa | bassa | parziale |
| Gestione Remix Set / Sample deck | remix-set | Preserva i remix set nel passaggio | Estendere reader/writer per NODE _LOOPS/_RECORDINGS | bassa | bassa | da-fare |
| Pulizia cache Stripes/Transients/Coverart | manutenzione | Recupera spazio e velocizza Traktor | Incrocio AUDIO_ID/COVERARTID vivi vs file cache | media | bassa | da-fare |
| Estrai/rigenera cover art | manutenzione | Copertine trasferibili/recuperabili | Leggere @COVERARTID, file cache in /Coverart via mutagen | media | bassa | da-fare |
| Conversione notazione tonale (0-23/Camelot) | conversione | Key coerente, niente perdita armonica | traktorKeys.ts + core/camelot | alta | media | **gia** |
| Nuovi Acquisti (watcher) → import | sync | Nuovi brani pronti senza analisi manuale | watcher:start/scan → append ENTRY o playlist prep | media | bassa | parziale |
| Merge di due NML / dedup all'import | manutenzione | Consolida studio + laptop in una | importForeignLibrary idempotente + modalità merge per AUDIO_ID | media | bassa | parziale |
| Bump NML VERSION 19→20 e HEAD corretti | riparazione | Massima compatibilità con Traktor 4 | Cambiare VERSION a '20', verificare HEAD, test round-trip | alta | media | da-fare |
| Consolida i file referenziati in una cartella | manutenzione | Prepara un drive USB autonomo per il gig | Copia path risolti + NML con VOLUME/DIR aggiornati | media | media | da-fare |
| Backup/diff del .tsi (settings/mapping) | backup | Recupero rapido mapping dopo crash/reinstallo | Parser NIXML per diff, includere nei target backup | media | bassa | parziale |

**Pain point:** round-trip che perde il RATING; colori hot cue persi (ri-colorare 75+ a mano); autogain PERCEIVED_DB non trasferito; tag nel COMMENT non strutturati; smartlist non esportabili; cartelle playlist collassate alla radice; cambio nome volume → tutti i brani mancanti senza fix di massa; ri-analisi lenta ignorando l'AUDIO_ID esistente; cache che trattiene dati di file cancellati; nessun modo di materializzare una smartlist in statica.

---

### 2.4 VirtualDJ 2026

**Cosa è emerso dalla libreria reale:** root dati in `~/Library/Application Support/VirtualDJ/` (NON Documents). `database.xml` unico store brani+POI in chiaro, **solo 10 Song** (libreria piccola/di test): `<Scan>` con **Bpm in secondi-per-beat** (0.521746 → 115 BPM), Volume=gain, Phase, AltBpm, AudioSig proprietario. **POI reali solo Type=automix e remix — ZERO hot cue**. Voce-spazzatura: un `.zip` di installer indicizzato come Song; cartella Budha Bar sparita → tracce orfane con POI perse. `extra.db` (track_data vuota, related_tracks, lyrics). `Folders/` solo smart/virtual folder (FilterFolder con micro-sintassi: `bpmdiff<=4 and keydiff=0`, `top 50 nbplay`, `group by genre`); nessuna playlist statica; MyLists/History/Pads/Sampler **vuote**. Backup = zip monolitico. Il writer genera database.xml nuovo ma **non esporta memory cue, automix/remix, colore POI, .vdjfolder** e **non legge Volume/Phase/AltBpm**.

| Operazione | Categoria | Perché utile | Come implementarla | Fatt. | Prio. | Stato |
|---|---|---|---|---|---|---|
| Import libreria VDJ (database.xml) | conversione | Porta l'intera libreria nell'hub universale | `vdjReader.ts` readVirtualDjXml, wired library:importForeign | alta | alta | **gia** |
| Export UDM → VDJ database.xml | conversione | Far arrivare in VDJ una libreria da qualsiasi software | `vdjWriter.ts` writeVirtualDjXml, mai in-place | alta | alta | **gia** |
| Conversione X ↔ VirtualDJ | conversione | Pain n.1 di chi cambia software | ConverterPage source+target 'virtualdj' via UDM | alta | alta | **gia** |
| Import POI automix/remix come memory cue | POI | Senza questo si importerebbero 0 cue (no hot cue reali) | mapPoi: realstart+remix; estendere fade/cut/tempoStart | alta | media | parziale |
| **Export memory cue → VDJ hot cue** | POI | Oggi il writer emette solo hot+loop, le memory si perdono | Ramo c.cue_type=='memory' → Poi Type=cue Num progressivo | alta | alta | da-fare |
| Round-trip colore POI | POI | Ogni conversione azzera i colori dei cue | Color: cueColorToVdj(c.color) nell'ele Poi | alta | media | da-fare |
| Export automix/remix POI verso VDJ | POI | Senza, l'Automix ricalcola tutto e i marker spariscono | Emettere Poi Type=automix Point dai memory 'Inizio'/'Remix' | media | bassa | da-fare |
| Import gain (Volume) e beatgrid (Phase/AltBpm) | conversione | Si perdono loudness e ancora griglia verso RB/Serato | Volume→dB, Phase→anchor_ms, AltBpm→beatgridBpm | media | media | da-fare |
| Auto-Cue con scrittura POI in VDJ | POI | Popola i pad su librerie senza hot cue | Auto-Cue → NormCue hot → vdjWriter; per nuovi via tag | alta | media | parziale |
| Import playlist statiche .vdjfolder | playlist | Le playlist VDJ stanno in file sparsi, non nel DB | readVdjFolders (VirtualFolder/MyLists) | alta | alta | **gia** |
| Export playlist UDM → file .vdjfolder | playlist | Oggi l'export scrive solo database.xml | Generare .vdjfolder con xmlbuilder2, sottocartelle + file 'order' | media | alta | da-fare |
| Traduzione smart-folder ↔ FilterFolder | playlist | Ricreare in VDJ le smart-list di altri software | Mapper bidirezionale criteri UDM ↔ stringa filter | media | media | parziale |
| Materializzazione smart-folder in statica | playlist | Rende esportabili verso software senza smart-list | Interprete filtri (bpmdiff/keydiff/top N/group by) su UDM | media | media | da-fare |
| Backup incrementale config VDJ | backup | Il backup nativo è uno zip da spacchettare a mano | incrementalBackup.ts sulla root VDJ (+.vdjfolder, extra.db) | alta | alta | parziale |
| Restore selettivo dallo zip di backup | backup | Ripristino nativo tutto-o-niente | Legge lo zip, diff vs stato attuale, copia file scelti | alta | media | da-fare |
| Rilevamento/ricollocazione orfani (relocator) | riparazione | VDJ identifica per FilePath assoluto: spostare orfana | relocator (nome+fpcalc), riscrive FilePath su copia | alta | alta | parziale |
| Report file orfani / voci-spazzatura | manutenzione | Il DB reale ha orfani + un .zip spurio | orphans + filtro estensione non-audio da fileFormats | alta | alta | parziale |
| Duplicati per impronta audio | analisi | Il filtro nativo 'duplicates' confronta solo i tag | Dedup fpcalc sui FilePath, opz. Duplicates.vdjfolder | alta | media | parziale |
| Salute libreria VirtualDJ | analisi | Brani non analizzati non compaiono nelle smart-folder | health.ts + check Scan mancante, FileSize=0, non-audio | alta | media | parziale |
| Report Excel della libreria | reportistica | VDJ non offre export tabellare completo | services/excel su source='virtualdj' | alta | bassa | **gia** |
| Report SIAE / cronologia da History | reportistica | VDJ non genera borderò; History è il registro | Parser History (m3u/tracklist) → siae; fallback FirstSeen | media | media | parziale |
| Auto-Tagger metadati mancanti | tagging | Tag letti solo 'for new files', poi congelati | services/tagger + mutagen, aggiornare Tags in export | alta | media | parziale |
| Separazione stems (Demucs) pre-cache | stem | VDJ separa real-time GPU; pre-calcolo per export | Servizio Stems esistente (valore su export) | media | bassa | **gia** |
| Watcher Nuovi Acquisti verso VDJ | sync | Automatizza l'ingresso dei brani comprati | watcher → Song da unire nel database.xml esportato | alta | bassa | **gia** |
| Merge di più database.xml | manutenzione | Chi usa più macchine ha librerie divergenti | Import multi-source per FilePath+AudioSig, POI più ricche | media | media | da-fare |
| Sandbox / sola lettura sui DB in uso | riparazione | Evita corruzione se VDJ è aperto | Helper openReadOnlyCopy per extra.db/cache.db | alta | media | parziale |
| Normalizzazione key VDJ → Camelot | conversione | Ruota armonica coerente con RB/Serato | core/camelot.ts in importForeignLibrary | alta | bassa | **gia** |
| Import lyrics e related_tracks da extra.db | analisi | Dati già calcolati oggi ignorati | Reader SQLite (copia tmp), join sid, parse lyrics.xml | media | bassa | da-fare |
| Dedup/relocate assistito da AudioSig | analisi | AudioSig identifica anche con path/tag cambiati | Leggere Scan@AudioSig come match esatto pre-fpcalc | media | bassa | da-fare |
| Set Planner / Set Builder su libreria VDJ | analisi | Replica e supera 'Compatible songs' | services/planner+setbuilder, opz. export .vdjfolder | alta | media | **gia** |

**Pain point:** file spostati orfanano brani E POI (identità per FilePath assoluto; nella libreria reale l'intera cartella Budha Bar è sparita); voci-spazzatura non-audio indicizzate; migrazione perde le POI (Bpm in secondi-per-beat, key classica, POI automix/remix incomprensibili altrove); playlist statiche sparse in file+cartelle+`order`; smart-folder con micro-sintassi non riusabile; brani non analizzati senza BPM/key; nessuna vista duplicati per impronta; backup zip monolitico; tag congelati in XML; gain e beatgrid non trasferibili; History/MyLists vuote (niente SIAE).

---

### 2.5 Engine DJ (Denon / InMusic, Engine OS 3.0.2)

**Cosa è emerso dalla libreria reale:** `m.db` 224 MB, schemaVersion 3.0.2. Conteggi veri: **4397 Track, 138 Playlist, 7196 PlaylistEntity, PerformanceData 1:1**, Smartlist 0. Track: **path relativo POSIX** con `../` risolto sulla root Engine Library; length in **secondi**; **key 0-23 = ordinamento Camelot** (0=B major); **rating 0-100** (scala ×20); fileType case misto; 2 brani `isAvailable=0` (dangling). PerformanceData blob: quickCues/beatData/trackData/overview = framing `[uint32 BE len][zlib 78 9c]` **big-endian**, loops **little-endian non compresso**; hot cue 8 slot + MAIN CUE nel trailer; colore = **ARGB pieno**; sample_rate **per-traccia** (44100/48000/22050/32000). Presenza di `rbm.db` (208 MB) + originDatabaseUuid ⇒ **libreria importata da Rekordbox**. `hm.db` history schema pronto ma **vuoto**. Backup nativo = copia integrale di Database2 (non incrementale, non datata). Il reader legge già metadati/rating/playlist/hot cue/loop con SR per-traccia e colore ARGB; **non legge** main cue, beatgrid, gain, comment/label/composer, Smartlist, isFolder, history; **nessuna scrittura** (ENGINE_STATUS.available=false).

| Operazione | Categoria | Perché utile | Come implementarla | Fatt. | Prio. | Stato |
|---|---|---|---|---|---|---|
| Import completo Engine → UDM (cue/loop dai blob) | conversione | Base per usare Engine come sorgente senza export XML | engineReader.ts readEngineLibrary+readEngineCues, blob BE/LE | alta | alta | **gia** |
| Import MAIN CUE → memory cue | conversione | Main cue spostabile oggi perso in Engine→* | Leggere trailer default/adjusted_main_cue (sample) → memory | alta | media | da-fare |
| Import BEATGRID → beatgridBpm/anchorMs | conversione | Fase dei cue si disallinea senza griglia reale | readEngineBeatgrid(beatData), primo downbeat → anchor | media | media | da-fare |
| Import GAIN/loudness → gainDb | conversione | Gain perso in ogni rotta con Engine | 3 double average_loudness da trackData → gainDb | media | bassa | da-fare |
| Import metadati testuali estesi | conversione | comment(3155)/label(175)/composer(758) oggi ignorati | Estendere SELECT + mapping su NormTrack | alta | media | parziale |
| Import Smartlist Engine | playlist | Le smartlist non sopravvivono a nessuna conversione | Leggere tabella Smartlist (rules TEXT) → filtri/statiche | media | bassa | da-fare |
| Preservare gerarchia cartelle (isFolder) | playlist | Il padre aggrega i figli: import naïf crea playlist gonfie | parentListId + PlaylistAllChildren, isFolder, no duplicati | media | media | parziale |
| **WRITER Engine DJ (Track+Playlist+PerformanceData)** | conversione | Oggi Engine solo via RB XML (cap 8, no loop) | engineWriter.ts better-sqlite3, deflate+prefisso BE, ms→sample, camelot→int | media | alta | da-fare |
| Export USB/SD per player Prime | sync | Portare un set su Prime senza far ricopiare tutto a Engine | engineWriter su root USB, path relativi ../, hash verificato | media | alta | da-fare |
| Ritrova file spostati / ripara path (isAvailable=0) | riparazione | 2 brani già dangling; path relativi fragili sul computer | relocator (nome+fpcalc), riscrive Track.path + isAvailable=1 | alta | alta | parziale |
| Backup incrementale Database2 | backup | Backup nativo = copia completa non datata, dimenticata | incrementalBackup su Database2, rotazione datata | alta | media | parziale |
| Import HISTORY (hm.db) → SIAE/statistiche | reportistica | History chiusa in Engine; report dei brani suonati | Reader hm.db, join HistorylistEntity→Track → siaeReport | media | alta | da-fare |
| Deduplica libreria Engine per impronta | dedup | Playlist manuali 'Doublons'/'A SUPPRIMER' provano i doppioni | Dedup Chromaprint su UDM post-import, rimozione sicura | alta | media | parziale |
| File orfani (AlbumArt/OverviewData) | manutenzione | Artwork/waveform orfani gonfiano m.db a 224 MB | orphanFinder + AlbumArt.id non referenziati, path mancanti | alta | media | parziale |
| Report Excel Engine | reportistica | Vista tabellare/filtrabile che Engine non offre | reportGenerator.ts + colonne isAvailable, n° cue | alta | bassa | **gia** |
| Salute libreria Engine | analisi | Individua brani non pronti per il palco | health.ts + isAvailable=0, isAnalyzed=0, cue vuoti, fileType | alta | media | parziale |
| Riconciliazione Engine ↔ RB (rbm.db) | sync | Evita doppioni e cue disallineati usando più software | Mappa originDatabaseUuid/originTrackId per aggiornare non duplicare | media | bassa | da-fare |
| Auto-Cue scritto in Engine | conversione | Playlist 'A poser Hot CUE': elimina il lavoro manuale | Auto-Cue → writer Engine (quickCues BE zlib, 8 slot) | media | media | parziale |
| Auto-Tagger scritti in Engine | conversione | 175/4397 con label: metadati incompleti | autoTagger → writer Engine (Track + AlbumArt) su copia | media | bassa | parziale |
| Watcher Nuovi Acquisti → import Engine | sync | Cartelle downloads/Beatport/Amazon già presenti | syncDaemon + writer Engine, coda analisi isAnalyzed=0 | media | bassa | parziale |
| Conversione unità Engine-safe (key/rating/length/SR) | conversione | Unità che i convertitori sbagliano più spesso | Helper centralizzati, test su brani a 48/22/32 kHz | alta | alta | parziale |

**Pain point:** Import Assistant con scelta globale Memory-vs-Hot e cap 8 pad; nessun export nativo verso Serato/Traktor; path relativi che diventano dangling sul computer; backup integrale non incrementale né datato; cambio schema (3.0.1→3.0.2) senza rollback selettivo; cue/loop/beatgrid/gain in blob zlib invisibili; nessuna dedup nativa; history chiusa; smartlist e gerarchia perse in conversione; unità (rating 0-100, key 0-23, secondi) che i convertitori naïf sbagliano; export USB Prime lento e opaco.

---

## 3. Operazioni trasversali (valide per più programmi)

Molte funzioni sono lo **stesso motore** applicato a formati diversi. Consolidarle come servizi generici sull'UDM riduce la duplicazione.

| Capacità trasversale | Programmi coinvolti | Cosa unifica | Stato aggregato |
|---|---|---|---|
| **Hub UDM unico (pivot)** | Tutti e 5 | Ogni conversione X→Y passa dal modello universale (track/cue/loop/playlist/gain/rating/color/beatgrid) | Nucleo già in CrateForge; alcune colonne (gain/rating/color/beatgrid) restano NULL per certi reader |
| **Backup incrementale verificato a hash pre-conversione** | Tutti | Snapshot datato + copyWithVerify come step **bloccante** prima di ogni scrittura distruttiva | RB già; Traktor già; VDJ/Engine parziale; Serato deve includere i GEOB nei file |
| **Restore selettivo dai backup** | RB, Serato, VDJ, Engine | Diff snapshot vs stato attuale + ripristino granulare (RB non offre restore selettivo, Serato/VDJ solo zip, Engine copia integrale) | Da fare quasi ovunque |
| **Dedup per impronta acustica (Chromaprint)** | Tutti | Trova copie reali oltre path/tag; RB/Engine/VDJ hanno playlist 'Doublons'/'duplicates' manuali. AUDIO_ID Traktor e AudioSig VDJ come match esatto pre-fpcalc | Motore già presente; da estendere a Traktor/VDJ/Engine come modalità |
| **Ritrovamento/rilocazione file spostati** | Tutti | matchByFilename + fingerprint fpcalc; poi **scrittura in-place nel DB nativo** (path assoluti RB/VDJ, relativi Serato/Engine, VOLUME Traktor) | relocator esiste; la riscrittura nei DB nativi è parziale/da-fare per Serato/Traktor/VDJ/Engine |
| **File orfani / voci fantasma** | Tutti | File su disco non in libreria + entry DB senza file | RB/Traktor già; VDJ/Engine parziale |
| **Normalizzazione tag/key (Camelot/Open Key/classica)** | Tutti | RB KeyID, Traktor 0-23, VDJ classica, Engine 0-23-Camelot → notazione unica | core/camelot.ts esiste; export nella notazione preferita parziale |
| **Preservazione gain/rating/colore/beatgrid nel round-trip** | Traktor, Serato, VDJ, Engine (RB già) | I metadati performance letti ma non riscritti: ogni conversione li azzera | RB completo; gli altri parziale/da-fare — **quick win ad alto impatto** |
| **Traduzione/materializzazione smart-list** | Tutti | Smartlist Traktor, FilterFolder VDJ, Smart Crate Serato, Smartlist Engine, smart RB → IR regole comune, poi statica o dinamica sul target | Da fare quasi ovunque |
| **Sync USB / export standalone** | RB (PIONEER), Engine (Prime), Traktor/VDJ (cartella autonoma) | Consolida i file + riscrive i path per un drive portabile | Da fare per RB/Engine; consolidamento cartella da fare per Traktor/VDJ |
| **Reportistica Excel** | Tutti | services/excel su UDM, indipendente dalla sorgente | Già in CrateForge per tutti |
| **Reportistica SIAE / tracklist da history** | RB (201 sessioni), Engine (hm.db), Serato/VDJ/Traktor (session/History) | siaeReport.ts formatta i brani suonati per adempimento | RB completo; Engine/altri parziale/da-fare (spesso history vuota) |
| **Auto-Cue / Auto-Tagger / Stems** | Tutti | Servizi di analisi (sidecar) riusabili, output scritto via writer o DB | Motori già presenti; la scrittura nel formato nativo è parziale |
| **Watcher Nuovi Acquisti** | Tutti | Sorveglia le cartelle download e prepara l'ingest | Già/parziale a seconda del writer nativo |
| **Set Planner / Set Builder** | Tutti | Scalette per BPM/Camelot/energia sull'UDM | Già in CrateForge |

---

## 4. Roadmap prioritizzata unica

Ordine consigliato = massimizzare (impatto × fattibilità) mettendo prima i writer nativi che sbloccano intere rotte di conversione e i quick-win di round-trip.

### Da fare / parziale (interventi prioritari)

| # | Intervento | Programmi | Impatto | Fatt. | Stato attuale |
|---|---|---|---|---|---|
| 1 | Preserva colore cue + rating + gain nel round-trip | Traktor, VDJ, Serato, Engine | Alto | Alta | parziale/da-fare |
| 2 | Writer nativo Serato (GEOB Markers2 + BeatGrid + DB V2/.crate) | Serato | Alto | Alta→media | da-fare |
| 3 | Bump NML VERSION 19→20 + export RANKING/LOUDNESS Traktor | Traktor | Alto | Alta | da-fare |
| 4 | Superare cap 8 hot cue + loop (scrittura diretta DjmdCue) | Rekordbox | Alto | Media | parziale |
| 5 | Writer nativo Engine DJ (m.db + PerformanceData) | Engine | Alto | Media | da-fare |
| 6 | Relocator che riscrive i DB nativi in-place | Tutti | Alto | Alta→media | parziale |
| 7 | Export playlist → .vdjfolder + preserva cartelle Traktor | VDJ, Traktor | Alto | Media | da-fare |
| 8 | Export memory cue → VDJ hot cue + round-trip colore POI | VirtualDJ | Alto | Alta | da-fare |
| 9 | Backup incrementale pre-conversione unificato (bloccante) | VDJ, Engine, Serato | Alto | Alta | parziale |
| 10 | Import BeatGrid + gain + colore traccia Serato | Serato | Medio-alto | Alta | da-fare |
| 11 | Materializza/traduci Smartlist (Traktor, poi VDJ/Serato/Engine) | Traktor, VDJ, Serato, Engine | Medio-alto | Media | da-fare |
| 12 | Import HISTORY reale per SIAE (Engine hm.db, Traktor, VDJ, Serato) | Engine + altri | Medio-alto | Media | da-fare/parziale |
| 13 | Import main cue + beatgrid + metadati testuali Engine | Engine | Medio | Alta→media | da-fare/parziale |
| 14 | Import gain/beatgrid VDJ (Volume/Phase/AltBpm) | VirtualDJ | Medio | Media | da-fare |
| 15 | Export USB standalone (Engine Prime, poi RB PIONEER) | Engine, RB | Medio | Media | da-fare |
| 16 | Voci fantasma / report orfani + voci-spazzatura | RB, VDJ | Medio | Alta | da-fare/parziale |
| 17 | Migrazione MyTag RB + tag da COMMENT Traktor | RB, Traktor | Medio | Media | da-fare |
| 18 | Restore selettivo dai backup | RB, Serato, VDJ, Engine | Medio | Alta→media | da-fare |
| 19 | Dedup cross-libreria via AUDIO_ID/AudioSig + merge | Traktor, VDJ, RB, Engine | Medio | Media | parziale/da-fare |
| 20 | Import Mixed In Key + cue legacy Markers_ Serato | Serato | Medio | Media | da-fare |
| 21 | Migrazione commenti/ISRC RB, statistiche DJPlayCount | Rekordbox | Basso-medio | Alta | da-fare |
| 22 | Pulizia cache (Traktor Stripes, Serato Overview/Offsets_, Engine art) | Traktor, Serato, Engine | Basso-medio | Media | da-fare |
| 23 | Consolidamento file in cartella unica + ripath | RB, Traktor, Engine | Basso-medio | Media | da-fare |
| 24 | Auto-Cue scritto nei formati nativi | Tutti | Basso-medio | Media | parziale |
| 25 | Stems container (.stem.mp4 Traktor), lyrics/related VDJ | Traktor, VDJ | Basso | Bassa-media | parziale/da-fare |

### Già fatto (base solida da consolidare)

| Area | Programmi | Note |
|---|---|---|
| Import completo della libreria nativa | Tutti e 5 | RB (master.db cifrato), Serato (DB V2+GEOB), Traktor (NML), VDJ (database.xml+.vdjfolder), Engine (m.db + cue/loop dai blob) |
| Conversione X↔Y via UDM | RB, Traktor, VDJ (bidirezionale); Serato/Engine (import) | Serato→* e *→Engine mancano dei writer nativi |
| Backup incrementale a hash | RB, Traktor | Da estendere a VDJ/Engine/Serato con i GEOB |
| Ritrovamento file (relocator base) | Tutti | Scrittura nei DB nativi da completare |
| File orfani, Salute, Report Excel, Dedup impronta | Tutti (vari livelli) | Servizi generici sull'UDM |
| Auto-Cue, Auto-Tagger, Stems, Watcher, Set Planner/Builder | Tutti | Motori pronti; l'ultimo miglio è la scrittura nativa |
| Scrittura diretta playlist master.db RB | Rekordbox | Su copia ricifrata, blocca se RB aperto |
| Normalizzazione key → Camelot | Tutti | core/camelot.ts |

---

## 5. Conclusioni

1. **Il valore residuo è nella scrittura, non nella lettura.** L'import è coperto ovunque (39 operazioni già fatte, in gran parte reader). I 63 interventi "da fare" e i 44 "parziali" sono dominati dai **writer nativi** — Serato (GEOB nei file), Engine (m.db/PerformanceData), scrittura diretta cue Rekordbox oltre il cap 8, .vdjfolder VirtualDJ, riscrittura in-place dei DB. Questi sbloccano le rotte di migrazione che nessun canale ufficiale offre.

2. **I quick-win a più alto rapporto valore/costo sono i round-trip di metadati** (colore cue, rating, gain, beatgrid anchor). Sono già supportati dall'UDM ma i reader/writer non li popolano: il codice esiste, mancano poche righe per adapter, e l'utente percepisce subito la differenza (stelle, colori e volumi che non si azzerano più a ogni conversione).

3. **I pain point sono strutturalmente identici tra software** — path fragili (assoluti RB/VDJ, relativi Serato/Engine, VOLUME Traktor), smart-list che degradano a statiche, backup opachi/monolitici, cue chiusi in formati binari. Questo giustifica investire nei **servizi trasversali** (relocator che scrive nei DB, backup pre-conversione bloccante, traduttore smart-list IR, SIAE da history) una volta sola e applicarli ai cinque adapter.

4. **Rispetto ai dati reali:** la libreria è ricca e vissuta (6102 brani RB con 99 MyTag e 3406 assegnazioni; 4735 ENTRY Traktor con rating/loudness/colori pieni; 4397 Track Engine importati da Rekordbox). I dati "prigionieri" più preziosi — MyTag, colori cue, gain, main cue Engine, hot cue oltre l'8° slot — sono esattamente ciò che i canali ufficiali perdono e che CrateForge può preservare. Il caso VirtualDJ mostra invece librerie piccole/di test con orfani e voci-spazzatura reali, dove il valore immediato è **diagnostica e pulizia** più che migrazione.

5. **Ordine operativo consigliato:** (a) chiudere i round-trip di metadati su tutti gli adapter; (b) writer nativo Serato ed Engine; (c) superare il cap 8 hot cue di Rekordbox; (d) rendere il backup pre-conversione uno step bloccante universale; (e) relocator in-place; (f) smart-list e SIAE da history. Con questi sei blocchi CrateForge passa da "lettore universale" a "convertitore/riparatore universale a perdita zero".