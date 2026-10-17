/**
 * Stub del bridge IPC per lo screenshot della UI: dati finti, nessun accesso
 * reale al disco o al database. Serve solo a far rendere il renderer fuori
 * dall'app, senza toccare il codice dell'app.
 */
const { contextBridge } = require('electron');

const TRACKS = [
  ['Norr Kollektiv', 'Backup Plan', 128, '8A', 402, 'Techno'],
  ['Halva Ström', 'Pale Circuit (Extended)', 138, '4A', 438, null],
  ['Verglas', 'Hollow Season', 126, '7A', 354, 'Deep'],
  ['Grauzone Tapes', 'Quiet Machine', 134, '9A', 365, null],
  ['Kalt Aggregat', 'Static Bloom', 139, '4B', 391, 'Techno'],
  ['Nordre Frekvens', 'Under Ice', 124, null, 312, 'Ambient'],
  ['Verglas', 'Salt Flats', 122, '11A', 288, 'Dub']
];

const rows = (n, offset = 0) =>
  Array.from({ length: n }, (_, i) => {
    const t = TRACKS[(i + offset) % TRACKS.length];
    return {
      id: i + offset + 1,
      artist: t[0],
      title: t[1],
      bpm: t[2],
      camelot: t[3],
      duration_s: t[4],
      genre: t[5],
      path: `D:/Music/Rekordbox/${t[0]} - ${t[1]}.aiff`,
      needs_review: i % 11 === 0 ? 1 : 0,
      review_reason: 'mojibake',
      acoustic_id: null
    };
  });

const noop = () => () => {};

/* Sincronizzazione automatica SPENTA, come nell'applicazione vera: il test deve
   vedere lo stato di chi installa. I partecipanti sono già scelti solo perché
   «Allinea ora» abbia qualcosa da fare. */
let autoCfg = { enabled: false, paused: false, softwares: ['rekordbox', 'traktor'], fields: ['bpm', 'musical_key'], mode: 'masterSlave', master: 'rekordbox' };
const autoStatus = { lastDecision: null, lastDecisionAt: null, lastRunAt: null, pendingClosures: [], lastReport: null };

