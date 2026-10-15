import { contextBridge, ipcRenderer } from 'electron';

/**
 * Bridge sicuro renderer ↔ main. Espone solo funzioni tipizzate, niente
 * accesso diretto a Node dal renderer.
 */
/** Configurazione della sincronizzazione automatica, come la vede il renderer. */
export interface AutoSyncConfigView {
  enabled: boolean;
  paused: boolean;
  softwares: string[];
  fields: string[];
  mode: 'symmetric' | 'masterSlave';
}

/**
 * Stato del guardiano. `lastDecision` porta anche il MOTIVO di un rifiuto:
 * senza, l'interfaccia potrebbe solo dire «non e' partito niente», che e'
 * proprio l'informazione inutile quando qualcosa non parte.
 */
export interface AutoSyncView {
  config: AutoSyncConfigView;
  status: {
    lastDecision:
      | { run: true; source: string; destinations: string[] }
      | { run: false; reason: string; message: string; retryAfterMs: number | null }
      | null;
    lastDecisionAt: number | null;
    lastRunAt: number | null;
    pendingClosures: { software: string; closedAt: number }[];
  };
}

const api = {
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key) as Promise<string | null>,
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value)
  },
  security: {
    // Attiva/disattiva un gate (directWrites/masterDbWrites) con conferma
    // nativa nel main. Le chiavi di gate NON passano da settings.set.
    setGate: (key: 'directWrites' | 'masterDbWrites', enable: boolean) =>
      ipcRenderer.invoke('security:setGate', key, enable) as Promise<{ ok: boolean; enabled: boolean }>
  },
  sidecar: {
    check: () => ipcRenderer.invoke('sidecar:check'),
    downloadKey: () => ipcRenderer.invoke('sidecar:downloadKey')
  },
  /**
   * Compatibilità con le versioni dei software DJ. La scrittura verso una
   * versione mai collaudata viene rifiutata dal main: qui il renderer legge lo
   * stato per mostrarlo, e può chiedere lo sblocco di una singola versione
   * (che il main conferma con un dialogo di sistema).
   */
  versions: {
    detect: () =>
      ipcRenderer.invoke('versions:detect') as Promise<{
        gate: 'standard' | 'strict';
        rows: {
          software: string;
          label: string;
          marker: string;
          status: 'ok' | 'newer' | 'unknown' | 'acknowledged';
          detected: string | null;
          maxTested: string;
          testedWithApp: string | null;
          testedOn: string;
          installedApp: string | null;
          libraryPath: string | null;
          libraryFound: boolean;
          message: string;
          blocksWrite: boolean;
          blocksRead: boolean;
        }[];
      }>,
    acknowledge: (software: string, version: string) =>
      ipcRenderer.invoke('versions:acknowledge', software, version) as Promise<{
        ok: boolean;
        version?: string;
      }>,
    revoke: (software: string) =>
      ipcRenderer.invoke('versions:revoke', software) as Promise<{ ok: boolean }>,
    setGate: (mode: 'standard' | 'strict') =>
      ipcRenderer.invoke('versions:setGate', mode) as Promise<{
        ok: boolean;
        gate: 'standard' | 'strict';
      }>
  },
  library: {
    page: (q: {
      offset: number;
      limit: number;
      search?: string;
      needsReview?: boolean;
      /* Filtri applicati dal database: applicarli nel renderer lascerebbe buchi
         nell'elenco virtualizzato e un totale che non corrisponde. */
      noKey?: boolean;
      noBpm?: boolean;
      noGenre?: boolean;
      /* Selezione fatta su un grafico della panoramica: una tonalità, oppure
         un intervallo di tempo (estremo alto escluso, come i bucket). */
      camelot?: string;
      bpmMin?: number;
      bpmMax?: number;
      /* Librerie della sessione di lavoro. Assente = vista unificata: una riga
         per brano reale, non una per software. */
      sources?: string[] | null;
    }) => ipcRenderer.invoke('library:page', q),
    pageByPlaylist: (playlistId: number, offset: number, limit: number) =>
      ipcRenderer.invoke('library:pageByPlaylist', playlistId, offset, limit),
    stats: (sources?: string[] | null) => ipcRenderer.invoke('library:stats', sources),
    /* Che cosa c'è nell'archivio, software per software: alimenta la scelta di
       inizio sessione. `unified` conta i brani reali, non le righe. */
    /* Collega i doppioni fra librerie: richiesto dall'utente, mai automatico
       sui dati già importati. */
    linkIdentity: () =>
      ipcRenderer.invoke('library:linkIdentity') as Promise<{
        linked: number;
        shared: number;
        byRule: { path: number; fileMatch: number; acoustic: number };
      }>,
    sources: () =>
      ipcRenderer.invoke('library:sources') as Promise<{
        bySoftware: Record<string, { tracks: number; playlists: number; sources: string[] }>;
        unified: { tracks: number; shared: number };
      }>,
    // Aggregati per i grafici della panoramica (istogramma BPM, copertura key).
    distribution: (sources?: string[] | null) =>
      ipcRenderer.invoke('library:distribution', sources) as Promise<{
        bpm: { bucket: number; count: number }[];
        camelot: { camelot: string; count: number }[];
        noKey: number;
        firstImport: string | null;
        lastImport: string | null;
      }>,
    ingestXml: (xmlPath: string) => ipcRenderer.invoke('library:ingestXml', xmlPath),
    ingestMasterdb: (dbPath: string, optionsPath?: string) =>
      ipcRenderer.invoke('library:ingestMasterdb', dbPath, optionsPath),
    importForeign: (kind: 'traktor' | 'virtualdj' | 'engine', path: string) =>
      ipcRenderer.invoke('library:importForeign', kind, path),
    // Serato (sperimentale): riceve la cartella "_Serato_".
    importSerato: (seratoDir: string) => ipcRenderer.invoke('library:importSerato', seratoDir),
    /* Serato DJ Pro 4: formato DIVERSO dal ≤3, non una sua variante. Senza
       argomento cerca `master.sqlite` nella posizione di sistema. */
    importSerato4: (masterPath?: string) =>
      ipcRenderer.invoke('library:importSerato4', masterPath) as Promise<{
        ok: boolean;
        tracks?: number;
        playlists?: number;
        cues?: number;
        warnings?: string[];
        message?: string;
      }>,
    /* djay Pro: senza argomento cerca MediaLibrary.db nella posizione di
       sistema. Sperimentale — `unreadable` dice quante righe non sono state
       decifrate, ed è il numero da guardare. */
    importDjay: (dbPath?: string) =>
      ipcRenderer.invoke('library:importDjay', dbPath) as Promise<{
        ok: boolean;
        tracks?: number;
        playlists?: number;
        unreadable?: number;
        scanned?: number;
        warnings?: string[];
        message?: string;
      }>,
    /* Chiavetta Pioneer: riceve la RADICE dell'unità (es. "E:\"), non la
       cartella PIONEER. Il database è cifrato con una chiave diversa da quella
       del master.db desktop. */
    importUsbLibrary: (usbRoot: string) =>
      ipcRenderer.invoke('library:importUsbLibrary', usbRoot) as Promise<{
        ok: boolean;
        tracks?: number;
        device?: string;
        warnings?: string[];
        message?: string;
      }>
  },
  /**
   * Sincronizzazione dei punti fra librerie. `plan` non scrive niente: conta.
   * La scrittura passa dagli export già esistenti, che ricevono `sync` nella
   * selezione e risolvono i conflitti con la stessa regola.
   */
  sync: {
    /* Sincronizzazione dei METADATI fra librerie. Tocca solo l'archivio
       interno: la propagazione verso i software DJ passa dagli export. */
    planLibrary: (opts: {
      aSources: string[];
      bSources: string[];
      mode: 'symmetric' | 'masterSlave';
      fields?: string[];
      temporalFields?: string[];
    }) =>
      ipcRenderer.invoke('sync:planLibrary', opts) as Promise<{
        ok: boolean;
        summary?: {
          tracks: number;
          touched: number;
          toA: number;
          toB: number;
          conflicts: number;
          untouched: number;
        };
        skipped?: number;
        unpaired?: number;
        conflicts?: {
          canonicalId: number;
          aSoftware: string;
          bSoftware: string;
          fields: { field: string; aValue: string | null; bValue: string | null; reason: string }[];
        }[];
        message?: string;
      }>,
    applyLibrary: (opts: {
      aSources: string[];
      bSources: string[];
      mode: 'symmetric' | 'masterSlave';
      fields?: string[];
      temporalFields?: string[];
    }) =>
      ipcRenderer.invoke('sync:applyLibrary', opts) as Promise<{
        ok: boolean;
        written?: number;
        fieldsToA?: number;
        fieldsToB?: number;
        conflicts?: number;
        message?: string;
      }>,
    conflicts: (limit?: number) =>
      ipcRenderer.invoke('sync:conflicts', limit) as Promise<
        {
          id: number;
          canonicalId: number;
          field: string;
          aSoftware: string;
          aValue: string | null;
          bSoftware: string;
          bValue: string | null;
          title: string | null;
          artist: string | null;
        }[]
      >,
    /* `scope: 'field'` applica la stessa scelta a tutti i conflitti aperti su
       quel campo: e' il modo in cui si presentano davvero. */
    resolveConflict: (id: number, choice: 'a' | 'b' | 'skip', scope?: 'one' | 'field') =>
      ipcRenderer.invoke('sync:resolveConflict', id, choice, scope) as Promise<{
        ok: boolean;
        resolved?: number;
        message?: string;
      }>,
    libraryState: () =>
      ipcRenderer.invoke('sync:libraryState') as Promise<
        { software: string; tracks: number; lastSyncedAt: string | null; conflicts: number }[]
      >,
    fields: () =>
      ipcRenderer.invoke('sync:fields') as Promise<{ all: string[]; defaults: string[] }>,
    autoConfig: () =>
      ipcRenderer.invoke('sync:autoConfig') as Promise<AutoSyncView>,
    autoSetConfig: (patch: Partial<AutoSyncConfigView>) =>
      ipcRenderer.invoke('sync:autoSetConfig', patch) as Promise<AutoSyncView>,
    plan: (opts: {
      originSources: string[];
      destinationSources: string[];
      destination: string;
      mode: 'fill' | 'overwrite';
    }) =>
      ipcRenderer.invoke('sync:plan', opts) as Promise<{
        tracks: number;
        filled: number;
        replaced: number;
        demoted: number;
        lost: number;
        destroys: boolean;
      }>
  },
  /**
   * Un export per ogni software trovato su questo computer, nella stessa
   * cartella. Engine e Serato restano fuori e il perché torna in `skipped`.
   */
  exportAll: (
    outDir: string,
    opts?: {
      source?: string;
      sync?: { originSources: string[]; mode: 'fill' | 'overwrite' };
      beatshift?: boolean;
    }
  ) =>
    ipcRenderer.invoke('export:allDetected', outDir, opts) as Promise<{
      outDir: string;
      results: {
        id: string;
        ok: boolean;
        path?: string;
        tracks?: number;
        warnings?: string[];
        message?: string;
      }[];
      skipped: { id: string; reason: string }[];
    }>,
  backup: {
    plan: (opts: unknown) => ipcRenderer.invoke('backup:plan', opts),
    execute: (planId: string) => ipcRenderer.invoke('backup:execute', planId)
  },
  orphans: {
    scan: (musicDir: string) => ipcRenderer.invoke('orphans:scan', musicDir),
    quarantine: (files: string[], root: string, dryRun: boolean) =>
      ipcRenderer.invoke('orphans:quarantine', files, root, dryRun),
    remove: (scanId: string, files: string[], dryRun: boolean) =>
      ipcRenderer.invoke('orphans:delete', scanId, files, dryRun)
  },
  // Quarantena: elenco e ripristino (l'annulla della pulizia).
  quarantine: {
    list: (quarantineRoot: string) =>
      ipcRenderer.invoke('quarantine:list', quarantineRoot) as Promise<
        {
          dir: string;
          entries: {
            from: string;
            to: string;
            at: string;
            present: boolean;
            originFree: boolean;
            size: number | null;
          }[];
        }[]
      >,
    restore: (quarantineDir: string, files: string[], dryRun: boolean) =>
      ipcRenderer.invoke('quarantine:restore', quarantineDir, files, dryRun) as Promise<{
        restored: number;
        skipped: { path: string; reason: string }[];
      }>
  },
  shell: {
    showFolder: (dirPath: string) =>
      ipcRenderer.invoke('shell:showFolder', dirPath) as Promise<{ ok: boolean }>
  },
  report: {
    generate: (opts: unknown) => ipcRenderer.invoke('report:generate', opts),
    view: (filePath: string, offset: number, limit: number) =>
      ipcRenderer.invoke('report:view', filePath, offset, limit)
  },
  exporter: {
    limits: () => ipcRenderer.invoke('export:limits'),
    rekordboxXml: (outPath: string, sel?: unknown) =>
      ipcRenderer.invoke('export:rekordboxXml', outPath, sel),
    traktorNml: (outPath: string, sel?: unknown) =>
      ipcRenderer.invoke('export:traktorNml', outPath, sel),
    virtualdjXml: (outPath: string, sel?: unknown) =>
      ipcRenderer.invoke('export:virtualdjXml', outPath, sel),
    // Engine DJ: genera una libreria NUOVA nella cartella scelta (non tocca
    // quella esistente). Serve un m.db come modello dello schema.
    engineLibrary: (outDir: string, templateDbPath: string, sel?: { playlistIds?: number[] }) =>
      ipcRenderer.invoke('export:engineLibrary', outDir, templateDbPath, sel) as Promise<{
        ok: boolean;
        tracks?: number;
        cues?: number;
        loops?: number;
        playlists?: number;
        dbPath?: string;
        warnings?: string[];
        message?: string;
      }>,
    // Serato: i cue vivono nei tag dei file audio, non in un file di libreria.
    // Richiede il gate delle scritture dirette; backup+rollback nel sidecar.
    /* `dryRun` conta i file che verrebbero modificati senza toccarne nessuno:
       il numero va mostrato nella conferma PRIMA di scrivere sugli originali.
       `source` limita la scrittura ai brani di quella sorgente — senza, una
       conversione riscriverebbe i tag di tutta la libreria. */
    /** Anteprima della correzione dello scarto fra decoder MP3: non scrive niente. */
    beatshiftPreview: (target: string, sel?: { source?: string; playlistIds?: number[] }) =>
      ipcRenderer.invoke('export:beatshiftPreview', target, sel) as Promise<{
        ok: boolean;
        message?: string;
        target?: string;
        tracks?: number;
        cues?: number;
        shiftedCues?: number;
        byCase?: Record<'A' | 'B' | 'C' | 'D' | 'unknown' | 'other', number>;
        shifts?: { ms: number; cues: number }[];
        sameApp?: number;
      }>,
    seratoCues: (sel?: {
      playlistIds?: number[];
      source?: string;
      dryRun?: boolean;
      beatshift?: boolean;
    }) =>
      ipcRenderer.invoke('export:seratoCues', sel) as Promise<{
        ok: boolean;
        dryRun?: boolean;
        written?: number;
        failed?: number;
        files?: number;
        cues?: number;
        loops?: number;
        backupDir?: string;
        message?: string;
      }>,
    // Playlist Serato: file .crate in Subcrates. Non sovrascrive mai crate
    // esistenti (il formato non ha ancora un round-trip verificato).
    seratoCrates: (seratoDir: string, sel?: { playlistIds?: number[] }) =>
      ipcRenderer.invoke('export:seratoCrates', seratoDir, sel) as Promise<{
        ok: boolean;
        written?: number;
        skipped?: string[];
        message?: string;
      }>,
    /* Crate in Serato DJ Pro 4. Non tocca le tabelle di cache: accoda gli id
       nelle code di invalidazione e lascia ricostruire a Serato. Lega solo
       brani che Serato ha gia' in libreria; gli altri tornano in notInLibrary. */
    serato4Crates: (masterPath?: string, sel?: { playlistIds?: number[] }) =>
      ipcRenderer.invoke('export:serato4Crates', masterPath, sel) as Promise<{
        ok: boolean;
        created?: number;
        linked?: number;
        skipped?: string[];
        notInLibrary?: string[];
        invalidated?: string[];
        backupDir?: string;
        message?: string;
      }>,
    // Metadati dentro `database V2`: aggiorna i record dei brani conosciuti e
    // lascia intatto tutto il resto, brani estranei compresi.
    seratoDatabase: (seratoDir: string, sel?: { playlistIds?: number[]; source?: string }) =>
      ipcRenderer.invoke('export:seratoDatabase', seratoDir, sel) as Promise<{
        ok: boolean;
        updated?: number;
        unchanged?: number;
        preserved?: number;
        notInDatabase?: number;
        backupDir?: string;
        message?: string;
      }>
  },
  relocator: {
    findBroken: () => ipcRenderer.invoke('relocator:findBroken'),
    matchAndWrite: (newRoot: string, outPath: string | null) =>
      ipcRenderer.invoke('relocator:matchAndWrite', newRoot, outPath)
  },
  oplog: {
    list: (limit?: number) => ipcRenderer.invoke('oplog:list', limit),
    exportTxt: (outPath: string) => ipcRenderer.invoke('oplog:export', outPath)
  },
  // Fase 2 — funzioni sperimentali (modalità Esperto)
  dedup: {
    run: () => ipcRenderer.invoke('dedup:run')
  },
  relocatorFp: {
    match: (newRoot: string) => ipcRenderer.invoke('relocator:fingerprintMatch', newRoot),
    writeXml: (outPath: string) => ipcRenderer.invoke('relocator:writeFingerprintXml', outPath)
  },
  cues: {
    analyze: (trackId: number) => ipcRenderer.invoke('cues:analyze', trackId),
    save: (
      trackId: number,
      cues: { label: string; positionMs: number; color: string | null }[]
    ) => ipcRenderer.invoke('cues:save', trackId, cues)
  },
  tagger: {
    propose: (limit?: number, provider?: 'musicbrainz' | 'discogs') =>
      ipcRenderer.invoke('tagger:propose', limit, provider),
    apply: (proposals: unknown[], target?: 'udm' | 'original') =>
      ipcRenderer.invoke('tagger:apply', proposals, target)
  },
  stems: {
    run: (trackId: number, outDir: string) => ipcRenderer.invoke('stems:run', trackId, outDir)
  },
  // Fase 3 — power user (modalità Esperto)
  watcher: {
    start: (folder: string) => ipcRenderer.invoke('watcher:start', folder),
    stop: () => ipcRenderer.invoke('watcher:stop'),
    status: () => ipcRenderer.invoke('watcher:status'),
    scan: (folder: string) => ipcRenderer.invoke('watcher:scan', folder),
    onNewItems: (cb: (p: { added: number }) => void) => {
      const listener = (_e: unknown, payload: { added: number }) => cb(payload);
      ipcRenderer.on('inbox:new-items', listener);
      return () => {
        ipcRenderer.removeListener('inbox:new-items', listener);
      };
    }
  },
  inbox: {
    list: (status?: 'new' | 'prepared' | 'dismissed') => ipcRenderer.invoke('inbox:list', status),
    setStatus: (ids: number[], status: 'new' | 'prepared' | 'dismissed') =>
      ipcRenderer.invoke('inbox:setStatus', ids, status),
    prepareXml: (ids: number[], outPath: string) =>
      ipcRenderer.invoke('inbox:prepareXml', ids, outPath)
  },
  planner: {
    playlists: () => ipcRenderer.invoke('planner:playlists'),
    analyze: (playlistId: number) => ipcRenderer.invoke('planner:analyze', playlistId)
  },
  siae: {
    readHistory: (masterDbPath: string) => ipcRenderer.invoke('siae:readHistory', masterDbPath),
    sessions: () => ipcRenderer.invoke('siae:sessions'),
    /**
     * `fromTime`/`toTime` sono la fascia della serata (`21:00` → `06:00`, che
     * passa la mezzanotte); `sampleUnderS` la durata sotto cui un brano è un
     * sample e non entra nell'elenco. I conteggi delle esclusioni tornano col
     * risultato: vanno mostrati, non nascosti.
     */
    export: (opts: {
      sessionId: string;
      outPath: string;
      venue?: string;
      eventDate?: string;
      fromTime?: string;
      toTime?: string;
      sampleUnderS?: number;
    }) =>
      ipcRenderer.invoke('siae:export', opts) as Promise<{
        rows: number;
        outPath: string;
        outOfWindow: number;
        samples: number;
        unknownTime: number;
      }>
  },
  health: {
    /* `sources` = librerie della sessione di lavoro; assente = vista unificata,
       dove ogni brano reale conta una volta sola. */
    get: (sources?: string[] | null) => ipcRenderer.invoke('health:get', sources)
  },
  setbuilder: {
    build: (startTrackId: number, length: number, curve: 'up' | 'flat' | 'down') =>
      ipcRenderer.invoke('setbuilder:build', startTrackId, length, curve),
    exportXml: (trackIds: number[], playlistName: string, outPath: string) =>
      ipcRenderer.invoke('setbuilder:exportXml', trackIds, playlistName, outPath)
  },
  masterdb: {
    createPlaylist: (
      trackIds: number[],
      playlistName: string,
      masterDbPath: string,
      optionsJsonPath: string | null
    ) =>
      ipcRenderer.invoke('masterdb:createPlaylist', trackIds, playlistName, masterDbPath, optionsJsonPath)
  },
  dialog: {
    // defaultPath (opzionale) pre-punta il dialog su un file/cartella: usato per
    // aprire di default il master.db di Rekordbox dell'utente.
    openFile: (filters?: { name: string; extensions: string[] }[], defaultPath?: string) =>
      ipcRenderer.invoke('dialog:openFile', filters, defaultPath),
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    saveFile: (defaultName: string, filters?: { name: string; extensions: string[] }[]) =>
      ipcRenderer.invoke('dialog:saveFile', defaultName, filters)
  },
  // Rilevamento delle installazioni DJ presenti sulla macchina (primo avvio).
  // Solo lettura di percorsi: nessun file viene aperto lato main.
  detect: {
    djSoftware: () =>
      ipcRenderer.invoke('detect:djSoftware') as Promise<
        {
          id: 'rekordbox' | 'traktor' | 'virtualdj' | 'serato' | 'engine';
          found: boolean;
          path: string | null;
          companionPath?: string | null;
          checked: string[];
          modifiedAt: string | null;
          limit?: 'readOnly' | 'external';
          kind: 'masterdb' | 'nml' | 'vdjxml' | 'seratoDir' | 'enginedb';
        }[]
      >
  },
  // Chrome della finestra: su Windows i pulsanti di sistema sono disegnati
  // dall'OS (Window Controls Overlay), quindi al cambio tema va aggiornato solo
  // il colore della striscia.
  window: {
    setOverlayTheme: (color: string, symbolColor: string) =>
      ipcRenderer.invoke('window:setOverlayTheme', color, symbolColor) as Promise<void>
  },
  // Percorsi di default dell'installazione Rekordbox dell'utente corrente.
  rekordbox: {
    defaultPaths: () =>
      ipcRenderer.invoke('rekordbox:defaultPaths') as Promise<{
        dir: string;
        masterDb: string;
        masterDbExists: boolean;
        optionsJson: string;
        optionsJsonExists: boolean;
      }>
  },
  // Preflight all'avvio: sidecar eseguibile + chiave di lettura pronta.
  preflight: {
    get: () => ipcRenderer.invoke('preflight:get'),
    rerun: () => ipcRenderer.invoke('preflight:rerun'),
    onUpdate: (cb: (state: unknown) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, state: unknown) => cb(state);
      ipcRenderer.on('preflight:update', listener);
      return () => {
        ipcRenderer.removeListener('preflight:update', listener);
      };
    }
  },
  jobs: {
    cancel: () => ipcRenderer.invoke('job:cancel'),
    onProgress: (
      cb: (p: { jobId: string; phase: string; done: number; total: number }) => void
    ) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: { jobId: string; phase: string; done: number; total: number }
      ) => cb(payload);
      ipcRenderer.on('job:progress', listener);
      return () => {
        ipcRenderer.removeListener('job:progress', listener);
      };
    }
  }
};

export type CrateForgeApi = typeof api;

contextBridge.exposeInMainWorld('crateforge', api);
