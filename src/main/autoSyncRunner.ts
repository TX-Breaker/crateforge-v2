import type BetterSqlite3 from 'better-sqlite3';
import type { GuardedSoftware } from '@core/djVersions';
import { SOURCES_OF_SOFTWARE, syncPairs, type AutoSyncConfig } from '@core/autoSync';
import { applySync, planLibrarySync, type SyncOptions } from '@core/syncEngine';
import type { SyncField } from '@core/syncDiff';
import { toCamelot } from '@core/camelot';
import type { LiveValues } from '@adapters/livePatch';
import { mt } from './mainText';

/**
 * Un giro di sincronizzazione fra le librerie dei programmi, dall'inizio alla fine:
 *
 *   1. RILEGGE la libreria di ogni partecipante (sono tutti chiusi: il
 *      guardiano non parte altrimenti), così l'archivio parte da ciò che c'è
 *      davvero nei programmi e non dall'ultimo import fatto a mano.
 *   2. RICONCILIA nell'archivio, coppia per coppia (`syncPairs`).
 *   3. SCRIVE sul posto, nei programmi che hanno ricevuto qualcosa.
 *
 * ⚠ La regola che tiene insieme le tre fasi: CHI NON SI PUÒ SCRIVERE NON RICEVE.
 * Un programma che riceve un valore nell'archivio ma non nella sua libreria
 * (perché è di sola lettura, o il gate è spento, o la versione non è
 * collaudata) al giro dopo verrebbe riletto col valore VECCHIO, sembrerebbe
 * modificato, e in modalità simmetrica rimanderebbe quel valore vecchio a tutti
 * gli altri: la modifica dell'utente verrebbe annullata in silenzio. Quindi:
 *   - una destinazione non scrivibile esce dal giro, dicendo perché;
 *   - una coppia in cui A non è scrivibile diventa a senso unico A → B.
 *
 * Le dipendenze verso il mondo esterno sono iniettate: rileggere, sapere se si
 * può scrivere, scrivere. Il modulo resta provabile senza programmi DJ veri.
 */

export interface LiveRow {
  /** `tracks.source_id`: la chiave del brano nel formato del programma. */
  sourceId: string;
  path: string | null;
  values: LiveValues;
}

export interface WriteReport {
  written: number;
  missing: number;
  backup?: string | null;
}

export interface RunnerDeps {
  db: BetterSqlite3.Database;
  /** Rilegge la libreria del programma nell'archivio. */
  reimport: (software: GuardedSoftware) => Promise<{ ok: boolean; message?: string }>;
  /** `null` se si può scrivere ADESSO in quel programma, altrimenti il motivo. */
  canWrite: (software: GuardedSoftware) => Promise<string | null>;
  /** Scrive sul posto. Chiamato solo se `canWrite` ha detto sì. */
  write: (software: GuardedSoftware, rows: LiveRow[]) => Promise<WriteReport>;
}

export interface RunReport {
  source: GuardedSoftware;
  mode: AutoSyncConfig['mode'];
  /** Programmi riletti con successo. */
  reread: GuardedSoftware[];
  /** Programmi rimasti fuori, con il motivo. */
  excluded: { software: GuardedSoftware; reason: string }[];
  /** Brani allineati nell'archivio. */
  aligned: number;
  conflicts: number;
  /** Scritture nei programmi. */
  written: {
    software: GuardedSoftware;
    tracks: number;
    missing: number;
    backup?: string | null;
  }[];
  /** Campi scelti che nessun programma sa ricevere sul posto. */
  notPropagated: string[];
  /**
   * Che cosa cambia in ogni programma, campo per campo. In anteprima è ciò che
   * CAMBIEREBBE; dopo una scrittura è ciò che è cambiato.
   */
  planned: { software: GuardedSoftware; tracks: number; fields: Record<string, number> }[];
  /** Programmi in cui la scrittura non è riuscita: gli altri proseguono. */
  failed: { software: GuardedSoftware; message: string }[];
  /** true se era un'anteprima: niente è stato scritto, nemmeno nell'archivio. */
  dryRun: boolean;
}

/** Campi che gli scrittori sul posto sanno portare nei programmi. */
const LIVE_FIELDS: SyncField[] = ['title', 'artist', 'album', 'genre', 'year', 'bpm', 'musical_key'];

