import type BetterSqlite3 from 'better-sqlite3';
import type { TrackRow } from '@core/udm';
import { DEST_CAPABILITY, resolveCues, type SyncMode } from '@core/sync';
import {
  appFromSource,
  audioKindOf,
  beatshiftSeconds,
  type BeatshiftApp,
  type BeatshiftCase,
  type Mp3Probe
} from '@core/beatshift';

export interface CueRow {
  id: number;
  track_id: number;
  cue_type: 'hot' | 'memory' | 'loop';
  cue_index: number | null;
  position_ms: number;
  length_ms: number | null;
  color: string | null;
  label: string | null;
  /** Sacca dei campi non normalizzati; vedi `core/formatData`. */
  data?: string;
}

export interface PlaylistRow {
  id: number;
  name: string;
  parent_id: number | null;
  is_folder: number;
  sort_order: number;
}

export interface ExportSelection {
  /** id playlist da esportare; vuoto = tutte */
  playlistIds?: number[];
  /** limita l'export ai brani/playlist di questa sorgente (per conversione X→Y);
   *  vuoto = tutta la libreria UDM (hub) */
  source?: string;
  /**
   * Sincronizzazione: i punti arrivano da un'altra libreria dello stesso brano,
   * con la regola di risoluzione dei conflitti. Assente = ogni riga porta i
   * propri.
   */
  sync?: SyncSelection;
  /**
   * Corregge lo scarto fra i decoder MP3 dei software (vedi `core/beatshift`).
   *
   * ⚠ SPENTO di serie, ed è una scelta: i valori sono misurati, non derivati,
   * e la tabella non è antisimmetrica. Chi lo accende lo fa per un export
   * preciso, dopo averne visto l'anteprima. Lo spostamento si applica solo a
   * ciò che si scrive: i cue nell'archivio interno restano quelli importati,
   * così andata e ritorno fra due software non accumulano deriva.
   */
  beatshift?: boolean;
}

/**
 * Correzione da applicare ai cue che un writer sta per scrivere.
 * `probe` classifica un MP3 dal percorso; va creato una volta per export.
 */
export interface BeatshiftContext {
  target: BeatshiftApp;
  probe: (path: string) => Mp3Probe | null;
}

/**
 * Sposta i cue di una riga dal tempo del software d'origine a quello del
 * destinatario.
 *
 * Il caso A–D si legge dal file. Se il file non c'è, o non è un MP3
 * leggibile, il caso resta ignoto e `beatshiftSeconds` restituisce 0: meglio
 * nessuna correzione che una a metà.
 */
export function applyBeatshift<T extends { position_ms: number }>(
  cues: T[],
  originSource: string | null,
  path: string | null,
  ctx: BeatshiftContext | null | undefined
): T[] {
  if (!ctx || cues.length === 0) return cues;
  const origin = appFromSource(originSource);
  if (!origin || origin === ctx.target) return cues;
  const kind = audioKindOf(path);
  if (kind === 'other') return cues;
  const mp3Case = kind === 'mp3' && path ? (ctx.probe(path)?.case ?? null) : null;
  const shiftMs = beatshiftSeconds({ origin, target: ctx.target, kind, mp3Case }) * 1000;
  if (shiftMs === 0) return cues;
  // Un cue non può finire prima dell'inizio del brano. La lunghezza dei loop
  // non cambia: si sposta il punto d'inizio, la fine lo segue.
  return cues.map((c) => ({ ...c, position_ms: Math.max(0, c.position_ms + shiftMs) }));
}

/** Limiti del canale XML Rekordbox (§4): da mostrare PRIMA di ogni export. */
export const REKORDBOX_XML_LIMITS = [
  "L'import XML aggiunge/aggiorna i brani ma NON rimuove nulla dalla collection.",
  'Vengono importate al massimo 8 hot cue per brano.',
  'I colori delle memory cue, i MyTag e le smartlist NON passano.',
  'I loop attivi NON passano.',
  "L'import finale in Rekordbox è manuale: dovrai cliccare tu 'Import to Collection'."
] as const;

const PAGE = 1000;

