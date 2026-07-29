# PROGRESS — checklist deliverable e requisiti per fase (§0.6, §12)

Checkpoint di macro-fase: a fine fase ri-verificare il codice contro questa
lista e le regole inderogabili (§3), riepilogare fatto/mancante, attendere via.

## FASE 1 — MVP (Node + sidecar Python base)

### Infrastruttura
- [x] Electron + TypeScript + React (electron-vite), UI shadcn/ui + lucide-react
- [x] UDM SQLite in chiaro (better-sqlite3, WAL, busy_timeout), schema/migrazioni owned da Node
- [x] Writer-ownership per tabella (ingestion: sidecar/XML-ingest; applicative: solo Node)
- [x] Handshake `--udm-path` allo spawn del sidecar (Node decide il percorso, Python non fa DDL)
- [x] Throttling eventi IPC di progresso (ThrottledProgress lato Node, ~150ms/100 item lato Python)
- [x] Mai bulk data su IPC (UI paginata; piani di backup trattenuti nel main)
- [x] Sidecar Python: `sidecar.py` (ping / ingest-masterdb / fingerprint), build PyInstaller `--onedir` (sh + ps1)
- [x] Fallback "sidecar non trovato" con messaggio antivirus/quarantena, degrado solo-XML
- [x] electron-builder (dmg/zip · nsis/portable) + GitHub Actions matrix macOS+Windows
- [x] Vitest: 49 test verdi (runner dentro Electron per l'ABI di better-sqlite3)

### Funzionalità
- [x] 1. Backup Smart Incrementale (snapshot DB prima di tutto, diff mtime+size, hash opzionale con verifica)
- [x] 2. Cacciatore File Orfani (diff, spazio recuperabile, quarantena reversibile, doppia conferma "SPOSTA")
- [x] 3. Report Excel (streaming, versione da regex, Camelot, "Manca tag?" in rosso, filtri, totale durata)
- [x] 4. Converter: Rekordbox XML (max 8 hot cue applicato), Traktor NML, VirtualDJ XML; Serato/Engine "in arrivo"
- [x] 5. Relocator base (match per nome file, dry-run, XML di aggiornamento; mai scritture su master.db)
- [x] 6. Encoding: rilevazione (chardet), fix mojibake, vista "Da revisionare", esclusione dagli export
- [x] Modalità solo-XML completa (ingestion collection XML pure-Node)
- [x] Ingestion master.db via pyrekordbox nel sidecar (scrittura diretta in UDM)

### UX (§5, §7)
- [x] Sidebar + 10 pagine, wizard passo-passo con dry-run
- [x] Dark/Light/Auto + toggle, it/en, modalità Semplice/Esperto (voci expertOnly nascoste)
- [x] DangerConfirmDialog (parola chiave + checkbox) per azioni distruttive
- [x] Banner limiti XML non ignorabile prima di ogni export (checkbox di presa visione)
- [x] Messaggi in linguaggio umano, schermata solo-XML con istruzioni
- [x] About con logo placeholder (assets/branding/) e credito TX-Breaker × Rekordbox DJ Italia Group
- [x] Registro operazioni leggibile + export .txt

### Testing (§11)
- [x] Fixture cifrata SOLO via Python (`make_encrypted_fixture.py`, sqlcipher3) — Node mai sul cifrato
- [x] Test UDM su SQLite in chiaro (migrazioni, paginazione, settings, oplog)
- [x] Unit: versionRegex, camelot, encoding/mojibake, ingestion XML, writer XML (limite 8 hot cue), orfani, backup incrementale
- [x] Dry-run testato (backup plan, quarantena)
- [ ] Rollback ID3 — rimandato: la scrittura ID3 è Fase 2 (Serato), il test arriverà col servizio

### Da fare / verifiche residue Fase 1
- [x] Build sidecar su questa macchina (PyInstaller --onedir, binario testato: `ping` ok)
- [x] Test e2e sidecar: handshake --udm-path, degrado pulito su DB incompatibile (44/44 test verdi)
- [x] `npm run dist` locale ok: NSIS Setup + portable in `release/`, sidecar incluso in resources
- [x] Smoke run del pacchetto: CrateForge.exe parte e resta vivo (no crash all'avvio)
- [ ] Test manuale UI umano su tutte le pagine (click-through con dati reali)
- [ ] Ingest end-to-end da un VERO master.db (fixture minima non basta per pyrekordbox ORM: prevista opzione utente §11)
- [x] Istruzioni visive per export/import XML manuale: GuideDialog con schemi
      SVG disegnati (niente screenshot proprietari Pioneer), 4 lingue, 2 guide
      (esporta collection / importa XML in Rekordbox). Agganciata a: Dashboard
      (alert solo-XML + bottone sotto l'import), Converter (esito export),
      Relocator (esito XML)
- [x] Icona applicazione: `build/icon.png` + `icon.ico` generati (crate+vinili+scintilla,
      tema dark/ambra); electron-builder li rileva via buildResources e genera
      l'icns per mac. Rigenerabile: era PIL-script one-shot, il PNG è la fonte

## FASE 2 — AI (modalità Esperto, sperimentale) — CORE FUNZIONANTE
- [x] Dedup per fingerprint: `fingerprint-batch` nel sidecar (acoustic_id = simhash
      Chromaprint a 4 segmenti), pagina Duplicati con quarantena reversibile
      (doppia conferma "SPOSTA"), colonna "Acoustic ID" nel report Excel
- [x] Relocator per fingerprint: `match-fingerprints` (scrive in
      `relocation_matches`, schema UDM v2), sezione dedicata nel Relocator,
      XML di aggiornamento via writer esistente
- [x] Auto-Cue ASSISTITO: `analyze-cues` (aubio onset/energia → intro/drop/
      breakdown/outro, max 8), UI human-in-the-loop (rivedi/sposta/rimuovi,
      salva solo su click; verso Rekordbox sempre via XML). UI waveform: rinviata
      (lista editabile per ora). madmom/essentia/allin1: solo mac/Linux, commentati
      in requirements-ai.txt
- [x] Auto-Tagger MusicBrainz: solo query testuali artista/titolo (mai audio),
      rate-limit 1 req/s + retry con backoff, soglia score ≥90, proposte→revisione→
      apply solo su UDM. Discogs (richiede token): rinviato
- [x] Stems (Demucs) on-demand, cancellabile, degrado pulito se non installato
- [x] Livello AI opzionale: `requirements-ai.txt` separato; senza librerie i comandi
      falliscono con messaggio chiaro in-app, il sidecar base resta intatto
- [x] Test: autoTagger (mock fetch: score, retry 503, offline), migrazione v2
      (49/49 verdi, typecheck pulito)
- [ ] Scrittura ID3 su copia con rollback verificato (Serato) — rinviata a Fase 3
      (richiede serato-connect + safeguard dedicati)
- [x] UI waveform per i cue: il sidecar emette `envelope` RMS normalizzata
      (max 480 bucket, pochi KB — non campioni audio) da `analyze-cues`;
      `Waveform.tsx` la disegna in SVG con marker colorati trascinabili
      (drag → aggiorna positionMs), fallback automatico alla sola lista se
      l'envelope manca. Onestà in UI: nessun ascolto, verifica in Rekordbox.
      Sidecar ricompilato con la modifica
- [ ] Verifica manuale con fpcalc/aubio installati su questa macchina

## FASE INTERMEDIA (post-F3, richieste utente 02/07/2026) — COMPLETATA
- [x] Scritture dirette sui file originali (opt-in): setting Esperto `directWrites`
      con doppio disclaimer; gate anche lato main (non solo UI). Sbloccate:
      eliminazione DEFINITIVA orfani (conferma "ELIMINA") e scrittura tag ID3
      sugli originali via sidecar mutagen (backup per-file verificato con hash,
      rollback automatico, conferma "SCRIVI"). Il master.db resta SEMPRE
      read-only (cifrato, schema non documentato: un errore = libreria persa) —
      motivato in UI
- [x] Visualizzatore Excel in ReportPage: lettura paginata in main (max 500
      righe/colpo), scroll orizzontale, colonne ridimensionabili col mouse,
      larghezze persistite per nome colonna e resettabili
- [x] i18n francese + tedesco (dizionario nav/common/target; DEBITO: i testi
      lunghi delle pagine restano in italiano, vale anche per l'inglese)
- [x] fpcalc (Chromaprint 1.5.1) incluso nel pacchetto: download automatico nei
      build script (ps1+sh), sidecar lo cerca accanto al proprio eseguibile →
      l'utente non installa nulla. Verificato nel pacchetto win-unpacked
- [x] Auto-Cue rifatto: browser della libreria (ricerca o playlist intera),
      abilita/disabilita per brano, analisi batch interrompibile, revisione e
      salvataggio per-brano o "salva tutti"
- [x] Auto-Tagger: provider Discogs (token personale nelle Impostazioni,
      style>genre, retry su 429) accanto a MusicBrainz
- [x] download-key pyrekordbox in-app (§4.3): bottone in Impostazioni (Esperto),
      suggerito anche nel messaggio di errore dell'ingest master.db
- [x] SaveTargetNotice: ogni esito dichiara la destinazione (UDM/copia/XML/
      ORIGINALI) — su Tagger, AutoCue, Dedup, Stems, Converter, Inbox, Relocator
- [x] Stems: dichiarato in UI che Demucs gira 100% in locale, nessun upload
- [x] Bug visivo Alert (titolo sovrapposto all'icona): `[&>svg~*]:pl-7`
- [x] Sidecar ricompilato (write-tags, download-key, fpcalc path); 69/69 test,
      typecheck pulito, dist rigenerato, smoke run ok
- [x] Localizzazione testi di pagina (it/en/fr/de) COMPLETATA su tutte le
      16 pagine: pattern in `lib/i18nPages.ts` (namespace per pagina,
      segnaposto {x}, fallback it). Migrate in 3 blocchi finali:
      Report/Relocator/Review/Log, Dedup/Tagger/Stems/Inbox,
      AutoCue/Planner/Settings/About. Restano in italiano solo i nomi
      propri (playlist "CrateForge – Nuovi Acquisti" nell'XML) e le parole
      chiave delle doppie conferme (SPOSTA/ELIMINA/SCRIVI), identiche in
      tutte le lingue per sicurezza
- [x] Test automatico write-tags: `tests/writeTags.e2e.test.ts` (3 test) con MP3
      minimo VALIDO generato in Python (`tests/fixtures/make_audio_fixture.py`,
      frame MPEG reali + EasyID3). Copre: happy path (backup byte-identico al
      pre-scrittura, tag verificati in rilettura), rollback su file non-audio
      (contenuto intatto, hash uguale), file inesistente (errore pulito).
      Suite: 72/72 verdi

## FOLLOW-UP DA ANALISI COMPLETA (workflow 14/07, 14/14 agent) — BLOCCHI D–J
Il workflow di analisi+ricerca ha finalmente completato tutto (7 code-map + 6
ricerca formati + piano sintesi). Piano completo salvato in `docs/ANALISI-PIANO.md`.
Applicati altri fix prioritari (oltre ai blocchi A–C già fatti):
- [x] D — coda job unica (withJobLock): serializza ingestion + ogni job sidecar,
      risolve concorrenza UDM Node/Python (SQLITE_BUSY) e race su currentCancel
- [x] E — payload sidecar via file (--tags-file/--content-ids-file): niente
      limite argv Windows 32K; +validazione cues:save; sidecar analyze-cues
      try/except; +test e2e --tags-file
- [x] F — test relocator (feature distruttiva prima non testata) + gate CI
      (pull_request, job check typecheck+test, concurrency, matrice mac x64+arm64,
      verifica sidecar+fpcalc nell'artefatto, cache pip, retention)
- [x] G — sidecar cancel = tree-kill (taskkill /T su win, process group POSIX +
      escalation SIGKILL) + parse/dispatch eventi separati
- [x] H — RISCHI DATI: normalizzazione Unicode NFC (canonicalizePath/Name in
      fsutil) in orphans+relocator (su macOS NFD-disk vs NFC-DB = falsi orfani →
      cancellazioni); quarantena trova dest libero prima di spostare (rename
      sovrascriveva gli omonimi)
- [x] I — sidecar: playlist master.db position=indice progressivo (PK collideva
      → brani persi); stems in build frozen via demucs in-process
- [x] J — Dashboard catch mancante + numeri/messaggi localizzati (no più it-IT
      hardcoded). 168/168 test totali

### ANCORA APERTI dal piano (docs/ANALISI-PIANO.md), non ancora fatti:
- [ ] Perf: relocator existsSync sincrono → fs.promises.access con concorrenza;
      reportViewer ri-parsa l'xlsx a ogni pagina → cache LRU per path+mtime
- [ ] UX: stato di lavoro perso al cambio pagina (routing per smontaggio);
      scoperta modalità Esperto (voci lucchetto + hint Health cliccabili);
      onboarding primo avvio; persistenza percorsi Backup; azioni per riga in
      ReviewPage; refactor componenti condivisi (Pager/OutcomeAlerts/useAsyncAction)
- [ ] i18n residuo: JobProgress/ExcelViewer etichette hardcoded
- [ ] CONVERSIONE Blocco 4: Serato read/write (crate binari + GEOB "Serato
      Markers2/BeatGrid" via sidecar Python; rif. serato-tags/seratojs); Engine
      cue/loop dai blob PerformanceData (zlib, rif. djinterop); VirtualDJ
      playlist da .vdjfolder; export Engine (m.db nuovo)
- [ ] Schema v5: rating/color/comment/track_number + tabella beatgrids (oggi
      rating e colore traccia non fluiscono in nessuna direzione)
- [ ] Dedup cross-source nell'UDM (stesso file da Traktor+Engine+Rekordbox = 2-3
      righe tracks); merge per path normalizzato/acoustic_id
- [ ] syncDaemon: confronto path canonicalizzato (NFC) come orphans

## HARDENING DA ANALISI CODICE (workflow multi-agente, 13-14/07/2026) — 3 BLOCCHI
Il workflow di analisi ha mappato i 7 sottosistemi (i ricercatori formati sono
falliti per limite sessione; ricerca fatta inline). Applicati i fix prioritari:
- [x] Blocco A (core): camelot M/m maiuscola-minuscola + dur/moll + enarmonici;
      harmony check laschi su BPM undefined/NaN; getSchemaVersion lancia su
      valore corrotto; TrackRow.source = TrackSource condiviso + created_at;
      escape metacaratteri LIKE; health missingKey con TRIM + score duplicati
      solo sulle copie in eccesso. +6 test
- [x] Blocco B (main/sicurezza): gate non falsificabili (settings:set rifiuta
      directWrites/masterDbWrites, canale security:setGate con conferma nativa);
      orphans:delete solo sui path di una scansione reale (scanId nel main);
      win() non crasha (focused??first, ThrottledProgress tollera undefined);
      finestra hardened (sandbox true, openExternal http/https, will-navigate,
      single-instance, openUdm try/catch+showErrorBox, before-quit dispose);
      clamp limit negativi. Smoke ok
- [x] Blocco C (adapters): Traktor MUSICAL_KEY intero 0-23 (era testo, key persa)
      + traktorKeys.ts condiviso; nmlReader esclude TYPE 1/2/3; pathToLocation
      non codifica il drive letter (Rekordbox non risolveva su Windows);
      kindFromPath (no piu' FLAC/WAV come MP3); vdjWriter Infos SongLength;
      engineReader ordine playlist via catena nextEntityId. +test adapters +
      test parita i18n (63 check). 162/162 test totali
- [ ] Follow-up non ancora fatti (da analisi): coda job unica withJobLock per
      concorrenza UDM Node/Python; sidecar payload via file (argv >32K su Win);
      sidecar tree-kill su cancel; ingest cue dal master.db; test relocator;
      CI gate (pull_request+typecheck+coverage); nmlWriter gerarchia cartelle;
      schema v5 rating/color/comment + tabella beatgrids; dedup cross-source

## CONVERSIONE BIDIREZIONALE (richiesta utente 03/07/2026) — IN CORSO
Obiettivo: import DA ogni software DJ verso l'UDM (hub) + export verso ogni
software. Oggi export c'era (Rekordbox XML, Traktor NML, VirtualDJ XML); mancava
l'IMPORT dagli altri. Architettura: reader → modello normalizzato
(`core/foreignImport.ts`, NormTrack/NormCue/NormPlaylist) → UDM con `source`
dedicato. Migrazione schema v4: allargato il vincolo `source` di tracks/playlists
(ricostruzione tabelle senza CHECK, id preservati, FK OFF durante migrate).
- [x] Blocco 1: import Traktor NML (`adapters/traktor/nmlReader.ts`) e VirtualDJ
      database.xml (`adapters/virtualdj/vdjReader.ts`), pure-Node, sola lettura.
      Mappano brani, BPM (VDJ secondi-per-beat→BPM), key (Traktor index 0-23→
      classica), cue hot/loop (grid/beatgrid esclusi), playlist Traktor (VDJ no:
      sono .vdjfolder). Idempotente per (source, source_id). UI Dashboard
      "Importa da un altro software DJ" + i18n 4 lingue. 84/84 test (6 nuovi:
      migrazione v4, path Traktor, import Traktor+VDJ, vdjBpm)
- [ ] Blocco 2: import Engine DJ (SQLite in chiaro via better-sqlite3, brani +
      playlist; cue sono blob, rimandati)
- [ ] Blocco 3: import/export Serato (GEOB ID3 via sidecar Python/mutagen)
- [x] Blocco 2: import Engine DJ (`adapters/engine/engineReader.ts`, SQLite in
      chiaro via better-sqlite3, reader difensivo con introspezione colonne).
      Brani, BPM, key 0-23, playlist; cue rimandati (blob). 87/87 test
- [x] Blocco 3: matrice conversioni bidirezionale in ConverterPage
      (`ConversionMatrix`): tabella Software × Import/Export con capability
      ●/◐/○ e note, i18n 4 lingue. Rende esplicito e onesto cosa si converte
- [ ] Blocco 4: import/export Serato (GEOB ID3 via sidecar Python/mutagen) +
      export Engine DJ (scrittura m.db nuovo) — completano la bidirezionalità
- [ ] Nota: gli export writer esistenti (Traktor/VDJ) portano solo hot cue+loop
      base; beatgrid dettagliata e memory cue color restano da arricchire

## SCRITTURA DIRETTA MASTER.DB (richiesta utente 03/07/2026) — COMPLETATA
Ricerca: la cifratura del master.db (Rekordbox 6) è SQLCipher con chiave FISSA
documentata pubblicamente (`402fd482...608497`, fonte liamcottle + pyrekordbox).
pyrekordbox 0.4.3 (già dipendenza) espone la scrittura: `create_playlist`,
`add_to_playlist`, `commit(autoinc=True)` che aggiorna l'USN. La scrittura è
tecnicamente affidabile; l'unico vero rischio è la concorrenza con Rekordbox
aperto. Quindi ABILITATA come opt-in consapevole, non più vietata a priori.
- [x] Sidecar `masterdb-create-playlist`: apre/riscrive/ricifra il master.db via
      pyrekordbox, rollback su errore, riporta added/missing
- [x] Gate `masterDbWrites` (setting separato e più forte di `directWrites`),
      controllato ANCHE nel main (throw se off)
- [x] Backup OBBLIGATORIO master.db + options.json (byte-copy Node, sorgente
      read-only) in userData/backups/masterdb-<ts>/ PRIMA di ogni scrittura
- [x] Set Builder: bottone "Scrivi playlist direttamente in Rekordbox" (solo se
      opt-in), doppia conferma "MASTERDB" + istruzione "chiudi Rekordbox";
      funziona solo su brani con source_id (libreria da master.db, non da XML)
- [x] SaveTargetNotice nuovo target 'masterdb' (rosso), Impostazioni con
      disclaimer forte (spiega chiave documentata vs rischio concorrenza), 4 lingue
- [x] 78/78 test, typecheck pulito, sidecar ricompilato (comando presente,
      ping ok, fpcalc reincluso), dist rigenerato, smoke ALIVE=True
- [ ] NON testato end-to-end su un vero master.db (serve Rekordbox installato):
      va provato dall'utente su una COPIA prima che su libreria reale
- [ ] Estensioni future possibili (stessa infrastruttura): scrivere memory cue,
      MyTag, oltre-8 hot cue — cose che l'XML non porta

## FUNZIONI EXTRA (proposte in autonomia, 03/07/2026) — COMPLETATE
- [x] Salute libreria (modalità Semplice, read-only): punteggio 0–100 pesato
      (BPM/key 25+25, genere 15, anno 10, review 15, duplicati 10), righe
      "cosa manca → dove sistemarlo" con barre percentuali; solo COUNT SQL,
      niente scansioni filesystem. core/health.ts + HealthPage
- [x] Set Builder (Esperto, read-only): scaletta suggerita da un brano di
      partenza — greedy su regola Camelot + finestra BPM ±6%, curva
      up/flat/down (~±1.5%/passo), bonus stesso genere, malus stesso artista
      di fila, stop onesto con "exhausted" se mancano candidati; export XML
      con playlist "CrateForge – Set Builder" (import manuale, come sempre).
      services/setbuilder + adapters/rekordbox/setXml + SetBuilderPage
- [x] i18n completo per entrambe (namespace health/setbuilder × 4 lingue)
- [x] Test: health (vuota/perfetta/buchi+duplicati), setBuilder (catena
      compatibile senza ripetizioni, exhausted, errore su start senza
      key/BPM) — 78/78 verdi

## FASE 3 — Power user (modalità Esperto) — CORE FUNZIONANTE
- [x] Sync Daemon "Nuovi Acquisti": fs.watch ricorsivo con debounce 2s, scansione
      idempotente (skip file già in coda o in libreria), tag via music-metadata,
      camelot+versione normalizzati, coda `inbox_items` (schema UDM v3, owner Node),
      riavvio automatico se attivo nella sessione precedente. Onestà: attivo solo
      ad app aperta (dichiarato in UI), niente iniezioni nel master.db — genera
      XML con playlist "CrateForge – Nuovi Acquisti" da importare a mano
- [x] Set Planner: analisi read-only delle transizioni (regola Camelot con anello
      12↔1, soglia salto BPM 6%), tracce-ponte compatibili con entrambi i lati e
      BPM intermedio. Limite dichiarato in UI: energia non nel DB, BPM come proxy
- [x] Test: harmony (parse/compatibilità/wrap/transizioni), setPlanner
      (playlist/clash/ponti), syncDaemon (idempotenza/corrotti/skip libreria),
      inboxXml — 63/63 verdi, typecheck pulito
- [x] `npm run dist` rigenerato con Fase 2+3; smoke run del pacchetto ok
- [ ] Daemon come servizio di sistema ad app chiusa — fuori scope volutamente
      (onestà §1: la UI dice "attivo mentre CrateForge è aperto")
- [ ] Proposta cue automatica sugli item della coda (richiede livello AI; per ora
      si usa Auto-Cue dopo l'import)

## NOTE "vs Rekordbox" + REPORT SIAE (richieste utente 13-14/07/2026)
- [x] Nota inline "Rispetto a Rekordbox" per pagina: componente RekordboxDiff,
      namespace i18n `rbdiff` (label + 12 pagine × 4 lingue), spiega differenza e
      beneficio (es. backup incrementale vs backup completo Rekordbox). Cablata
      nelle 12 pagine funzione
- [x] Report SIAE: esporta i brani riprodotti in una serata per la dichiarazione.
      DEFAULT = dalla CRONOLOGIA che Rekordbox già registra nel master.db
      (DjmdHistory/DjmdSongHistory via pyrekordbox) — nessuna cattura live,
      master.db in sola lettura. Sidecar `read-history` → tabella UDM
      `play_history` (schema v5); services/siae/siaeReport.ts genera lo .xlsx nel
      formato "programma musicale" (N./Titolo/Autore-Interprete/Album-Etichetta/
      Anno/Durata/ISRC/Genere). SiaePage + nav `nav.siae` + namespace `siae` ×4
- [x] Modalità "cattura live" (PRO DJ LINK) mostrata solo in Esperto e flaggata
      onestamente come sperimentale/non ancora disponibile (radio disabilita il
      pulsante di lettura): di default resta la cronologia, come consigliato
- [x] Onestà colonne SIAE: ISRC/autore-editore spesso assenti in Rekordbox → le
      colonne restano, vuote dove il dato manca (dichiarato nel box "Come funziona")
- [x] BUG LATENTE risolto: il binario PyInstaller NON includeva numpy con le sue
      estensioni C (numpy 2.x, `numpy._core._exceptions`), quindi TUTTE le funzioni
      su master.db (ingest-masterdb, masterdb-playlist, read-history) morivano
      all'import nel pacchetto shippato. Spec aggiornato: collect_all su
      pyrekordbox + numpy + sqlcipher3 + sqlalchemy; build_sidecar.ps1 ora compila
      dallo .spec e non tratta lo stderr INFO di PyInstaller come errore fatale
- [ ] Export diretto Engine DJ + Serato: RIMANDATO su richiesta utente (servono
      file audio Serato-taggati reali come fixture; versione Engine target + m.db
      di riferimento + encoding blob PerformanceData)
- [x] Rinviata: cattura live SIAE reale (Rekordbox aperto/controller PRO DJ LINK)

## MAC-READINESS (richiesta utente 14/07/2026) — PRONTO, SERVE PUSH O UN MAC
- [x] Audit multi-agente (runtime darwin, CI, packaging, ricerca web verificata):
      runtime già portabile (BINARY_NAME senza .exe, kill process group unix,
      pathToLocation POSIX, NFC, niente path hardcoded)
- [x] build_sidecar.sh ora builda dallo .spec → fix numpy portato anche su mac
- [x] build.yml riscritto: trigger anche su master; path alla root repo (il
      toplevel git È crateforge — prima tutti i path CI erano rotti); runner
      macos-13 RITIRATO da GitHub (4/12/2025) → macos-15-intel; Python 3.13
      (= venv locale validato); permissions contents:read; timeout sul job
      check; if-no-files-found: error; smoke `ping` del sidecar su mac+win
- [x] numpy pinnato in requirements.txt (2.5.0, = locale)
- [x] README: Gatekeeper aggiornato — su macOS 15 Sequoia "tasto destro→Apri"
      non funziona più per app non notarizzate → "Apri comunque" in Privacy e
      Sicurezza, o xattr -dr com.apple.quarantine
- [x] docs/BUILD-MACOS.md: guida completa (perché non si builda da Windows,
      strada A = GitHub Actions, strada B = Mac reale, avvio non firmato)
- [ ] Esecuzione build mac: richiede push su GitHub (repo senza remote) o un
      Mac fisico — non possibile da questo PC Windows
- [ ] Opzionale: icon.png 1024×1024 per icona nitida su Retina (oggi 512×512,
      valida ma morbida); firma+notarizzazione Apple per rimuovere Gatekeeper

## RIALLINEAMENTO WINDOWS POST-SESSIONE MAC (14→20/07/2026)
- [x] Merge fast-forward dei 9 commit dal Mac (7ae9c55: Serato GEOB reader,
      beatgrid reali, convertitore X→Y con preflight, rekordboxPaths,
      preflight avvio con ensure-key, docs interop/guida utente)
- [x] Audit win-compat del merge: rekordboxPaths/preflight/nmlWriter
      (bootVolumeName) già cross-platform dalla sessione Mac
- [x] FIX Windows sidecar read-serato: _serato_volume_root gestiva solo
      /Volumes (mac) → su Windows i pfil relativi al volume producevano path
      rotti /Users/…; ora estrae il drive della cartella _Serato_ (es. D:),
      normalizza i separatori e salta $RECYCLE.BIN. Check unitari su venv
- [x] .ai-state/ rimosso dal tracking (regola: niente ai-state nel repo)
- [x] Typecheck pulito, 176/176 test verdi; sidecar Windows ricompilato dallo
      .spec (ensure-key ha scaricato la chiave al primo colpo anche su Windows)
- [x] dist Windows + smoke

## Regole inderogabili (§3) — verifica rapida a ogni checkpoint
1. Mai scrivere su originali ✔ (backup/export/quarantena: solo copie o move reversibile)
2. Backup DB+options.json prima di output importabili ✔ (eseguito per primo nel piano)
3. Doppia conferma su azioni distruttive ✔ (DangerConfirmDialog)
4. ID3 su copia con rollback — n/a in Fase 1 (nessuna scrittura ID3 presente)
5. Hash su copie/ripristini ✔ (copyWithVerify)
6. Dry-run di default ✔ (backup plan, quarantena, relocator)
7. Log completo esportabile ✔ (oplog + export txt)
