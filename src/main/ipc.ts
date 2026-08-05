import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  scopeClause,
  getLibraryDistribution,
  getPlaylistTracksPage,
  getSetting,
  getTracksPage,
  logOperation,
  setSetting
} from '@core/udm';
import { ingestCollectionXml } from '@core/xmlCollection';
import { importForeignLibrary } from '@core/foreignImport';
import { linkCanonicalTracks } from '@core/identity';
import { planSync } from '@core/sync';
import { readTraktorNml } from '@adapters/traktor/nmlReader';
import { readVirtualDjXml } from '@adapters/virtualdj/vdjReader';
import { readEngineLibrary } from '@adapters/engine/engineReader';
import { executeBackup, planBackup, BackupOptions, BackupPlan } from '@services/backup/incrementalBackup';
import {
  deleteOrphans,
  findOrphans,
  listQuarantine,
  quarantineOrphans,
  restoreFromQuarantine
} from '@services/orphans/orphanFinder';
import { generateExcelReport } from '@services/excel/reportGenerator';
import { clearReportCache, readReportPage } from '@services/excel/reportViewer';
import { findBrokenTracks, matchByFilename, RelocationMatch } from '@services/relocator/relocator';
import { writeRekordboxXml } from '@adapters/rekordbox/xmlWriter';
import { writeRelocationXml } from '@adapters/rekordbox/relocationXml';
import { writeTraktorNml } from '@adapters/traktor/nmlWriter';
import { writeVirtualDjXml } from '@adapters/virtualdj/vdjWriter';
import { writeEngineLibrary } from '@adapters/engine/engineWriter';
import { REKORDBOX_XML_LIMITS } from '@adapters/common';
import { SERATO_STATUS } from '@adapters/serato';
import { ENGINE_STATUS } from '@adapters/engine';
import { applyProposals, proposeTags, TagProposal, TagProvider } from '@services/tagger/autoTagger';
import { app } from 'electron';
import { join, basename } from 'path';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync, rmSync } from 'fs';

/**
 * Scrive un payload JSON in un file temporaneo e lo passa al sidecar via
 * `--…-file`, evitando il limite della command line di Windows (~32 KB) sui
 * batch grandi (write-tags, masterdb). Il file va rimosso dopo.
 */