export async function runLibrarySync(
  deps: RunnerDeps,
  cfg: Pick<AutoSyncConfig, 'mode' | 'fields'>,
  source: GuardedSoftware,
  destinations: GuardedSoftware[],
  opts: { dryRun?: boolean } = {}
): Promise<RunReport> {
  const dryRun = opts.dryRun === true;
  const report: RunReport = {
    source,
    mode: cfg.mode,
    reread: [],
    excluded: [],
    aligned: 0,
    conflicts: 0,
    written: [],
    notPropagated: cfg.fields.filter((f) => !LIVE_FIELDS.includes(f as SyncField)),
    planned: [],
    failed: [],
    dryRun
  };
  const others = [...new Set(destinations.filter((d) => d !== source))];

  /* 1. Rilettura. Senza l'origine non c'è giro: l'errore risale, e il guardiano
     tiene la chiusura in coda per riprovare. */
  const src = await deps.reimport(source);
  if (!src.ok) throw new Error(mt('run.sourceReread', { app: source, msg: src.message ?? '' }));
  report.reread.push(source);

  const writable = new Map<GuardedSoftware, boolean>();
  const live: GuardedSoftware[] = [];
  for (const d of others) {
    const r = await deps.reimport(d);
    if (!r.ok) {
      report.excluded.push({
        software: d,
        reason: mt('ex.reread', { msg: r.message ?? '' })
      });
      continue;
    }
    report.reread.push(d);
    const why = await deps.canWrite(d);
    if (why) {
      report.excluded.push({ software: d, reason: why });
      continue;
    }
    writable.set(d, true);
    live.push(d);
  }
  writable.set(source, (await deps.canWrite(source)) === null);

  /* 2. Riconciliazione.

     ⚠ Una libreria che non si può scrivere NON COMANDA MAI in modalità alla
     pari. Prima la coppia diventava a senso unico «A → B» quando A non era
     scrivibile: al primo allineamento, con Rekordbox primo della lista, i suoi
     BPM e le sue tonalità hanno sostituito quelli degli altri programmi
     ovunque fossero diversi — raddoppi e dimezzamenti di tempo compresi. Ora la
     coppia resta simmetrica (le differenze senza una storia diventano conflitti
     da decidere) e si toglie soltanto ciò che andrebbe verso A. */
  const touched = new Map<GuardedSoftware, Set<number>>();
  const counts = new Map<GuardedSoftware, Record<string, number>>();
  const mark = (s: GuardedSoftware, id: number, fields: string[]) => {
    if (!touched.has(s)) touched.set(s, new Set());
    touched.get(s)!.add(id);
    const c = counts.get(s) ?? {};
    for (const f of fields) c[f] = (c[f] ?? 0) + 1;
    counts.set(s, c);
  };

  /* In anteprima tutto avviene dentro un punto di ripristino annullato alla
     fine: i numeri sono quelli veri del giro, due passate comprese, ma
     l'archivio resta com'era e nessun programma viene toccato. */
  if (dryRun) deps.db.exec('SAVEPOINT cf_sync_preview');
  try {
    for (const pair of syncPairs(cfg.mode, source, live)) {
      const syncOpts: SyncOptions = {
        aSources: SOURCES_OF_SOFTWARE[pair.a],
        bSources: SOURCES_OF_SOFTWARE[pair.b],
        mode: pair.mode,
        fields: cfg.fields as SyncField[]
      };
      const plan = planLibrarySync(deps.db, syncOpts);
      if (!writable.get(pair.a)) {
        for (const p of plan.pairs) p.plan.toA = {};
      }
      const r = applySync(deps.db, plan, syncOpts);
      report.aligned += r.written;
      report.conflicts += r.conflicts;
      for (const p of plan.pairs) {
        const toA = Object.keys(p.plan.toA);
        const toB = Object.keys(p.plan.toB);
        if (toA.length) mark(pair.a, p.aId, toA);
        if (toB.length) mark(pair.b, p.bId, toB);
      }
    }
  } finally {
    if (dryRun) {
      deps.db.exec('ROLLBACK TO cf_sync_preview');
      deps.db.exec('RELEASE cf_sync_preview');
    }
  }
  for (const [software, ids] of touched) {
    report.planned.push({ software, tracks: ids.size, fields: counts.get(software) ?? {} });
  }
  if (dryRun) return report;

  /* 3. Scrittura sul posto. Un programma che fallisce non ferma gli altri:
     il suo errore finisce nel resoconto. */
  const fields = cfg.fields.filter((f): f is SyncField => LIVE_FIELDS.includes(f as SyncField));
  for (const [software, ids] of touched) {
    if (!writable.get(software)) continue; // per costruzione: un non scrivibile non riceve
    const rows = loadRows(deps.db, [...ids], fields);
    if (rows.length === 0) continue;
    try {
      const w = await deps.write(software, rows);
      report.written.push({ software, tracks: w.written, missing: w.missing, backup: w.backup });
    } catch (err) {
      report.failed.push({ software, message: String((err as Error).message ?? err) });
    }
  }
  return report;
}

/** Le righe da scrivere, con i soli campi scelti. */
export function loadRows(db: BetterSqlite3.Database, ids: number[], fields: SyncField[]): LiveRow[] {
  const get = db.prepare(
    `SELECT source_id, path, title, artist, album, genre, year, bpm, musical_key FROM tracks WHERE id = ?`
  );
  const out: LiveRow[] = [];
  for (const id of ids) {
    const r = get.get(id) as Record<string, unknown> | undefined;
    if (!r || r.source_id == null) continue;
    const v: LiveValues = {};
    for (const f of fields) {
      if (f === 'musical_key') {
        v.musicalKey = (r.musical_key as string | null) ?? null;
        v.camelot = toCamelot((r.musical_key as string | null) ?? null);
      } else {
        (v as Record<string, unknown>)[f] = r[f] ?? null;
      }
    }
    out.push({
      sourceId: String(r.source_id),
      path: (r.path as string | null) ?? null,
      values: v
    });
  }
  return out;
}
