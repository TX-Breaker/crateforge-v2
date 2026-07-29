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

const api = {
  settings: {
    get: async (k) =>
      ({ theme: process.env.CF_THEME || 'dark', themeStyle: process.env.CF_STYLE || 'studio', density: 'comfortable', userMode: 'expert', locale: 'it', onboarded: process.env.CF_ONBOARDED || '1' })[k] ?? null,
    set: async () => {}
  },
  security: { setGate: async () => ({ ok: true, enabled: false }) },
  sidecar: { check: async () => ({ available: true, binaryPath: 'resources/crateforge-sidecar.exe' }), downloadKey: async () => ({ ok: true }) },
  library: {
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
    importForeign: async () => ({ ok: true, tracks: 0, playlists: 0, cues: 0, warnings: [] }),
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
  quarantine: { list: async () => [], restore: async () => ({ restored: 0, skipped: [] }) },
  shell: { showFolder: async () => ({ ok: true }) },
  report: { generate: async () => ({ rows: 0, outPath: '' }), view: async () => ({ columns: [], rows: [], totalRows: 0, sheetName: '' }) },
  exporter: { limits: async () => ({}), rekordboxXml: async () => ({ tracks: 0, playlists: 0 }), traktorNml: async () => ({ tracks: 0 }), virtualdjXml: async () => ({ tracks: 0 }) },
  relocator: { findBroken: async () => [], matchAndWrite: async () => ({ broken: 0, matched: 0, ambiguous: 0, written: 0 }) },
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
  dedup: { run: async () => ({ ok: true, groups: [], stats: {} }) },
  cues: { analyze: async () => ({ ok: true, cues: [] }), save: async () => ({}) },
  tagger: { propose: async () => ({ ok: true, proposals: [], queried: 0, skipped: 0 }), apply: async () => ({ ok: true, applied: 0 }) },
  stems: { run: async () => ({ ok: true }) },
  watcher: { start: async () => ({ added: 0 }), stop: async () => ({}), status: async () => ({ running: true, folder: 'D:/Downloads/Promos' }), scan: async () => ({ added: 0 }), onNewItems: noop },
  inbox: { list: async () => [], setStatus: async () => ({}), prepareXml: async () => ({ written: 0, excludedForIssues: 0 }) },
  planner: { playlists: async () => [{ id: 1, name: 'Peak time 130', trackCount: 42 }], analyze: async () => ({ tracks: 0, transitions: [], problems: 0, missingData: 0 }) },
  siae: { readHistory: async () => ({ ok: true }), sessions: async () => [], export: async () => ({ rows: 0, outPath: '' }) },
  setbuilder: { build: async () => ({ tracks: [], requested: 0, exhausted: false, totalDurationS: 0 }), exportXml: async () => ({ written: 0 }) },
  masterdb: { createPlaylist: async () => ({ ok: true, added: 0, missing: 0, backupDir: '' }) },
  detect: {
    djSoftware: async () => [
      { id: 'rekordbox', found: true, path: 'C:/Users/Vale/AppData/Roaming/Pioneer/rekordbox/master.db', companionPath: 'C:/Users/Vale/AppData/Roaming/Pioneer/rekordboxAgent/storage/options.json', checked: [], modifiedAt: '2026-07-28T14:02:00.000Z', kind: 'masterdb' },
      { id: 'traktor', found: true, path: 'C:/Users/Vale/Documents/Native Instruments/Traktor 4.0.2/collection.nml', checked: [], modifiedAt: '2026-07-05T10:11:00.000Z', kind: 'nml' },
      { id: 'serato', found: true, path: 'C:/Users/Vale/Music/_Serato_', checked: [], modifiedAt: null, limit: 'readOnly', kind: 'seratoDir' },
      { id: 'virtualdj', found: false, path: null, checked: [], modifiedAt: null, kind: 'vdjxml' },
      { id: 'engine', found: false, path: null, checked: [], modifiedAt: null, limit: 'external', kind: 'enginedb' }
    ]
  },
  window: { setOverlayTheme: async () => {} },
  rekordbox: {
    defaultPaths: async () => ({
      dir: 'C:/Users/Vale/AppData/Roaming/Pioneer/rekordbox',
      masterDb: 'C:/Users/Vale/AppData/Roaming/Pioneer/rekordbox/master.db',
      masterDbExists: true,
      optionsJson: 'C:/Users/Vale/AppData/Roaming/Pioneer/rekordboxAgent/storage/options.json',
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