const api = {
  settings: {
    get: async (k) =>
      ({ theme: process.env.CF_THEME || 'dark', themeStyle: process.env.CF_STYLE || 'studio', density: 'comfortable', locale: process.env.CF_LOCALE || 'it', onboarded: process.env.CF_ONBOARDED || '1', 'ui.quarantineDir': 'D:/Quarantena', 'ui.musicDir': 'D:/Music', 'ui.backupDir': 'E:/Backup' })[k] ?? null,
    set: async () => {}
  },
  security: { setGate: async () => ({ ok: true, enabled: false }) },
  /* Il registro delle versioni: la pagina Impostazioni non monta senza. */
  versions: {
    detect: async () => ({
      gate: 'standard',
      rows: [
        {
          software: 'rekordbox',
          label: 'Rekordbox',
          marker: 'collection XML (DJ_PLAYLISTS@Version)',
          status: 'ok',
          detected: '1.0.0',
          maxTested: '1.0.0',
          testedWithApp: '7.2.16',
          testedOn: '2026-07-29',
          installedApp: null,
          libraryPath: null,
          libraryFound: false,
          message: 'Rekordbox: versione 1.0.0, collaudata.',
          blocksWrite: false,
          blocksRead: false
        }
      ]
    }),
    acknowledge: async () => ({ ok: true }),
    revoke: async () => ({ ok: true }),
    setGate: async () => ({ ok: true })
  },
  /* ⚠ Questo spazio dei nomi mancava, e la sua assenza non si manifestava come
     "manca sync": si manifestava come quattordici problemi diversi. Il pannello
     di sincronizzazione chiamava `window.crateforge.sync.fields()`, il renderer
     lanciava un TypeError, l'intera app smetteva di montare, e da li' in poi
     mancavano <main>, le voci della sidebar, i pulsanti del nav e le
     scorciatoie. Chi leggeva l'elenco cercava quattordici bug dove ce n'era
     uno. Ogni volta che si aggiunge uno spazio dei nomi al preload vero, va
     aggiunto anche qui. */
  sync: {
    fields: async () => ({
      all: ['title', 'artist', 'album', 'genre', 'year', 'bpm', 'musical_key', 'rating', 'track_color'],
      defaults: ['bpm', 'musical_key', 'rating', 'track_color']
    }),
    libraryState: async () => [
      { software: 'rekordbox', tracks: 12481, lastSyncedAt: '2026-07-28 14:02:11', conflicts: 0 },
      { software: 'serato', tracks: 9820, lastSyncedAt: null, conflicts: 3 }
    ],
    conflicts: async () => [],
    resolveConflict: async () => ({ ok: true, resolved: 0 }),
    planLibrary: async () => ({
      ok: true,
      summary: { tracks: 0, touched: 0, toA: 0, toB: 0, conflicts: 0, untouched: 0 },
      skipped: 0,
      unpaired: 0,
      conflicts: []
    }),
    applyLibrary: async () => ({ ok: true, written: 0, conflicts: 0 }),
    plan: async () => ({ ok: true, tracks: 0, cues: 0 }),
    /* Spenta, come nell'applicazione vera: il test deve vedere lo stato in cui
       si trova chi installa il programma, non uno che nessuno ha mai scelto. */
    autoConfig: async () => ({ config: autoCfg, status: autoStatus }),
    autoRunNow: async () => ({
      ok: true,
      report: { source: 'rekordbox', mode: 'masterSlave', reread: ['rekordbox', 'traktor'], excluded: [], aligned: 12, conflicts: 0, written: [{ software: 'traktor', tracks: 12, missing: 0 }], notPropagated: [] }
    }),
    autoSetConfig: async (patch) => {
      autoCfg = { ...autoCfg, ...patch };
      return { config: autoCfg, status: autoStatus };
    }
  },
  sidecar: { check: async () => ({ available: true, binaryPath: 'resources/crateforge-sidecar.exe' }), downloadKey: async () => ({ ok: true }) },
  library: {
    linkIdentity: async () => ({ linked: 0, shared: 0, byRule: { path: 0, fileMatch: 0, acoustic: 0 } }),
    importSerato4: async () => ({ ok: true, tracks: 0 }),
    importDjay: async () => ({ ok: true, tracks: 0, unreadable: 0, scanned: 0, byCollection: [] }),
    importUsbLibrary: async () => ({ ok: true, tracks: 0 }),
    /* Conteggi per software: il guscio dell'applicazione li chiede all'avvio,
       e senza di essi il contesto di lavoro non si inizializza. */
    sources: async () => ({
      bySoftware: {
        rekordbox: { tracks: 12481, playlists: 184, sources: ['rekordbox'] },
        serato: { tracks: 9820, playlists: 96, sources: ['serato'] }
      },
      unified: { tracks: 12481, shared: 4200 }
    }),
    page: async (q) => ({ rows: rows(q.limit ?? 50, q.offset ?? 0), total: 12481 }),
    pageByPlaylist: async () => ({ rows: rows(20), total: 20 }),
    stats: async () => ({ tracks: 12481, playlists: 184, needsReview: 341, lastIngest: { source: 'Rekordbox master.db', finished_at: '2026-07-28 14:02:11', status: 'ok' } }),
    distribution: async () => ({
      bpm: Array.from({ length: 16 }, (_, i) => ({ bucket: 90 + i * 5, count: Math.round(400 + 2600 * Math.exp(-((i - 8) ** 2) / 6)) })),
      camelot: Array.from({ length: 24 }, (_, i) => ({ camelot: `${(i % 12) + 1}${i < 12 ? 'A' : 'B'}`, count: 200 + ((i * 137) % 700) })),
      noKey: 1032,
      firstImport: '2024-01-02',
      lastImport: '2026-07-28'
    }),
    ingestXml: async () => ({ tracks: 0, playlists: 0, cues: 0 }),
    ingestMasterdb: async () => ({ ok: true }),
    /* CF_FAIL_IMPORT=traktor fa fallire quell'import: il test dei flussi
       verifica che il benvenuto offra «Riprova» e «Salta» sulla riga. */
    importForeign: async (kind) =>
      process.env.CF_FAIL_IMPORT === kind
        ? { ok: false, message: 'collection.nml non leggibile' }
        : { ok: true, tracks: 1200, playlists: 10, cues: 0, warnings: [] },
    importSerato: async () => ({ ok: true, tracks: 0 })
  },
  health: {
    get: async () => ({
      total: 12481, missingBpm: 214, missingKey: 1032, missingGenre: 2140, missingYear: 3011,
      needsReview: 341, withoutHotCues: 1284, duplicateGroups: 42, duplicateTracks: 96,
      fingerprinted: 8210, score: 78
    })
  },
  backup: { plan: async () => ({}), execute: async () => ({}) },
  orphans: { scan: async () => ({ orphans: [], scannedFiles: 0, knownTracks: 0, reclaimableBytes: 0, scanId: 'x' }), quarantine: async () => ({ moved: 0, failed: [], quarantineDir: '' }), remove: async () => ({ deleted: 0, freedBytes: 0, failed: [] }) },
  quarantine: {
    list: async () => [
      {
        dir: 'D:/Quarantena/2026-07-28',
        entries: [
          { from: 'D:/Music/Verglas - Hollow Season (1).aiff', to: 'D:/Quarantena/2026-07-28/Verglas - Hollow Season (1).aiff', at: '2026-07-28 14:30:00', present: true, originFree: true, size: 61234567 }
        ]
      }
    ],
    restore: async () => ({ restored: 0, skipped: [] }) },
  shell: { showFolder: async () => ({ ok: true }) },
  report: { generate: async () => ({ rows: 0, outPath: '' }), view: async () => ({ columns: [], rows: [], totalRows: 0, sheetName: '' }) },
  exporter: { limits: async () => ({}), rekordboxXml: async () => ({ tracks: 0, playlists: 0 }), traktorNml: async () => ({ tracks: 0 }), virtualdjXml: async () => ({ tracks: 0 }), beatshiftPreview: async () => ({ ok: true, tracks: 0, cues: 0, shiftedCues: 0, byCase: { A: 0, B: 0, C: 0, D: 0, unknown: 0, other: 0 }, shifts: [], sameApp: 0 }),
    engineLibrary: async () => ({ ok: true, tracks: 0 }),
    seratoCues: async () => ({ ok: true, dryRun: true, files: 0, cues: 0, loops: 0 }),
    seratoCrates: async () => ({ ok: true, written: 0 }),
    serato4Crates: async () => ({ ok: true, written: 0 }),
    seratoDatabase: async () => ({ ok: true })
  },
  exportAll: async () => ({ outDir: '', results: [], skipped: [] }),
  relocator: { findBroken: async () => [{ trackId: 3, title: 'Hollow Season', artist: 'Verglas', oldPath: 'C:/Old/Music/Verglas - Hollow Season.aiff' }], matchAndWrite: async () => ({ broken: 0, matched: 0, ambiguous: 0, written: 0 }) },
  relocatorFp: { match: async () => ({ ok: true, broken: 0, matched: 0, scanned: 0 }), writeXml: async () => ({ written: 0 }) },
  oplog: {
    list: async () => [
      { id: 2841, ts: '2026-07-28 14:41:02', operation: 'backup.execute', target: '/Volumes/Backup/CrateForge', outcome: 'ok', detail: '8.447 copiati · verificati' },
      { id: 2840, ts: '2026-07-28 14:22:10', operation: 'watcher.scan', target: '~/Downloads/Promos', outcome: 'ok', detail: '7 nuovi file in coda' },
      { id: 2839, ts: '2026-07-28 14:08:55', operation: 'report.excel', target: 'Libreria_2026-07.xlsx', outcome: 'error', detail: 'file bloccato da un altro programma' },
      { id: 2838, ts: '2026-07-28 14:02:11', operation: 'library.ingest-masterdb', target: 'master.db', outcome: 'ok', detail: '12.481 brani · 184 playlist' }
    ],
    exportTxt: async () => ({})
  },
  dedup: {
    run: async () => ({
      ok: true,
      groups: [
        {
          acousticId: 'fp-1',
          tracks: [
            { id: 3, title: 'Hollow Season', artist: 'Verglas', path: 'D:/Music/Verglas - Hollow Season.aiff', filesize: 61234567 },
            { id: 33, title: 'Hollow Season', artist: 'Verglas', path: 'D:/Music/Verglas - Hollow Season.mp3', filesize: 9234567 }
          ]
        }
      ],
      stats: { fingerprinted: 2 }
    })
  },
  cues: { analyze: async () => ({ ok: true, cues: [] }), save: async () => ({}) },
  tagger: { propose: async () => ({ ok: true, proposals: [{ trackId: 2, artist: 'Halva Ström', title: 'Pale Circuit (Extended)', field: 'genre', current: null, proposed: 'Techno', source: 'MusicBrainz' }], queried: 1, skipped: 0 }), apply: async () => ({ ok: true, applied: 0 }) },
  stems: { run: async () => ({ ok: true }) },
  watcher: { start: async () => ({ added: 0 }), stop: async () => ({}), status: async () => ({ running: true, folder: 'D:/Downloads/Promos' }), scan: async () => ({ added: 0 }), onNewItems: noop },
  inbox: { list: async () => [], setStatus: async () => ({}), prepareXml: async () => ({ written: 0, excludedForIssues: 0 }) },
  planner: { playlists: async () => [{ id: 1, name: 'Peak time 130', trackCount: 42 }], analyze: async () => ({ tracks: 0, transitions: [], problems: 0, missingData: 0 }) },
  siae: { readHistory: async () => ({ ok: true }), sessions: async () => [], export: async () => ({ rows: 0, outPath: '' }) },
  setbuilder: { build: async () => ({ tracks: [], requested: 0, exhausted: false, totalDurationS: 0 }), exportXml: async () => ({ written: 0 }) },
  masterdb: { createPlaylist: async () => ({ ok: true, added: 0, missing: 0, backupDir: '' }) },
  detect: {
    djSoftware: async () => [
      { id: 'rekordbox', found: true, path: 'C:/Users/utente/AppData/Roaming/Pioneer/rekordbox/master.db', companionPath: 'C:/Users/utente/AppData/Roaming/Pioneer/rekordboxAgent/storage/options.json', checked: [], modifiedAt: '2026-07-28T14:02:00.000Z', kind: 'masterdb' },
      { id: 'traktor', found: true, path: 'C:/Users/utente/Documents/Native Instruments/Traktor 4.0.2/collection.nml', checked: [], modifiedAt: '2026-07-05T10:11:00.000Z', kind: 'nml' },
      { id: 'serato', found: true, path: 'C:/Users/utente/Music/_Serato_', checked: [], modifiedAt: null, limit: 'readOnly', kind: 'seratoDir' },
      { id: 'virtualdj', found: false, path: null, checked: [], modifiedAt: null, kind: 'vdjxml' },
      { id: 'engine', found: false, path: null, checked: [], modifiedAt: null, limit: 'external', kind: 'enginedb' }
    ]
  },
  window: { setOverlayTheme: async () => {} },
  rekordbox: {
    defaultPaths: async () => ({
      dir: 'C:/Users/utente/AppData/Roaming/Pioneer/rekordbox',
      masterDb: 'C:/Users/utente/AppData/Roaming/Pioneer/rekordbox/master.db',
      masterDbExists: true,
      optionsJson: 'C:/Users/utente/AppData/Roaming/Pioneer/rekordboxAgent/storage/options.json',
      optionsJsonExists: true
    })
  },
  preflight: {
    get: async () => ({ checkedAt: '13:58', sidecar: { available: true, runs: true }, key: { ready: true, downloaded: false }, os: { platform: 'win32', release: '10', changed: false }, ok: true }),
    rerun: async () => ({ checkedAt: '13:58', sidecar: { available: true, runs: true }, key: { ready: true, downloaded: false }, os: { platform: 'win32', release: '10', changed: false }, ok: true }),
    onUpdate: noop
  },
  dialog: { openFile: async () => null, openDirectory: async () => null, saveFile: async () => null },
  jobs: { cancel: async () => {}, onProgress: noop }
};

module.exports = { api };
if (!process.env.CF_NO_EXPOSE) contextBridge.exposeInMainWorld('crateforge', api);