function writeTempJson(name: string, data: unknown): string {
  const dir = join(app.getPath('userData'), 'tmp');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${name}-${randomUUID()}.json`);
  writeFileSync(p, JSON.stringify(data), 'utf-8');
  return p;
}
import { listInbox, setInboxStatus, SyncDaemon } from '@services/watcher/syncDaemon';
import { analyzePlaylist, listPlaylists } from '@services/planner/setPlanner';
import { buildSet, BpmCurve } from '@services/setbuilder/setBuilder';
import { computeHealth } from '@core/health';
import { exportSiaeReport, listHistorySessions } from '@services/siae/siaeReport';
import { writeInboxXml } from '@adapters/rekordbox/inboxXml';
import { writeSetXml } from '@adapters/rekordbox/setXml';
import type { TrackRow } from '@core/udm';
import { ThrottledProgress } from './progress';
import { hashFile } from '@services/fsutil';
import { networkPathWarning } from './networkPath';
import {
  acknowledgeKey,
  appAcknowledgeKey,
  evaluateAppVersion,
  evaluateVersion,
  TESTED,
  type DjSoftware,
  type VersionVerdict
} from '@core/djVersions';
import { probeRekordboxApp, probeVersion } from './versionProbe';
import { checkSidecar, runSidecar, SidecarEvent } from './sidecar';
import { rekordboxDefaultPaths } from './rekordboxPaths';
import { detectDjSoftware } from './djSoftwarePaths';
import { getLastPreflight, runPreflight } from './preflight';

/**
 * Registrazione handler IPC. Regole:
 *  - mai bulk data attraverso il bridge: la UI riceve pagine, non librerie;
 *  - progressi SEMPRE via ThrottledProgress (§2);
 *  - un solo job di ingestion alla volta (serializza i writer sull'UDM).
 */
/**
 * Comandi del sidecar che entrano DENTRO i file dell'utente. Mentre uno di
 * questi è in corso l'applicazione non può essere chiusa: terminare il
 * processo salterebbe il ripristino, che nel sidecar è un blocco `except`.
 */
const WRITE_COMMANDS = new Set([
  'write-tags',
  'write-serato-cues',
  'write-serato-crates',
  'masterdb-create-playlist'
]);
let writeJobsInFlight = 0;

/** true se una scrittura sui file dell'utente è in corso in questo momento. */
export function isWriteJobRunning(): boolean {
  return writeJobsInFlight > 0;
}

export function registerIpc(db: BetterSqlite3.Database, udmPath: string): () => void {
  let currentCancel: (() => void) | null = null;

  // Coda job unica: TUTTO ciò che scrive l'UDM o spawna il sidecar viene
  // serializzato. Node (better-sqlite3) e Python non scrivono mai l'UDM in
  // concorrenza, e con un solo job attivo alla volta currentCancel non ha race.
  let anyJobRunning = false;
  let jobChain: Promise<unknown> = Promise.resolve();
  const withJobLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = jobChain.then(async () => {
      anyJobRunning = true;
      try {
        return await fn();
      } finally {
        anyJobRunning = false;
      }
    });
    // Il chain non deve mai rifiutare, altrimenti blocca i job successivi.
    jobChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  // Piani di backup tenuti nel main: al renderer va solo il riepilogo (§2, no bulk data su IPC).
  const backupPlans = new Map<string, { plan: BackupPlan; opts: BackupOptions }>();
  // Risultati di scansione orfani tenuti nel main: l'eliminazione può agire solo
  // sui path effettivamente trovati da una scansione, non su path arbitrari
  // decisi dal renderer (difesa in profondità sull'azione distruttiva).
  const orphanScans = new Map<string, Set<string>>();

  // Preferisce la finestra a fuoco, poi la prima disponibile; mai undefined
  // dereferenziato: i call-site usano win()?.webContents (ThrottledProgress
  // tollera undefined) e per i dialog c'è dialogParent().
  const win = (): BrowserWindow | undefined =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const wc = (): BrowserWindow['webContents'] | undefined => win()?.webContents;

  /**
   * Ricollega l'identità canonica delle tracce dopo un import.
   *
   * Va fatto QUI e non dentro i singoli lettori perché le righe nuove arrivano
   * da quattro strade diverse (XML, master.db via sidecar, altri software,
   * Serato) e la regola di identità deve essere una sola. È idempotente: se non
   * è cambiato niente non tocca niente.
   */
  const relinkIdentity = (origine: string): void => {
    try {
      const r = linkCanonicalTracks(db);
      if (r.linked > 0) {
        logOperation(
          db,
          'identity.link',
          origine,
          'ok',
          `${r.linked} righe collegate a un brano già presente ` +
            `(percorso ${r.byRule.path}, file ${r.byRule.fileMatch}, impronta ${r.byRule.acoustic}); ` +
            `${r.shared} brani presenti in più software`
        );
      }
    } catch (err) {
      // Un'identità non ricalcolata non invalida l'import appena riuscito:
      // le righe restano ognuna il proprio canonico, cioè lo stato di prima.
      logOperation(db, 'identity.link', origine, 'error', String(err));
    }
  };

  // Chiavi di sicurezza che NON possono essere scritte dal canale generico:
  // sono i gate delle scritture (§3), altrimenti un renderer compromesso le
  // attiverebbe da solo via settings:set e poi eseguirebbe azioni distruttive.
  const GATE_KEYS = new Set(['directWrites', 'masterDbWrites', 'versionGate']);

  /**
   * Chiave protetta: oltre ai gate espliciti, anche gli SBLOCCHI di versione
   * (`versionAck.*`, `versionAckApp.*`). Erano rimasti fuori dall'elenco, e
   * questo rendeva il blocco delle versioni aggirabile in una riga dal
   * renderer: scrivere `versionAck.engine = 99` e la scrittura verso una
   * versione mai collaudata sarebbe passata. Lo sblocco deve restare
   * possibile solo dal canale dedicato, che chiede conferma nel processo
   * principale con un dialogo di sistema.
   */
  const isGuardedKey = (key: string): boolean =>
    GATE_KEYS.has(key) || /^versionAck(App)?\./.test(key);

  // ---- settings / stato ----
  ipcMain.handle('settings:get', (_e, key: string) => getSetting(db, key));
  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    if (isGuardedKey(key)) {
      throw new Error(`Il setting "${key}" non è modificabile da questo canale.`);
    }
    return setSetting(db, key, value);
  });

  // Attivazione/disattivazione dei gate: canale dedicato con conferma NATIVA
  // nel main (dialog non falsificabile dal renderer) prima di scrivere.
  ipcMain.handle('security:setGate', async (e, key: string, enable: boolean) => {
    if (!GATE_KEYS.has(key)) throw new Error('Chiave di gate non riconosciuta.');
    if (enable) {
      const parent = BrowserWindow.fromWebContents(e.sender) ?? win();
      const opts = {
        type: 'warning' as const,
        buttons: ['Annulla', 'Attiva'],
        defaultId: 0,
        cancelId: 0,
        title: 'Conferma attivazione',
        message:
          key === 'masterDbWrites'
            ? 'Attivare la scrittura DIRETTA nel database di Rekordbox? Chiudi Rekordbox prima di usarla.'
            : 'Attivare le scritture dirette sui file originali (eliminazione orfani, tag ID3)?'
      };
      const r = parent
        ? await dialog.showMessageBox(parent, opts)
        : await dialog.showMessageBox(opts);
      if (r.response !== 1) return { ok: false, enabled: getSetting(db, key) === '1' };
    }
    setSetting(db, key, enable ? '1' : '0');
    logOperation(db, 'security.gate', key, 'ok', enable ? 'attivato' : 'disattivato');
    return { ok: true, enabled: enable };
  });
  ipcMain.handle('sidecar:check', () => checkSidecar());

  /* ------------------------------------------------- compatibilità versioni
   * I formati di libreria non sono documentati: quello che CrateForge sa
   * scrivere è stato ricavato guardando i byte di una versione precisa. Su una
   * versione più recente la scrittura non fallirebbe con un errore — produrrebbe
   * una libreria danneggiata. Perciò la scrittura verso una versione non
   * collaudata viene RIFIUTATA, mentre la lettura resta possibile (leggere non
   * può rovinare nulla) salvo che l'utente scelga la modalità severa.
   */
  const versionGate = (): 'standard' | 'strict' =>
    getSetting(db, 'versionGate') === 'strict' ? 'strict' : 'standard';

  /**
   * Il marcatore da leggere dipende da COSA si sta guardando, non solo da quale
   * software è.
   *
   * Il caso che rompeva tutto: per Rekordbox il documento dichiara come
   * marcatore `DJ_PLAYLISTS@Version`, che sta nel collection XML. Ma la
   * sorgente rilevata sulla maggior parte delle macchine è `master.db`, che è
   * uno SQLite CIFRATO: cercarci dentro un attributo XML non fallisce, dà
   * semplicemente `null` per sempre. Risultato: "versione non rilevata" e
   * scritture sospese su un'installazione perfettamente collaudata.
   *
   * Su master.db l'unico dato onesto è quale rekordbox è installato su questa
   * macchina — che è esattamente ciò per cui esiste `evaluateAppVersion`.
   */
  const isEncryptedRekordboxDb = (software: DjSoftware, path: string): boolean =>
    software === 'rekordbox' && /\.db$/i.test(path);

  const checkVersion = (software: DjSoftware, path: string): VersionVerdict => {
    if (isEncryptedRekordboxDb(software, path)) {
      return evaluateAppVersion('rekordbox', probeRekordboxApp(), {
        acknowledged: getSetting(db, appAcknowledgeKey('rekordbox')),
        gate: versionGate()
      });
    }
    return evaluateVersion(software, probeVersion(software, path), {
      acknowledged: getSetting(db, acknowledgeKey(software)),
      gate: versionGate()
    });
  };

  /**
   * Da chiamare PRIMA di ogni scrittura verso la libreria di un software DJ.
   * Solleva se la versione non è collaudata: meglio un'operazione che non parte
   * di una libreria da ricostruire a mano.
   */
  const assertWritable = (software: DjSoftware, path: string): VersionVerdict => {
    const v = checkVersion(software, path);
    if (v.blocksWrite) {
      logOperation(db, 'version.block', path, 'error', `${software}=${v.detected ?? 'n/d'} ${v.status}`);
      throw new Error(v.message);
    }
    if (v.status === 'acknowledged') {
      logOperation(db, 'version.acknowledged', path, 'skipped', `${software}=${v.detected}`);
    }
    return v;
  };

  /** Verdetto in lettura: blocca solo in modalità severa, altrimenti avvisa. */
  const checkReadable = (software: DjSoftware, path: string): VersionVerdict => {
    const v = checkVersion(software, path);
    if (v.blocksRead) {
      logOperation(db, 'version.block', path, 'error', `${software}=${v.detected ?? 'n/d'} lettura`);
      throw new Error(v.message);
    }
    return v;
  };

  /** Quadro completo per l'interfaccia: cosa è collaudato, cosa no. */
  ipcMain.handle('versions:detect', () => {
    const found = detectDjSoftware();
    const rows = (Object.keys(TESTED) as DjSoftware[]).map((software) => {
      const det = found.find((f) => f.id === software);
      const path = det?.found && det.path ? det.path : null;
      const onEncryptedDb = path !== null && isEncryptedRekordboxDb(software, path);
      const v = path ? checkVersion(software, path) : null;
      return {
        ...(v ??
          evaluateVersion(software, null, {
            acknowledged: getSetting(db, acknowledgeKey(software)),
            gate: versionGate()
          })),
        label: TESTED[software].label,
        /* Il marcatore dichiarato NON è sempre quello effettivamente letto:
           su master.db si guarda la versione dell'applicazione. La riga lo
           dice, altrimenti l'utente legge un numero e crede sia un altro. */
        marker: onEncryptedDb
          ? 'versione di rekordbox installata (master.db è cifrato)'
          : TESTED[software].marker,
        testedWithApp: TESTED[software].testedWithApp,
        testedOn: TESTED[software].testedOn,
        // Versione dell'APP installata: informativa quando il verdetto viene
        // dal formato, normativa quando il formato non è ispezionabile.
        installedApp: det?.app.version ?? (software === 'rekordbox' ? probeRekordboxApp() : null),
        appInstalled: det?.app.installed ?? false,
        libraryPath: path,
        libraryFound: det?.found ?? false
      };
    });
    return { gate: versionGate(), rows };
  });

  /**
   * Sblocco manuale di UNA versione di UN software: è la porta prevista per
   * l'autore quando ha collaudato una versione nuova, o per un utente esperto
   * che accetta il rischio con cognizione di causa. Conferma nativa nel main
   * (non falsificabile dal renderer) e traccia nel registro operazioni.
   */
  ipcMain.handle('versions:acknowledge', async (e, software: DjSoftware, version: string) => {
    if (!TESTED[software]) throw new Error('Software non riconosciuto.');
    if (!/^\d+(?:\.\d+)*$/.test(version)) throw new Error('Versione non valida.');
    const parent = BrowserWindow.fromWebContents(e.sender) ?? win();
    const opts = {
      type: 'warning' as const,
      buttons: ['Annulla', 'Sblocca'],
      defaultId: 0,
      cancelId: 0,
      title: 'Versione non collaudata',
      message:
        `Sbloccare la scrittura verso ${TESTED[software].label} ${version}?\n\n` +
        `L'ultima versione collaudata è la ${TESTED[software].maxTested}. Il formato di ` +
        `questa versione non è stato verificato: se è cambiato, la scrittura può ` +
        `danneggiare la libreria senza segnalare nulla. Sbloccalo solo se hai provato ` +
        `tu stesso che i dati tornano indietro identici.`
    };
    const r = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    if (r.response !== 1) return { ok: false };
    setSetting(db, acknowledgeKey(software), version);
    logOperation(db, 'version.unlock', software, 'ok', `sbloccata fino alla ${version}`);
    return { ok: true, version };
  });

  /** Revoca dello sblocco: si torna al comportamento prudente. */
  ipcMain.handle('versions:revoke', (_e, software: DjSoftware) => {
    if (!TESTED[software]) throw new Error('Software non riconosciuto.');
    setSetting(db, acknowledgeKey(software), '');
    logOperation(db, 'version.unlock', software, 'ok', 'sblocco revocato');
    return { ok: true };
  });

  /** Modalità del gate: severa = blocca anche la lettura. */
  ipcMain.handle('versions:setGate', (_e, mode: 'standard' | 'strict') => {
    const value = mode === 'strict' ? 'strict' : 'standard';
    setSetting(db, 'versionGate', value);
    logOperation(db, 'version.gate', null, 'ok', value);
    return { ok: true, gate: value };
  });

  // Percorsi di default dell'installazione Rekordbox dell'utente (per pre-puntare
  // il file picker del master.db e rilevarlo automaticamente sulla sua macchina).
  ipcMain.handle('rekordbox:defaultPaths', () => rekordboxDefaultPaths());

  // Rilevamento di TUTTI i software DJ supportati (primo avvio §6.1). Solo
  // percorsi verificati su disco: nessun rilevamento dichiarato senza prova.
  // Guarda e basta — nessun file viene aperto qui.
  ipcMain.handle('detect:djSoftware', () => detectDjSoftware());

  // Colore della striscia dei pulsanti di sistema su Windows: segue il tema
  // scelto nel renderer. Accetta solo colori esadecimali, così una stringa
  // arbitraria non arriva mai all'API nativa.
  ipcMain.handle('window:setOverlayTheme', (_e, color: string, symbolColor: string) => {
    if (process.platform !== 'win32') return;
    const hex = /^#[0-9a-fA-F]{6}$/;
    if (!hex.test(color) || !hex.test(symbolColor)) return;
    try {
      win()?.setTitleBarOverlay?.({ color, symbolColor, height: 34 });
    } catch {
      // La finestra può essere già chiusa: non è un errore da propagare.
    }
  });

  // Stato del preflight all'avvio (sidecar eseguibile + chiave pronta). `get`
  // ritorna l'ultimo esito (null se il controllo è ancora in corso); `rerun` lo
  // riesegue (es. dopo aver collegato internet) e notifica il renderer.
  ipcMain.handle('preflight:get', () => getLastPreflight());
  ipcMain.handle('preflight:rerun', async () => {
    // Il callback serve alla riparazione dell'ambiente Python, che finisce
    // dopo: senza, l'esito resterebbe solo nel registro operazioni.
    const state = await runPreflight(db, udmPath, (s) => wc()?.send('preflight:update', s));
    wc()?.send('preflight:update', state);
    return state;
  });

  // Fallback chiave Rekordbox (§4.3) in-app: nessun terminale, nessun sito.
  // Registrato qui ma usa runSidecarJob (definito sotto) solo a runtime.
  ipcMain.handle('sidecar:downloadKey', async () => {
    const check = checkSidecar();
    if (!check.available) {
      return { ok: false, message: 'Modulo di lettura non disponibile su questo computer.' };
    }
    const r = await runSidecarJob('download-key', 'download-key', []);
    logOperation(db, 'sidecar.download-key', null, r.ok ? 'ok' : 'error', r.ok ? undefined : r.message);
    return r;
  });
  ipcMain.handle('export:limits', () => ({
    rekordboxXml: REKORDBOX_XML_LIMITS,
    serato: SERATO_STATUS,
    engine: ENGINE_STATUS
  }));

  // ---- libreria (paginata) ----
  ipcMain.handle('library:page', (_e, q) => getTracksPage(db, q));
  ipcMain.handle('library:pageByPlaylist', (_e, playlistId: number, offset: number, limit: number) =>
    getPlaylistTracksPage(
      db,
      playlistId,
      Math.max(0, Math.floor(Number(offset)) || 0),
      Math.max(1, Math.min(Math.floor(Number(limit)) || 50, 200))
    )
  );
  /* Tutti i numeri che l'utente legge in alto e in panoramica rispondono alla
     libreria SCELTA per la sessione: mostrare la somma di librerie diverse è
     esattamente ciò che rendeva impossibile capire dove si stava lavorando. */
  ipcMain.handle('library:stats', (_e, sources?: string[] | null) => {
    const sc = scopeClause(sources);
    return {
    tracks: (
      db.prepare(`SELECT COUNT(*) c FROM tracks WHERE ${sc.sql}`).get(sc.params) as { c: number }
    ).c,
    playlists: (
      db.prepare(
        sources && sources.length
          ? `SELECT COUNT(*) c FROM playlists WHERE source IN (${sources
              .map(() => '?')
              .join(',')})`
          : 'SELECT COUNT(*) c FROM playlists'
      ).get(...(sources && sources.length ? sources : [])) as { c: number }
    ).c,
    needsReview: (
      db
        .prepare(`SELECT COUNT(*) c FROM tracks WHERE needs_review = 1 AND ${sc.sql}`)
        .get(sc.params) as { c: number }
    ).c,
    lastIngest: db
      .prepare('SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 1')
      .get()
    };
  });

  /**
   * Che cosa c'è nell'archivio, software per software.
   *
   * Serve alla scelta di inizio sessione: l'utente non può decidere su quale
   * libreria lavorare se non sa quali ci sono e quanto contengono. `unified`
   * conta i BRANI REALI (identità canonica), non le righe: è il numero che
   * l'utente vedrà davvero scegliendo la vista unificata, ed è più piccolo
   * della somma proprio perché i doppioni fra software vengono uniti.
   */
  /**
   * Collega i doppioni fra librerie, su richiesta esplicita.
   *
   * Le righe importate PRIMA di questa funzione restano ognuna il proprio
   * brano: la migrazione non le ha toccate, come concordato. Chi vuole la
   * vista unificata senza doppioni lo chiede da qui, sapendo quante righe
   * verranno collegate. Nessuna riga viene cancellata: l'unione è un
   * puntatore, quindi resta annullabile.
   */
  /**
   * Prova a vuoto della sincronizzazione: quanti brani, quanti punti, e quante
   * perdite NON recuperabili. Va chiamata prima di ogni scrittura — un'azione
   * che tocca il lavoro fatto a mano si autorizza sapendo quanto costa.
   */
  ipcMain.handle(
    'sync:plan',
    (
      _e,
      opts: {
        originSources: string[];
        destinationSources: string[];
        destination: string;
        mode: 'fill' | 'overwrite';
      }
    ) => planSync(db, opts)
  );

  ipcMain.handle('library:linkIdentity', () => {
    const r = linkCanonicalTracks(db);
    logOperation(
      db,
      'identity.link',
      null,
      'ok',
      `${r.linked} righe collegate (percorso ${r.byRule.path}, file ${r.byRule.fileMatch}, ` +
        `impronta ${r.byRule.acoustic}); ${r.shared} brani in più software`
    );
    return r;
  });

  ipcMain.handle('library:sources', () => {
    const rows = db
      .prepare(`SELECT source, COUNT(*) c FROM tracks GROUP BY source`)
      .all() as { source: string; c: number }[];
    const pls = db
      .prepare(`SELECT source, COUNT(*) c FROM playlists GROUP BY source`)
      .all() as { source: string; c: number }[];

    const MAP: Record<string, string[]> = {
      rekordbox: ['masterdb', 'xml'],
      traktor: ['traktor'],
      virtualdj: ['virtualdj'],
      serato: ['serato'],
      engine: ['engine']
    };
    const bySoftware: Record<string, { tracks: number; playlists: number; sources: string[] }> = {};
    for (const [sw, sources] of Object.entries(MAP)) {
      bySoftware[sw] = {
        tracks: rows.filter((r) => sources.includes(r.source)).reduce((n, r) => n + r.c, 0),
        playlists: pls.filter((r) => sources.includes(r.source)).reduce((n, r) => n + r.c, 0),
        sources
      };
    }

    const unifiedTracks = (
      db
        .prepare(`SELECT COUNT(DISTINCT COALESCE(canonical_id, id)) c FROM tracks`)
        .get() as { c: number }
    ).c;
    const shared = (
      db
        .prepare(
          `SELECT COUNT(*) c FROM (
             SELECT COALESCE(canonical_id, id) k FROM tracks
             GROUP BY k HAVING COUNT(DISTINCT source) > 1
           )`
        )
        .get() as { c: number }
    ).c;

    return { bySoftware, unified: { tracks: unifiedTracks, shared } };
  });

  // Aggregati per la panoramica (istogramma BPM, copertura tonalità): conteggi
  // calcolati in SQL, mai la libreria intera attraverso il bridge.
  ipcMain.handle('library:distribution', (_e, sources?: string[] | null) =>
    getLibraryDistribution(db, sources)
  );

  // ---- ingestion XML (percorso pure-Node, modalità solo-XML) ----
  ipcMain.handle('library:ingestXml', async (_e, xmlPath: string) => {
    // Il collection XML dichiara la versione del proprio formato: se non e'
    // quella collaudata l'import prosegue, ma l'utente lo viene a sapere.
    const versioneXml = checkReadable('rekordbox', xmlPath);
    if (anyJobRunning) throw new Error('Un altro lavoro è già in corso.');
    return withJobLock(async () => {
      const progress = new ThrottledProgress(wc());
      const jobId = randomUUID();
      try {
        const result = ingestCollectionXml(db, xmlPath, (done, total) =>
          progress.update({ jobId, phase: 'ingest-xml', done, total })
        );
        progress.finish({ jobId, phase: 'ingest-xml', done: result.tracks, total: result.tracks });
        logOperation(db, 'ingest.xml', xmlPath, 'ok', JSON.stringify(result));
        relinkIdentity('ingest.xml');
        return versioneXml.status === 'ok'
          ? result
          : { ...result, warnings: [versioneXml.message] };
      } catch (err) {
        progress.finish({ jobId, phase: 'ingest-xml', done: 1, total: 1 });
        logOperation(db, 'ingest.xml', xmlPath, 'error', String(err));
        throw err;
      }
    });
  });

  // ---- import da altri software DJ (pure-Node, sola lettura sul sorgente) ----
  ipcMain.handle('library:importForeign', async (_e, kind: 'traktor' | 'virtualdj' | 'engine', path: string) => {
    if (anyJobRunning) throw new Error('Un altro lavoro è già in corso.');
    return withJobLock(async () => {
      const progress = new ThrottledProgress(wc());
      const jobId = randomUUID();
      try {
        // Versione della libreria di origine: leggere non puo' rovinare nulla,
        // ma se il formato e' piu' recente di quello collaudato quello che
        // estraiamo puo' essere incompleto o sbagliato, e va detto.
        const versione = checkReadable(kind, path);
        const lib =
          kind === 'traktor'
            ? readTraktorNml(path)
            : kind === 'engine'
              ? readEngineLibrary(path)
              : readVirtualDjXml(path);
        const result = importForeignLibrary(db, lib, (done, total) =>
          progress.update({ jobId, phase: `import-${kind}`, done, total })
        );
        // Libreria su unità di rete: SQLite non regge i lock su SMB. Se la
        // lettura è andata bene lo diciamo lo stesso, perché il prossimo
        // tentativo potrebbe fallire con un errore incomprensibile.
        const netWarn = networkPathWarning(path);
        if (netWarn) result.warnings.unshift(netWarn);
        if (versione.status !== 'ok') result.warnings.unshift(versione.message);
        progress.finish({ jobId, phase: `import-${kind}`, done: result.tracks, total: result.tracks });
        logOperation(db, `import.${kind}`, path, 'ok', JSON.stringify(result));
        relinkIdentity(`import.${kind}`);
        return { ok: true, ...result };
      } catch (err) {
        progress.finish({ jobId, phase: `import-${kind}`, done: 1, total: 1 });
        logOperation(db, `import.${kind}`, path, 'error', String(err));
        // Su rete l'errore di SQLite è criptico ("unable to open database
        // file") e sembra un problema di permessi: spieghiamo la causa vera.
        const netWarn = networkPathWarning(path);
        return { ok: false, message: netWarn ? `${String(err)}\n\n${netWarn}` : String(err) };
      }
    });
  });

  // ---- ingestion master.db (sidecar Python; sola lettura sul sorgente) ----
  ipcMain.handle(
    'library:ingestMasterdb',
    async (_e, masterDbPath: string, optionsJsonPath?: string) => {
      if (anyJobRunning) throw new Error('Un altro lavoro è già in corso.');
      const check = checkSidecar();
      if (!check.available) {
        return {
          ok: false,
          fallbackXml: true,
          message:
            'Il modulo di lettura diretta non è disponibile. Puoi comunque usare la modalità ' +
            'solo-XML: esporta la collection da Rekordbox (File → Export Collection in xml format) ' +
            'e importala da qui.'
        };
      }
      return withJobLock(async () => {
      const progress = new ThrottledProgress(wc());
      const jobId = randomUUID();
      const args = ['--master-db', masterDbPath];
      if (optionsJsonPath) args.push('--options-json', optionsJsonPath);
      let lastError: string | null = null;

      const handle = runSidecar({
        command: 'ingest-masterdb',
        udmPath,
        args,
        onEvent: (ev) => {
          if (ev.type === 'progress') {
            progress.update({
              jobId,
              phase: ev.phase ?? 'ingest-masterdb',
              done: ev.done ?? 0,
              total: ev.total ?? 0
            });
          } else if (ev.type === 'error') {
            lastError = ev.message ?? 'Errore sconosciuto del sidecar';
          }
        }
      });
      currentCancel = handle.cancel;
      try {
        const { code } = await handle.finished;
        progress.finish({ jobId, phase: 'ingest-masterdb', done: 1, total: 1 });
        if (code !== 0) {
          logOperation(db, 'ingest.masterdb', masterDbPath, 'error', lastError ?? `exit ${code}`);
          // Prima causa da escludere quando il master.db non si apre: sta su un
          // NAS o su un'unità mappata, dove SQLite non riesce a prendere i lock.
          const netWarn = networkPathWarning(masterDbPath);
          return {
            ok: false,
            fallbackXml: true,
            message:
              (lastError ?? 'Lettura del database non riuscita.') +
              (netWarn ? `\n\n${netWarn}` : '') +
              ' Puoi usare la modalità solo-XML (esporta la collection da Rekordbox e importala qui)' +
              ' oppure, in modalità Esperto: Impostazioni → "Scarica chiave di lettura" e riprova.'
          };
        }
        logOperation(db, 'ingest.masterdb', masterDbPath, 'ok');
        relinkIdentity('ingest.masterdb');
        return { ok: true };
      } finally {
        currentCancel = null;
      }
      });
    }
  );

  // ---- import Serato (sidecar Python; database V2 + crate + cue GEOB) ----
  // Sperimentale, sola lettura. Riceve la cartella "_Serato_" e vi legge dentro.
  ipcMain.handle('library:importSerato', async (_e, seratoDir: string) => {
    const check = checkSidecar();
    if (!check.available) {
      return { ok: false, message: 'Il modulo di lettura non è disponibile su questo computer.' };
    }
    const versioneSerato = checkReadable('serato', seratoDir);
    const r = await runSidecarJob('read-serato', 'read-serato', ['--serato-dir', seratoDir]);
    logOperation(db, 'import.serato', seratoDir, r.ok ? 'ok' : 'error', r.ok ? JSON.stringify(r.data) : r.message);
    if (r.ok) relinkIdentity('import.serato');
    const netWarn = networkPathWarning(seratoDir);
    const avvisi = [netWarn, versioneSerato.status !== 'ok' ? versioneSerato.message : null].filter(
      (a): a is string => !!a
    );
    return r.ok
      ? { ok: true, ...r.data, ...(avvisi.length ? { warnings: avvisi } : {}) }
      : {
          ok: false,
          message: avvisi.length ? [r.message, ...avvisi].join('\n\n') : r.message
        };
  });

  ipcMain.handle('job:cancel', () => {
    currentCancel?.();
    return true;
  });

  // ---- backup ----
  ipcMain.handle('backup:plan', async (_e, opts: BackupOptions) => {
    const progress = new ThrottledProgress(wc());
    const jobId = randomUUID();
    const plan = await planBackup({
      ...opts,
      onProgress: (done, total, phase) => progress.update({ jobId, phase, done, total })
    });
    progress.finish({ jobId, phase: 'scan', done: plan.scannedFiles, total: plan.scannedFiles });
    const planId = randomUUID();
    backupPlans.set(planId, { plan, opts });
    logOperation(db, 'backup.plan', opts.musicDir, 'dry-run', `${plan.items.length} file da copiare`);
    // Al renderer: solo riepilogo + anteprima limitata, mai la lista completa.
    return {
      planId,
      scannedFiles: plan.scannedFiles,
      toCopy: plan.items.length,
      totalBytes: plan.totalBytes,
      dbSnapshotDir: plan.dbSnapshotDir,
      preview: plan.items.slice(0, 50).map((i) => ({ src: i.src, reason: i.reason }))
    };
  });

  ipcMain.handle('backup:execute', async (_e, planId: string) => {
    const entry = backupPlans.get(planId);
    if (!entry) throw new Error('Piano di backup scaduto: rilancia l\'anteprima.');
    backupPlans.delete(planId);
    const progress = new ThrottledProgress(wc());
    const jobId = randomUUID();
    const result = await executeBackup(entry.plan, {
      ...entry.opts,
      onProgress: (done, total, phase) => progress.update({ jobId, phase, done, total })
    });
    progress.finish({ jobId, phase: 'copy', done: result.copied, total: result.copied });
    logOperation(
      db,
      'backup.execute',
      entry.opts.backupDir,
      result.failed.length ? 'error' : 'ok',
      `${result.copied} copiati, ${result.failed.length} falliti`
    );
    return result;
  });

  // ---- orfani ----
  ipcMain.handle('orphans:scan', async (_e, musicDir: string) => {
    const progress = new ThrottledProgress(wc());
    const jobId = randomUUID();
    const result = await findOrphans(db, musicDir, (scanned) =>
      progress.update({ jobId, phase: 'orphan-scan', done: scanned, total: 0 })
    );
    progress.finish({
      jobId,
      phase: 'orphan-scan',
      done: result.scannedFiles,
      total: result.scannedFiles
    });
    logOperation(db, 'orphans.scan', musicDir, 'ok', `${result.orphans.length} orfani`);
    // Registra i path trovati sotto uno scanId; l'eliminazione dovrà citarlo.
    const scanId = randomUUID();
    orphanScans.set(scanId, new Set(result.orphans.map((o) => o.path)));
    // Tieni solo l'ultima scansione (evita leak lento su molte scansioni).
    if (orphanScans.size > 3) {
      const oldest = orphanScans.keys().next().value;
      if (oldest) orphanScans.delete(oldest);
    }
    // Lista orfani: può essere lunga, il renderer la pagina lato UI (array di
    // sole stringhe+numeri, non oggetti pesanti).
    return { ...result, scanId };
  });

  ipcMain.handle(
    'orphans:quarantine',
    (_e, files: string[], quarantineRoot: string, dryRun: boolean) =>
      quarantineOrphans(db, files, quarantineRoot, dryRun)
  );

  // Contenuto della quarantena e ripristino: è ciò che rende "reversibile" un
  // fatto e non una promessa. Il ripristino non sovrascrive mai — se all'origine
  // c'è già un file, la voce viene saltata e dichiarata.
  ipcMain.handle('quarantine:list', (_e, quarantineRoot: string) =>
    listQuarantine(quarantineRoot)
  );
  ipcMain.handle(
    'quarantine:restore',
    (_e, quarantineDir: string, files: string[], dryRun: boolean) =>
      restoreFromQuarantine(db, quarantineDir, files, dryRun)
  );

  // Apre una cartella nel file manager di sistema. Solo cartelle esistenti:
  // shell.openPath su un percorso arbitrario sarebbe un'esecuzione mascherata.
  ipcMain.handle('shell:showFolder', async (_e, dirPath: string) => {
    if (typeof dirPath !== 'string' || !existsSync(dirPath)) return { ok: false };
    if (!statSync(dirPath).isDirectory()) return { ok: false };
    await shell.openPath(dirPath);
    return { ok: true };
  });

  // Eliminazione definitiva: SOLO con il setting "scritture dirette" attivo
  // (fase intermedia). Il gate è anche qui nel main, non solo in UI.
  ipcMain.handle('orphans:delete', (_e, scanId: string, files: string[], dryRun: boolean) => {
    if (getSetting(db, 'directWrites') !== '1') {
      throw new Error(
        'Le scritture dirette sono disattivate. Attivale in Impostazioni → Esperto.'
      );
    }
    const scanned = orphanScans.get(scanId);
    if (!scanned) {
      throw new Error('Scansione scaduta o non trovata: rilancia la ricerca degli orfani.');
    }
    // Elimina SOLO i path realmente trovati dalla scansione citata.
    const safe = files.filter((f) => scanned.has(f));
    if (safe.length !== files.length) {
      throw new Error('Elenco file non coerente con la scansione: operazione annullata.');
    }
    return deleteOrphans(db, safe, dryRun);
  });

  // ---- report excel ----
  ipcMain.handle('report:generate', async (_e, opts) => {
    const progress = new ThrottledProgress(wc());
    const jobId = randomUUID();
    const result = await generateExcelReport(db, {
      ...opts,
      onProgress: (done: number, total: number) =>
        progress.update({ jobId, phase: 'excel', done, total })
    });
    progress.finish({ jobId, phase: 'excel', done: result.rows, total: result.rows });
    // Il workbook in cache appartiene al report precedente: liberiamolo subito
    // invece di tenere in memoria un file che nessuno sfoglierà più.
    clearReportCache();
    logOperation(db, 'report.excel', result.outPath, 'ok', `${result.rows} righe`);
    return result;
  });

  // Visualizzatore report: pagine di max 500 righe, mai il file intero su IPC.
  ipcMain.handle('report:view', (_e, filePath: string, offset: number, limit: number) =>
    readReportPage(filePath, offset, limit)
  );

  // ---- export ----
  ipcMain.handle('export:rekordboxXml', (_e, outPath: string, sel) => {
    const r = writeRekordboxXml(db, outPath, sel ?? {});
    logOperation(db, 'export.rekordbox-xml', outPath, 'ok', JSON.stringify(r));
    return r;
  });
  ipcMain.handle('export:traktorNml', (_e, outPath: string, sel) => {
    const r = writeTraktorNml(db, outPath, sel ?? {});
    logOperation(db, 'export.traktor-nml', outPath, 'ok', JSON.stringify(r));
    return r;
  });
  ipcMain.handle('export:virtualdjXml', (_e, outPath: string, sel) => {
    const r = writeVirtualDjXml(db, outPath, sel ?? {});
    logOperation(db, 'export.virtualdj-xml', outPath, 'ok', JSON.stringify(r));
    return r;
  });

  /**
   * Export verso ENGINE DJ: genera una Engine Library NUOVA nella cartella
   * scelta dall'utente. Non tocchiamo quella esistente — i blob di forma
   * d'onda e griglia sappiamo leggerli ma non ricrearli per intero, e Engine
   * li rigenera alla prima analisi.
   *
   * Serve un m.db esistente come modello dello schema, così la libreria
   * generata ha la stessa versione dell'installazione dell'utente.
   */
  ipcMain.handle(
    'export:engineLibrary',
    (_e, outDir: string, templateDbPath: string, sel?: { playlistIds?: number[] }) => {
      try {
        // Lo schema della libreria generata viene copiato da questo m.db: se e'
        // di una versione non collaudata, quello che scriviamo dentro puo' non
        // corrispondere a cio' che Engine si aspetta.
        assertWritable('engine', templateDbPath);
        const r = writeEngineLibrary(db, outDir, templateDbPath, sel ?? {});
        logOperation(
          db,
          'export.engine-library',
          r.dbPath,
          'ok',
          JSON.stringify({ tracks: r.tracks, cues: r.cues, loops: r.loops })
        );
        return { ok: true, ...r };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logOperation(db, 'export.engine-library', outDir, 'error', message);
        return { ok: false, message };
      }
    }
  );

  /**
   * Export verso SERATO: gli hot cue non stanno in un file di libreria da
   * importare, ma nei tag GEOB dei FILE AUDIO stessi. È quindi una scrittura
   * sugli originali e passa dal gate delle scritture dirette, con backup +
   * hash + rollback nel sidecar.
   *
   * Il writer preserva byte-per-byte le entry che non interpretiamo (colore
   * traccia, BPM lock, flip…) e annulla la scrittura se nel blob restano byte
   * non riconosciuti: meglio non scrivere che cancellare dati dell'utente.
   */
  ipcMain.handle(
    'export:seratoCues',
    async (_e, sel?: { playlistIds?: number[]; source?: string; dryRun?: boolean }) => {
    if (getSetting(db, 'directWrites') !== '1') {
      throw new Error(
        'Serato salva i cue dentro i file audio: serve attivare le scritture dirette in Impostazioni → Esperto.'
      );
    }
    const check = checkSidecar();
    if (!check.available) {
      return { ok: false, message: 'Modulo sidecar non disponibile.' };
    }

    /* Il formato dei tag Serato lo detta la versione di Serato che li leggerà.
       Prendiamo come riferimento la libreria installata su questa macchina: se
       è più recente di quella collaudata — o se non c'è affatto, e quindi non
       possiamo verificare nulla — non scriviamo dentro i file audio dell'utente.
       Chi prepara i file per un altro computer può sbloccare la versione a mano. */
    const seratoLib = detectDjSoftware().find((s) => s.id === 'serato');
    assertWritable('serato', seratoLib?.path ?? '');

    /* Un job per file, con i soli hot cue entro gli 8 pad di Serato.
       Il filtro per SORGENTE va applicato qui come lo applicano tutti gli altri
       export (iterateTracks in adapters/common.ts): senza, una conversione
       "da Traktor a Serato" riscriverebbe i tag di ogni brano dell'archivio
       interno, non solo di quelli appena importati. */
    const conds: string[] = [];
    const params: unknown[] = [];
    if (sel?.source) {
      conds.push('t.source = ?');
      params.push(sel.source);
    }
    if (sel?.playlistIds && sel.playlistIds.length) {
      conds.push(
        `t.id IN (SELECT track_id FROM playlist_tracks WHERE playlist_id IN (${sel.playlistIds
          .map(() => '?')
          .join(',')}))`
      );
      params.push(...sel.playlistIds);
    }
    const where = conds.length ? `AND ${conds.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT t.path, c.cue_type, c.cue_index, c.position_ms, c.length_ms, c.color, c.label
         FROM cues c JOIN tracks t ON t.id = c.track_id
         WHERE t.path IS NOT NULL AND c.cue_type IN ('hot','loop')
           AND c.cue_index IS NOT NULL AND c.cue_index BETWEEN 0 AND 7 ${where}
         ORDER BY t.path, c.cue_index`
      )
      .all(...params) as {
      path: string;
      cue_type: string;
      cue_index: number;
      position_ms: number;
      length_ms: number | null;
      color: string | null;
      label: string | null;
    }[];

    interface SeratoJob {
      path: string;
      cues: { index: number; positionMs: number; color: string | null; label: string | null }[];
      loops: {
        index: number;
        startMs: number;
        endMs: number;
        color: string | null;
        label: string | null;
      }[];
    }
    const byPath = new Map<string, SeratoJob>();
    for (const r of rows) {
      const job = byPath.get(r.path) ?? { path: r.path, cues: [], loops: [] };
      if (r.cue_type === 'loop') {
        // Un loop senza durata non è rappresentabile in Serato: si salta.
        if (r.length_ms !== null && r.length_ms > 0) {
          job.loops.push({
            index: r.cue_index,
            startMs: Math.round(r.position_ms),
            endMs: Math.round(r.position_ms + r.length_ms),
            color: r.color,
            label: r.label
          });
        }
      } else {
        job.cues.push({
          index: r.cue_index,
          positionMs: Math.round(r.position_ms),
          color: r.color,
          label: r.label
        });
      }
      byPath.set(r.path, job);
    }
    const jobs = [...byPath.values()].filter((j) => j.cues.length || j.loops.length);
    if (!jobs.length) {
      return {
        ok: false,
        message: 'Nessun hot cue o loop da scrivere (Serato usa 8 pad per brano).'
      };
    }

    /* Prova a vuoto: l'interfaccia chiede PRIMA quanti file verrebbero
       modificati, e lo mostra all'utente nella conferma. Una scrittura sugli
       originali non deve mai partire da un numero che l'utente non ha visto. */
    if (sel?.dryRun) {
      return {
        ok: true,
        dryRun: true,
        files: jobs.length,
        cues: jobs.reduce((n, j) => n + j.cues.length, 0),
        loops: jobs.reduce((n, j) => n + j.loops.length, 0)
      };
    }

    const backupDir = join(
      app.getPath('userData'),
      'backups',
      `serato-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
    );
    const cuesFile = writeTempJson('serato-cues', jobs);
    let r;
    try {
      r = await runSidecarJob('write-serato-cues', 'write-serato', [
        '--cues-file',
        cuesFile,
        '--backup-dir',
        backupDir
      ]);
    } finally {
      rmSync(cuesFile, { force: true });
    }
    logOperation(
      db,
      'export.serato-cues',
      backupDir,
      r.ok ? 'ok' : 'error',
      r.ok ? JSON.stringify(r.data) : r.message
    );
    return r.ok
      ? { ok: true, ...r.data, files: jobs.length, backupDir }
      : { ok: false, message: r.message };
    }
  );

  /**
   * Playlist verso Serato: sono file `.crate` nella cartella Subcrates della
   * libreria. Il formato NON è stato verificato con un round-trip su un crate
   * scritto da Serato (nella libreria di riferimento non ne esisteva nessuno),
   * quindi il sidecar non sovrascrive mai un crate già presente.
   */
  ipcMain.handle(
    'export:seratoCrates',
    async (_e, seratoDir: string, sel?: { playlistIds?: number[] }) => {
      const check = checkSidecar();
      if (!check.available) return { ok: false, message: 'Modulo sidecar non disponibile.' };

      // Si scrive DENTRO la cartella _Serato_ dell'utente: la versione di quel
      // database decide se il formato dei crate è quello che sappiamo produrre.
      assertWritable('serato', seratoDir);

      const lists = listPlaylists(db).filter(
        (p) => !sel?.playlistIds?.length || sel.playlistIds.includes(p.id)
      );
      const jobs = lists
        .map((p) => ({
          name: p.name,
          paths: (
            db
              .prepare(
                `SELECT t.path FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
               WHERE pt.playlist_id = ? AND t.path IS NOT NULL ORDER BY pt.position`
              )
              .all(p.id) as { path: string }[]
          ).map((r) => r.path)
        }))
        .filter((j) => j.paths.length);
      if (!jobs.length) return { ok: false, message: 'Nessuna playlist con brani da esportare.' };

      const cratesFile = writeTempJson('serato-crates', jobs);
      let r;
      try {
        r = await runSidecarJob('write-serato-crates', 'write-serato-crates', [
          '--serato-dir',
          seratoDir,
          '--crates-file',
          cratesFile
        ]);
      } finally {
        rmSync(cratesFile, { force: true });
      }
      logOperation(
        db,
        'export.serato-crates',
        seratoDir,
        r.ok ? 'ok' : 'error',
        r.ok ? JSON.stringify(r.data) : r.message
      );
      return r.ok ? { ok: true, ...r.data } : { ok: false, message: r.message };
    }
  );

  // ---- relocator ----
  ipcMain.handle('relocator:findBroken', () => {
    const broken = findBrokenTracks(db);
    return broken.map((b) => ({
      trackId: b.track.id,
      title: b.track.title,
      artist: b.track.artist,
      oldPath: b.oldPath
    }));
  });
  ipcMain.handle('relocator:matchAndWrite', async (_e, newRoot: string, outPath: string | null) => {
    const progress = new ThrottledProgress(wc());
    const jobId = randomUUID();
    const broken = findBrokenTracks(db);
    const matches: RelocationMatch[] = await matchByFilename(broken, newRoot, (scanned) =>
      progress.update({ jobId, phase: 'relocate-scan', done: scanned, total: 0 })
    );
    progress.finish({ jobId, phase: 'relocate-scan', done: 1, total: 1 });
    const summary = {
      broken: broken.length,
      matched: matches.filter((m) => m.newPath).length,
      ambiguous: matches.filter((m) => m.ambiguous.length > 0).length,
      written: 0
    };
    if (outPath) {
      // outPath presente = l'utente ha già confermato nel wizard (dry-run prima).
      const r = writeRelocationXml(matches, outPath);
      summary.written = r.written;
      logOperation(db, 'relocator.xml', outPath, 'ok', JSON.stringify(summary));
    } else {
      logOperation(db, 'relocator.dry-run', newRoot, 'dry-run', JSON.stringify(summary));
    }
    return summary;
  });

  // ---- oplog ----
  ipcMain.handle('oplog:list', (_e, limit = 200) =>
    // Clamp completo: un limit negativo diventerebbe LIMIT -1 = nessun limite.
    db.prepare('SELECT * FROM oplog ORDER BY id DESC LIMIT ?').all(
      Math.max(1, Math.min(Math.floor(Number(limit)) || 200, 1000))
    )
  );

  // Export del registro in testo leggibile (§3.7), scritto a blocchi.
  ipcMain.handle('oplog:export', async (_e, outPath: string) => {
    const { createWriteStream } = await import('fs');
    const stream = createWriteStream(outPath, { encoding: 'utf-8' });
    stream.write('Registro operazioni CrateForge\n================================\n\n');
    for (const row of db
      .prepare('SELECT * FROM oplog ORDER BY id DESC')
      .iterate() as IterableIterator<{
      ts: string;
      operation: string;
      target: string | null;
      outcome: string;
      detail: string | null;
    }>) {
      stream.write(
        `[${row.ts}] ${row.operation} — ${row.outcome}` +
          (row.target ? `\n  su: ${row.target}` : '') +
          (row.detail ? `\n  dettagli: ${row.detail}` : '') +
          '\n'
      );
    }
    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });
    logOperation(db, 'oplog.export', outPath, 'ok');
    return { outPath };
  });

  // =====================================================================
  // FASE 2 — funzioni sperimentali (modalità Esperto)
  // =====================================================================

  /** Esegue un comando sidecar con progressi throttlati; ritorna l'evento done. */
  const runSidecarJob = (
    command: string,
    phase: string,
    args: string[]
  ): Promise<{ ok: boolean; data?: Record<string, unknown>; message?: string }> =>
    // Serializzato con ogni altro job che tocca l'UDM (§ coda job unica).
    withJobLock(() => {
      const progress = new ThrottledProgress(wc());
      const jobId = randomUUID();
      const isWrite = WRITE_COMMANDS.has(command);
      if (isWrite) writeJobsInFlight++;
      let doneData: Record<string, unknown> | undefined;
      let lastError: string | null = null;
      const handle = runSidecar({
        command,
        udmPath,
        args,
        onEvent: (ev: SidecarEvent) => {
          if (ev.type === 'progress') {
            progress.update({ jobId, phase: ev.phase ?? phase, done: ev.done ?? 0, total: ev.total ?? 0 });
          } else if (ev.type === 'done') {
            doneData = ev.data;
          } else if (ev.type === 'error') {
            lastError = ev.message ?? 'Errore sconosciuto del sidecar';
          }
        }
      });
      currentCancel = handle.cancel;
      return handle.finished.then(({ code }) => {
        progress.finish({ jobId, phase, done: 1, total: 1 });
        currentCancel = null;
        if (isWrite) writeJobsInFlight--;
        if (code !== 0 || !doneData) {
          return { ok: false as const, message: lastError ?? `Il modulo è terminato con codice ${code}.` };
        }
        return { ok: true as const, data: doneData };
      });
    });

  // ---- dedup per fingerprint (Fase 2.2) ----
  ipcMain.handle('dedup:run', async () => {
    const r = await runSidecarJob('fingerprint-batch', 'fingerprint', []);
    if (!r.ok) {
      logOperation(db, 'dedup.fingerprint', null, 'error', r.message);
      return { ok: false, message: r.message };
    }
    // Gruppi con lo stesso acoustic_id (bounded: max 500 gruppi al renderer).
    const groups = db
      .prepare(
        `SELECT acoustic_id, COUNT(*) AS c FROM tracks
         WHERE acoustic_id IS NOT NULL
         GROUP BY acoustic_id HAVING c > 1
         ORDER BY c DESC LIMIT 500`
      )
      .all() as { acoustic_id: string; c: number }[];
    const trackStmt = db.prepare(
      `SELECT id, title, artist, path, filesize, duration_s FROM tracks WHERE acoustic_id = ?`
    );
    const result = groups.map((g) => ({
      acousticId: g.acoustic_id,
      tracks: trackStmt.all(g.acoustic_id) as Pick<
        TrackRow,
        'id' | 'title' | 'artist' | 'path' | 'filesize' | 'duration_s'
      >[]
    }));
    logOperation(db, 'dedup.fingerprint', null, 'ok', `${result.length} gruppi di duplicati`);
    return { ok: true, stats: r.data, groups: result };
  });

  // ---- relocator per fingerprint (Fase 2.3) ----
  ipcMain.handle('relocator:fingerprintMatch', async (_e, newRoot: string) => {
    const r = await runSidecarJob('match-fingerprints', 'relocate-fingerprint', [
      '--new-root',
      newRoot
    ]);
    if (!r.ok) {
      logOperation(db, 'relocator.fingerprint', newRoot, 'error', r.message);
      return { ok: false, message: r.message };
    }
    logOperation(db, 'relocator.fingerprint', newRoot, 'dry-run', JSON.stringify(r.data));
    return { ok: true, ...r.data };
  });

  ipcMain.handle('relocator:writeFingerprintXml', (_e, outPath: string) => {
    const rows = db
      .prepare(
        `SELECT rm.new_path, t.* FROM relocation_matches rm
         JOIN tracks t ON t.id = rm.track_id
         WHERE rm.method = 'fingerprint'`
      )
      .all() as ({ new_path: string } & TrackRow)[];
    const matches = rows.map((row) => {
      const { new_path, ...track } = row;
      return {
        track: track as TrackRow,
        oldPath: track.path ?? '',
        newPath: new_path,
        ambiguous: []
      };
    });
    const r = writeRelocationXml(matches, outPath);
    logOperation(db, 'relocator.fingerprint.xml', outPath, 'ok', JSON.stringify(r));
    return r;
  });

  // ---- auto-cue assistito (Fase 2.1) ----
  ipcMain.handle('cues:analyze', async (_e, trackId: number) => {
    const t = db.prepare(`SELECT id, path FROM tracks WHERE id = ?`).get(trackId) as
      | { id: number; path: string | null }
      | undefined;
    if (!t?.path) return { ok: false, message: 'Brano senza percorso file.' };
    const r = await runSidecarJob('analyze-cues', 'analyze-cues', [
      '--file',
      t.path,
      '--track-id',
      String(trackId)
    ]);
    if (!r.ok) {
      logOperation(db, 'cues.analyze', t.path, 'error', r.message);
      return { ok: false, message: r.message };
    }
    logOperation(db, 'cues.analyze', t.path, 'ok');
    return { ok: true, ...r.data };
  });

  // L'utente ha rivisto/spostato i cue proposti e ha cliccato salva:
  // scriviamo nell'UDM (mai nel master.db; verso Rekordbox si passa dall'XML).
  ipcMain.handle(
    'cues:save',
    (_e, trackId: number, cues: { label: string; positionMs: number; color: string | null }[]) => {
      // Validazione al confine IPC: il track deve esistere e i cue devono avere
      // posizione finita >= 0, label troncata, colore #RRGGBB o null. I dati
      // finiscono poi nell'XML per Rekordbox: niente valori sballati.
      const exists = db.prepare(`SELECT 1 FROM tracks WHERE id = ?`).get(trackId);
      if (!exists) throw new Error('Brano inesistente.');
      const capped = cues
        .filter((c) => Number.isFinite(c.positionMs) && c.positionMs >= 0)
        .slice(0, 8) // limite hot cue import XML (§4)
        .map((c) => ({
          positionMs: c.positionMs,
          label: typeof c.label === 'string' ? c.label.slice(0, 100) : null,
          color: typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : null
        }));
      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM cues WHERE track_id = ? AND cue_type = 'hot'`).run(trackId);
        const ins = db.prepare(
          `INSERT INTO cues (track_id, cue_type, cue_index, position_ms, color, label)
           VALUES (?, 'hot', ?, ?, ?, ?)`
        );
        capped.forEach((c, i) => ins.run(trackId, i, c.positionMs, c.color, c.label));
      });
      tx();
      logOperation(db, 'cues.save', String(trackId), 'ok', `${capped.length} hot cue`);
      return { saved: capped.length };
    }
  );

  // ---- auto-tagger (Fase 2.4): solo query testuali, mai upload audio ----
  ipcMain.handle('tagger:propose', async (_e, limit?: number, provider?: TagProvider) => {
    const progress = new ThrottledProgress(wc());
    const jobId = randomUUID();
    try {
      const r = await proposeTags(db, {
        limit,
        provider,
        discogsToken: getSetting(db, 'discogsToken') ?? undefined,
        onProgress: (done, total) => progress.update({ jobId, phase: 'tagger', done, total })
      });
      progress.finish({ jobId, phase: 'tagger', done: 1, total: 1 });
      logOperation(
        db,
        'tagger.propose',
        provider ?? 'musicbrainz',
        'dry-run',
        `${r.proposals.length} proposte su ${r.queried} brani`
      );
      return { ok: true, ...r };
    } catch (err) {
      progress.finish({ jobId, phase: 'tagger', done: 1, total: 1 });
      logOperation(db, 'tagger.propose', null, 'error', String(err));
      return { ok: false, message: String(err) };
    }
  });

  // target 'udm' (default, sicuro) oppure 'original': scrittura ID3 sui file
  // originali via sidecar mutagen, con backup+hash+rollback. Gate nel main.
  ipcMain.handle(
    'tagger:apply',
    async (_e, proposals: TagProposal[], target: 'udm' | 'original' = 'udm') => {
      if (target === 'udm') return { ...applyProposals(db, proposals), target: 'udm' };

      if (getSetting(db, 'directWrites') !== '1') {
        throw new Error(
          'Le scritture dirette sono disattivate. Attivale in Impostazioni → Esperto.'
        );
      }
      const check = checkSidecar();
      if (!check.available) {
        return { ok: false, target: 'original', message: 'Modulo sidecar non disponibile.' };
      }
      // Raggruppa le proposte per file (il path viene dall'UDM).
      const pathStmt = db.prepare(`SELECT path FROM tracks WHERE id = ?`);
      const byTrack = new Map<number, { path: string; tags: Record<string, string> }>();
      for (const p of proposals) {
        const row = pathStmt.get(p.trackId) as { path: string | null } | undefined;
        if (!row?.path) continue;
        const entry = byTrack.get(p.trackId) ?? { path: row.path, tags: {} };
        entry.tags[p.field] = p.proposed;
        byTrack.set(p.trackId, entry);
      }
      const jobs = [...byTrack.values()];
      const backupDir = join(
        app.getPath('userData'),
        'backups',
        `id3-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
      );
      const tagsFile = writeTempJson('tags', jobs);
      let r;
      try {
        r = await runSidecarJob('write-tags', 'write-tags', [
          '--tags-file',
          tagsFile,
          '--backup-dir',
          backupDir
        ]);
      } finally {
        rmSync(tagsFile, { force: true });
      }
      if (!r.ok) {
        logOperation(db, 'tagger.apply.original', null, 'error', r.message);
        return { ok: false, target: 'original', message: r.message };
      }
      // Aggiorna anche l'UDM così la libreria interna resta allineata.
      applyProposals(db, proposals);
      logOperation(
        db,
        'tagger.apply.original',
        backupDir,
        'ok',
        `SCRITTURA SU ORIGINALI: ${(r.data as { written?: number })?.written ?? 0} file, backup in ${backupDir}`
      );
      return { ok: true, target: 'original', ...r.data, backupDir };
    }
  );

  // ---- stems (Fase 2.5, opzionale e pesante) ----
  ipcMain.handle('stems:run', async (_e, trackId: number, outDir: string) => {
    const t = db.prepare(`SELECT path FROM tracks WHERE id = ?`).get(trackId) as
      | { path: string | null }
      | undefined;
    if (!t?.path) return { ok: false, message: 'Brano senza percorso file.' };
    const r = await runSidecarJob('stems', 'stems', ['--file', t.path, '--out-dir', outDir]);
    logOperation(db, 'stems.run', t.path, r.ok ? 'ok' : 'error', r.ok ? outDir : r.message);
    return r;
  });

  // =====================================================================
  // FASE 3 — power user (modalità Esperto)
  // =====================================================================

  // ---- Sync Daemon "Nuovi Acquisti" (§6 Fase 3.1) ----
  // Attivo solo mentre l'app è aperta (la UI lo dichiara). Nuovi item →
  // notifica leggera al renderer (solo il conteggio, mai bulk data).
  const daemon = new SyncDaemon(db, undefined, (added) => {
    win()?.webContents.send('inbox:new-items', { added });
  });

  ipcMain.handle('watcher:start', async (_e, folder: string) => {
    const r = await daemon.start(folder);
    setSetting(db, 'watchFolder', folder);
    setSetting(db, 'watchEnabled', '1');
    return r;
  });
  ipcMain.handle('watcher:stop', () => {
    daemon.stop();
    setSetting(db, 'watchEnabled', '0');
    logOperation(db, 'watch.stop', getSetting(db, 'watchFolder'), 'ok');
    return true;
  });
  ipcMain.handle('watcher:status', () => daemon.status());
  ipcMain.handle('watcher:scan', async (_e, folder: string) => daemon.scanOnce(folder));

  // Riavvio automatico del daemon se era attivo nella sessione precedente.
  if (getSetting(db, 'watchEnabled') === '1') {
    const saved = getSetting(db, 'watchFolder');
    if (saved) daemon.start(saved).catch(() => setSetting(db, 'watchEnabled', '0'));
  }

  ipcMain.handle('inbox:list', (_e, status?: 'new' | 'prepared' | 'dismissed') =>
    listInbox(db, status ?? 'new')
  );
  ipcMain.handle(
    'inbox:setStatus',
    (_e, ids: number[], status: 'new' | 'prepared' | 'dismissed') => {
      const n = setInboxStatus(db, ids, status);
      logOperation(db, 'inbox.status', null, 'ok', `${n} item → ${status}`);
      return n;
    }
  );
  ipcMain.handle('inbox:prepareXml', (_e, ids: number[], outPath: string) => {
    const all = listInbox(db, 'new', 2000);
    const chosen = all.filter((i) => ids.includes(i.id) && i.has_tag_issues === 0);
    const r = writeInboxXml(chosen, outPath);
    setInboxStatus(db, chosen.map((i) => i.id), 'prepared');
    logOperation(db, 'inbox.xml', outPath, 'ok', `${r.written} nuovi brani nell'XML`);
    return { ...r, excludedForIssues: ids.length - chosen.length };
  });

  // ---- Salute libreria (read-only, modalità Semplice) ----
  ipcMain.handle('health:get', (_e, sources?: string[] | null) => computeHealth(db, sources));

  // ---- Set Builder (Esperto, read-only; export = solito XML manuale) ----
  ipcMain.handle(
    'setbuilder:build',
    (_e, startTrackId: number, length: number, curve: BpmCurve) =>
      buildSet(db, startTrackId, length, curve)
  );
  ipcMain.handle(
    'setbuilder:exportXml',
    (_e, trackIds: number[], playlistName: string, outPath: string) => {
      const r = writeSetXml(db, trackIds, playlistName, outPath);
      logOperation(db, 'setbuilder.xml', outPath, 'ok', `${r.written} brani in "${playlistName}"`);
      return r;
    }
  );

  // ---- Scrittura DIRETTA nel master.db (opt-in massimo, Rekordbox chiuso) ----
  // La cifratura SQLCipher è documentata (chiave fissa nota); pyrekordbox
  // scrive e ri-cifra gestendo l'USN. Gate: setting masterDbWrites nel main.
  // Node copia (byte, sola lettura sul sorgente) master.db+options.json in un
  // backup datato PRIMA di qualsiasi scrittura (§3.2).
  ipcMain.handle(
    'masterdb:createPlaylist',
    async (
      _e,
      trackIds: number[],
      playlistName: string,
      masterDbPath: string,
      optionsJsonPath: string | null
    ) => {
      if (getSetting(db, 'masterDbWrites') !== '1') {
        throw new Error(
          'La scrittura diretta nel database di Rekordbox è disattivata. ' +
            'Attivala in Impostazioni → Esperto (con tutti gli avvisi del caso).'
        );
      }
      const check = checkSidecar();
      if (!check.available) {
        return { ok: false, message: 'Il modulo di lettura/scrittura non è disponibile.' };
      }

      /* È l'unico punto in cui scriviamo dentro il database dell'utente. Il
         master.db è cifrato e il suo schema non è ispezionabile da fuori:
         l'unico dato disponibile è quale Rekordbox è installato qui. Se è più
         recente di quello collaudato ci fermiamo — un errore adesso vale una
         libreria da ricostruire dopo. */
      const versioneRb = evaluateAppVersion('rekordbox', probeRekordboxApp(), {
        acknowledged: getSetting(db, appAcknowledgeKey('rekordbox'))
      });
      if (versioneRb.blocksWrite) {
        logOperation(db, 'version.block', masterDbPath, 'error', `rekordbox=${versioneRb.detected ?? 'n/d'}`);
        return { ok: false, message: versioneRb.message };
      }

      // Risolvi gli ID contenuto del master.db dai brani UDM (source_id).
      const idStmt = db.prepare(`SELECT source_id FROM tracks WHERE id = ?`);
      const contentIds = trackIds
        .map((id) => (idStmt.get(id) as { source_id: string | null } | undefined)?.source_id)
        .filter((s): s is string => !!s);
      if (contentIds.length === 0) {
        return {
          ok: false,
          message:
            'Nessuno dei brani selezionati ha un identificativo del database Rekordbox ' +
            '(serve una libreria importata da master.db, non da XML).'
        };
      }

      // Backup obbligatorio PRIMA di scrivere (§3.2).
      const backupDir = join(
        app.getPath('userData'),
        'backups',
        `masterdb-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
      );
      try {
        mkdirSync(backupDir, { recursive: true });
        /* Copia VERIFICATA: si confronta l'hash dell'originale con quello della
           copia prima di considerare fatto il backup. Una copia troncata (disco
           pieno, percorso di rete, antivirus) sarebbe una rete di sicurezza che
           cede proprio quando serve — ed è l'unica che protegge l'unica
           scrittura dentro la libreria cifrata dell'utente.
           Insieme ai file si scrive un manifest: senza, un backup è una cartella
           di file dal nome uguale e nessuno sa più da dove venivano. */
        const copied: { from: string; to: string; sha256: string; bytes: number }[] = [];
        for (const src of [masterDbPath, ...(optionsJsonPath ? [optionsJsonPath] : [])]) {
          const dest = join(backupDir, basename(src));
          copyFileSync(src, dest);
          const [a, b] = await Promise.all([hashFile(src), hashFile(dest)]);
          if (a !== b) {
            throw new Error(`la copia di ${basename(src)} non corrisponde all'originale`);
          }
          copied.push({ from: src, to: dest, sha256: a, bytes: statSync(dest).size });
        }
        writeFileSync(
          join(backupDir, 'crateforge-backup.json'),
          JSON.stringify({ kind: 'masterdb', at: new Date().toISOString(), files: copied }, null, 2),
          'utf-8'
        );
      } catch (err) {
        logOperation(db, 'masterdb.backup', backupDir, 'error', String(err));
        return { ok: false, message: `Backup del database non riuscito, scrittura annullata: ${String(err)}` };
      }
      logOperation(db, 'masterdb.backup', backupDir, 'ok', `${basename(masterDbPath)} + options.json (hash verificati)`);

      const idsFile = writeTempJson('content-ids', contentIds);
      let r;
      try {
        r = await runSidecarJob('masterdb-create-playlist', 'masterdb-playlist', [
          '--master-db',
          masterDbPath,
          '--playlist-name',
          playlistName,
          '--content-ids-file',
          idsFile
        ]);
      } finally {
        rmSync(idsFile, { force: true });
      }
      if (!r.ok) {
        logOperation(db, 'masterdb.createPlaylist', masterDbPath, 'error', r.message);
        return { ok: false, message: r.message, backupDir };
      }
      logOperation(
        db,
        'masterdb.createPlaylist',
        masterDbPath,
        'ok',
        `SCRITTURA DIRETTA: playlist "${playlistName}", ${JSON.stringify(r.data)}`
      );
      return { ok: true, ...r.data, backupDir, requested: trackIds.length };
    }
  );

  // ---- Report SIAE (cronologia riproduzioni da Rekordbox) ----
  ipcMain.handle('siae:readHistory', async (_e, masterDbPath: string) => {
    const check = checkSidecar();
    if (!check.available) {
      return { ok: false, message: 'Il modulo di lettura del database non è disponibile.' };
    }
    const r = await runSidecarJob('read-history', 'read-history', ['--master-db', masterDbPath]);
    logOperation(db, 'siae.readHistory', masterDbPath, r.ok ? 'ok' : 'error', r.ok ? JSON.stringify(r.data) : r.message);
    return r.ok ? { ok: true, ...r.data } : { ok: false, message: r.message };
  });
  ipcMain.handle('siae:sessions', () => listHistorySessions(db));
  ipcMain.handle(
    'siae:export',
    async (_e, sessionId: string, outPath: string, venue?: string, eventDate?: string) => {
      const r = await exportSiaeReport(db, { sessionId, outPath, venue, eventDate });
      logOperation(db, 'siae.export', outPath, 'ok', `${r.rows} brani`);
      return r;
    }
  );

  // ---- Set Planner (§6 Fase 3.2, read-only) ----
  ipcMain.handle('planner:playlists', () => listPlaylists(db));
  ipcMain.handle('planner:analyze', (_e, playlistId: number) => {
    const r = analyzePlaylist(db, playlistId);
    logOperation(
      db,
      'planner.analyze',
      String(playlistId),
      'ok',
      `${r.transitions.length} transizioni, ${r.problems} problematiche`
    );
    return r;
  });

  // ---- dialoghi file ----
  // Il parent va preso dal sender (finestra chiamante), con fallback su win();
  // se manca del tutto si apre un dialog senza parent (comunque valido).
  const dialogParent = (e: Electron.IpcMainInvokeEvent): BrowserWindow | undefined =>
    BrowserWindow.fromWebContents(e.sender) ?? win();
  ipcMain.handle(
    'dialog:openFile',
    async (e, filters?: { name: string; extensions: string[] }[], defaultPath?: string) => {
      const parent = dialogParent(e);
      // defaultPath pre-punta il dialog: se è un file esistente viene pre-selezionato,
      // se è una cartella la apre direttamente (es. la cartella Rekordbox dell'utente).
      const opts = { properties: ['openFile'] as ('openFile')[], filters, defaultPath };
      const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? null : r.filePaths[0];
    }
  );
  ipcMain.handle('dialog:openDirectory', async (e) => {
    const parent = dialogParent(e);
    const opts = { properties: ['openDirectory'] as ('openDirectory')[] };
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:saveFile', async (e, defaultName: string, filters?: { name: string; extensions: string[] }[]) => {
    const parent = dialogParent(e);
    const opts = { defaultPath: defaultName, filters };
    const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
    return r.canceled ? null : r.filePath;
  });

  // Cleanup per la chiusura ordinata (index.ts, before-quit): ferma il daemon
  // di sorveglianza e annulla un eventuale job sidecar in corso.
  return () => {
    try {
      daemon.stop();
    } catch {
      /* best-effort */
    }
    currentCancel?.();
  };
}