/** Itera i brani a pagine (mai tutta la libreria in un array). */
export function* iterateTracks(
  db: BetterSqlite3.Database,
  sel: ExportSelection
): Generator<TrackRow> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (sel.source) {
    conds.push('t.source = ?');
    params.push(sel.source);
  }
  if (sel.playlistIds && sel.playlistIds.length > 0) {
    conds.push(
      `t.id IN (SELECT track_id FROM playlist_tracks WHERE playlist_id IN (${sel.playlistIds
        .map(() => '?')
        .join(',')}))`
    );
    params.push(...sel.playlistIds);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM tracks t ${where}`).get(...params) as { c: number }
  ).c;
  const stmt = db.prepare(`SELECT t.* FROM tracks t ${where} ORDER BY t.id LIMIT ? OFFSET ?`);
  for (let offset = 0; offset < total; offset += PAGE) {
    for (const row of stmt.all(...params, PAGE, offset) as TrackRow[]) {
      yield row;
    }
  }
}

/**
 * Sincronizzazione richiesta per questo export: i punti non arrivano dalla riga
 * che si sta scrivendo, ma da un'altra libreria dello STESSO brano reale.
 */
export interface SyncSelection {
  /** valori di `tracks.source` da cui prendere i punti */
  originSources: string[];
  /** software che riceve, per sapere quanti pad ha e se sa retrocedere */
  destination: string;
  mode: SyncMode;
}

/** Esito dell'anteprima: che cosa farebbe la correzione, senza scrivere niente. */
export interface BeatshiftPreview {
  target: BeatshiftApp;
  /** Brani con almeno un cue nella selezione. */
  tracks: number;
  cues: number;
  /** Cue che verrebbero spostati. */
  shiftedCues: number;
  /** Brani per caso; `unknown` = MP3 non leggibile, `other` = formato senza frame informativo. */
  byCase: Record<'A' | 'B' | 'C' | 'D' | 'unknown' | 'other', number>;
  /** Spostamenti distinti, in millisecondi, con quanti cue ciascuno. */
  shifts: { ms: number; cues: number }[];
  /** Brani che vengono già dal software di destinazione: non si toccano. */
  sameApp: number;
}

/**
 * Anteprima della correzione per un export verso `target`.
 *
 * Considera i cue PROPRI di ogni riga, cioè quelli che un export senza
 * sincronizzazione scriverebbe. Serve a far vedere all'utente, prima di
 * accendere l'opzione, quanti punti si muovono e di quanto: una correzione di
 * decine di millisecondi su centinaia di cue non si accende sulla fiducia.
 */
export function previewBeatshift(
  db: BetterSqlite3.Database,
  sel: ExportSelection,
  target: BeatshiftApp,
  probe: (path: string) => Mp3Probe | null
): BeatshiftPreview {
  const out: BeatshiftPreview = {
    target,
    tracks: 0,
    cues: 0,
    shiftedCues: 0,
    byCase: { A: 0, B: 0, C: 0, D: 0, unknown: 0, other: 0 },
    shifts: [],
    sameApp: 0
  };
  const perShift = new Map<number, number>();
  const countCues = db.prepare(`SELECT COUNT(*) AS n FROM cues WHERE track_id = ?`);
  for (const t of iterateTracks(db, { source: sel.source, playlistIds: sel.playlistIds })) {
    const n = (countCues.get(t.id) as { n: number }).n;
    if (n === 0) continue;
    out.tracks++;
    out.cues += n;
    const origin = appFromSource(t.source);
    if (origin === target) {
      out.sameApp++;
      continue;
    }
    const kind = audioKindOf(t.path);
    let mp3Case: BeatshiftCase | null = null;
    if (kind === 'other') out.byCase.other++;
    else if (kind === 'mp3') {
      mp3Case = t.path ? (probe(t.path)?.case ?? null) : null;
      if (mp3Case) out.byCase[mp3Case]++;
      else out.byCase.unknown++;
    }
    const ms = Math.round(beatshiftSeconds({ origin, target, kind, mp3Case }) * 1000 * 10) / 10;
    if (ms !== 0) {
      out.shiftedCues += n;
      perShift.set(ms, (perShift.get(ms) ?? 0) + n);
    }
  }
  out.shifts = [...perShift.entries()]
    .map(([ms, cues]) => ({ ms, cues }))
    .sort((a, b) => b.cues - a.cues);
  return out;
}

export function getCuesForTrack(
  db: BetterSqlite3.Database,
  trackId: number,
  sync?: SyncSelection,
  shift?: BeatshiftContext | null
): CueRow[] {
  const info = (id: number) =>
    db.prepare(`SELECT source, path FROM tracks WHERE id = ?`).get(id) as
      | { source: string | null; path: string | null }
      | undefined;
  const me = shift ? info(trackId) : undefined;
  const own = applyBeatshift(
    db
      .prepare(`SELECT * FROM cues WHERE track_id = ? ORDER BY cue_type, cue_index, position_ms`)
      .all(trackId) as CueRow[],
    me?.source ?? null,
    me?.path ?? null,
    shift
  );
  if (!sync) return own;

  /* In sincronizzazione i punti arrivano dalla libreria di origine, per lo
     stesso brano reale: è per questo che esiste l'identità canonica. Se il
     brano non esiste nell'origine non c'è niente da portare, e la riga resta
     con i suoi punti — mai svuotata. */
  const originRows = db
    .prepare(
      `SELECT o.id FROM tracks o
         JOIN tracks d ON COALESCE(o.canonical_id, o.id) = COALESCE(d.canonical_id, d.id)
        WHERE d.id = ? AND o.id <> d.id
          AND o.source IN (${sync.originSources.map(() => '?').join(',')})`
    )
    .all(trackId, ...sync.originSources) as { id: number }[];
  if (originRows.length === 0) return own;

  const stmt = db.prepare(
    `SELECT * FROM cues WHERE track_id = ? ORDER BY cue_type, cue_index, position_ms`
  );
  /* Ogni riga d'origine si sposta dal SUO software: in una sincronizzazione
     da più librerie i punti possono arrivare da decoder diversi. Il file è
     lo stesso brano, quindi per il caso A–D vale anche il percorso della riga
     di destinazione se quella d'origine non ne ha uno. */
  const origin = originRows.flatMap((r) => {
    const o = shift ? info(r.id) : undefined;
    return applyBeatshift(
      stmt.all(r.id) as CueRow[],
      o?.source ?? null,
      o?.path ?? me?.path ?? null,
      shift
    );
  });
  const cap = DEST_CAPABILITY[sync.destination];
  if (!cap) return own;

  const resolved = resolveCues(origin, own, sync.mode, cap);
  // I writer leggono solo i campi del punto: id e track_id non servono loro.
  return resolved.cues.map((c, i) => ({
    id: -1 - i,
    track_id: trackId,
    cue_type: c.cue_type,
    cue_index: c.cue_index,
    position_ms: c.position_ms,
    length_ms: c.length_ms,
    color: c.color,
    label: c.label,
    data: c.data
  }));
}

export function getPlaylists(db: BetterSqlite3.Database, sel: ExportSelection): PlaylistRow[] {
  if (sel.playlistIds && sel.playlistIds.length > 0) {
    const q = `SELECT id, name, parent_id, is_folder, sort_order FROM playlists
               WHERE id IN (${sel.playlistIds.map(() => '?').join(',')}) ORDER BY sort_order`;
    return db.prepare(q).all(...sel.playlistIds) as PlaylistRow[];
  }
  if (sel.source) {
    return db
      .prepare(
        `SELECT id, name, parent_id, is_folder, sort_order FROM playlists WHERE source = ? ORDER BY sort_order`
      )
      .all(sel.source) as PlaylistRow[];
  }
  return db
    .prepare(`SELECT id, name, parent_id, is_folder, sort_order FROM playlists ORDER BY sort_order`)
    .all() as PlaylistRow[];
}

export function getPlaylistTrackIds(db: BetterSqlite3.Database, playlistId: number): number[] {
  return (
    db
      .prepare(`SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position`)
      .all(playlistId) as { track_id: number }[]
  ).map((r) => r.track_id);
}

/** C:\Music\a.mp3 → file://localhost/C:/Music/a.mp3 ; /Users/x/a.mp3 → file://localhost/Users/x/a.mp3 */
export function pathToLocation(p: string): string {
  const posix = p.replace(/\\/g, '/');
  const encoded = posix
    .split('/')
    // Il drive letter "C:" NON va percent-encodato (diventerebbe "C%3A" e
    // Rekordbox non risolverebbe il file su Windows all'import).
    .map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg).replace(/'/g, '%27')))
    .join('/');
  return `file://localhost/${encoded.replace(/^\//, '')}`;
}

/** Estensione file → 'Kind' Rekordbox (MP3 File, FLAC File, …). */
export function kindFromPath(p: string | null): string {
  const ext = (p?.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  const map: Record<string, string> = {
    mp3: 'MP3 File', flac: 'FLAC File', wav: 'WAV File', aiff: 'AIFF File',
    aif: 'AIFF File', m4a: 'M4A File', aac: 'AAC File', ogg: 'OGG File',
    alac: 'ALAC File', wma: 'WMA File'
  };
  return map[ext] ?? 'MP3 File';
}
