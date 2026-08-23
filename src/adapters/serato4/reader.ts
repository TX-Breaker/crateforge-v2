import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import type { ForeignLibrary, NormPlaylist, NormTrack } from '@core/foreignImport';

/**
 * Lettura della libreria Serato DJ Pro 4.
 *
 * ⚠ Serato 4 NON è un database di tracce: è un grafo. Un crate non contiene
 * brani, contiene coppie (brano, spazio):
 *
 *   container ──< location_container ──< container_asset >── space_asset >── asset
 *                                                                  │
 *                                                                space
 *
 * `container_asset` punta a `space_asset`, non ad `asset`. Chi cerca la tabella
 * delle tracce dentro un crate non la trova, e chi salta `space_asset` in
 * scrittura ottiene un crate che Serato apre vuoto.
 *
 * ⚠ L'identità di un asset è `(location_id, portable_id)`, NON il percorso: il
 * percorso vive in `location`, e più asset possono condividerlo. È l'unica
 * chiave stabile fra macchine diverse, e va conservata per poter riscrivere
 * invece di reinserire.
 *
 * Le colonne di `asset` oltre alle prime non sono documentate — il DDL
 * pubblicato è troncato. Invece di indovinare nomi, questo lettore CHIEDE al
 * database quali colonne esistono e usa solo quelle che trova: su
 * un'installazione con colonne diverse perde campi, non fallisce.
 */

/**
 * Colonne che ci interessano, in ordine di preferenza per ciascun campo.
 *
 * ⚠ I nomi confermati su una libreria reale (schema `user_version` 202) vengono
 * per primi. Il resto della lista è ripiego per versioni con nomi diversi:
 * lo schema di Serato 4 cambia fra le versioni — la tabella `migration_script`
 * ne conserva la storia — ed è la ragione per cui questo lettore chiede al
 * database quali colonne esistono invece di darle per scontate.
 *
 * ⚠ Il titolo sta in `name`, non in `title`: `title` non esiste affatto.
 * ⚠ La durata sta in `length_ms`. Esiste anche `length_sec`, ma su una libreria
 * reale è vuota su tutte le 114 tracce: cercarla per prima significa importare
 * zero durate senza accorgersene.
 */
const CANDIDATE_COLUMNS: Record<string, string[]> = {
  title: ['name', 'title', 'song'],
  artist: ['artist'],
  album: ['album'],
  genre: ['genre'],
  year: ['year'],
  bpm: ['bpm', 'tempo'],
  key: ['key', 'musical_key', 'initial_key'],
  durationMs: ['length_ms'],
  durationSec: ['length_sec', 'length', 'duration', 'total_time'],
  comment: ['comments', 'comment'],
  color: ['color'],
  rating: ['rating'],
  label: ['label'],
  remixer: ['remixer'],
  composer: ['composer'],
  grouping: ['grouping'],
  trackNumber: ['track_number'],
  fileName: ['file_name'],
  fileSize: ['file_size'],
  bitRate: ['file_bit_rate'],
  // Campi che Serato porta e il modello interno non normalizza: finiscono
  // nella sacca, per non perderli a ogni conversione.
  beatgridLocked: ['is_beatgrid_locked'],
  stale: ['is_stale'],
  playCount: ['dj_play_count']
};

function columnsOf(db: BetterSqlite3.Database, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

/** Prima colonna candidata che esiste davvero, o null. */
function pick(available: Set<string>, candidates: string[]): string | null {
  return candidates.find((c) => available.has(c)) ?? null;
}

interface RawAsset {
  id: number;
  location_id: number | null;
  portable_id: string | null;
  location_path: string | null;
  [k: string]: unknown;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
  return s.length ? s : null;
};

export interface Serato4ReadResult extends ForeignLibrary {
  /** Quanti crate sono stati saltati perché vuoti o non riconducibili a brani. */
  emptyContainers: number;
}

export function readSerato4Library(masterPath: string): Serato4ReadResult {
  // Sola lettura, sempre: questo modulo non ha alcun motivo di poter scrivere.
  const db = new Database(masterPath, { readonly: true, fileMustExist: true });
  try {
    return readFrom(db);
  } finally {
    db.close();
  }
}

export function readFrom(db: BetterSqlite3.Database): Serato4ReadResult {
  const warnings: string[] = [];
  const assetCols = columnsOf(db, 'asset');
  if (assetCols.size === 0) {
    throw new Error(
      "Questo database non ha una tabella 'asset': non è una libreria Serato 4."
    );
  }

  const chosen: Record<string, string | null> = {};
  for (const [field, candidates] of Object.entries(CANDIDATE_COLUMNS)) {
    chosen[field] = pick(assetCols, candidates);
  }
  const mancanti = Object.entries(chosen)
    .filter(([, col]) => col === null)
    .map(([field]) => field);
  if (mancanti.length) {
    warnings.push(
      `Campi non presenti in questa versione di Serato 4 e quindi non importati: ${mancanti.join(', ')}.`
    );
  }

  const select: string[] = ['a.id AS id', 'a.location_id AS location_id'];
  select.push(assetCols.has('portable_id') ? 'a.portable_id AS portable_id' : 'NULL AS portable_id');
  for (const [field, col] of Object.entries(chosen)) {
    if (col) select.push(`a."${col}" AS "${field}"`);
  }

  /* `location.path` più `file_name` danno il percorso completo. La location può
     mancare (drive scollegato): in quel caso resta il solo nome del file, ed è
     comunque meglio di niente — l'identità canonica lo userà come indizio. */
  const hasLocation = columnsOf(db, 'location').has('path');
  const sql = `
    SELECT ${select.join(', ')}${hasLocation ? ', l.path AS location_path' : ', NULL AS location_path'}
      FROM asset a
      ${hasLocation ? 'LEFT JOIN location l ON l.id = a.location_id' : ''}`;

  const rows = db.prepare(sql).all() as RawAsset[];

  const tracks: NormTrack[] = [];
  const sourceIdByAsset = new Map<number, string>();

  for (const r of rows) {
    /* L'identità stabile è `(location_id, portable_id)`. Quando `portable_id` è
       vuoto — succede sugli asset non ancora consolidati — si ripiega sull'id
       numerico, che è stabile dentro QUESTA libreria ma non fra macchine.
       Meglio un'identità locale che nessuna: senza, il brano non si può
       riesportare. */
    const portable = str(r.portable_id);
    const sourceId = portable
      ? `${r.location_id ?? 0}:${portable}`
      : `asset:${r.id}`;
    sourceIdByAsset.set(r.id, sourceId);

    const fileName = str(r.fileName);
    const base = str(r.location_path);
    const path = base && fileName ? joinPath(base, fileName) : (fileName ?? null);

    tracks.push({
      sourceId,
      title: str(r.title),
      artist: str(r.artist),
      album: str(r.album),
      genre: str(r.genre),
      year: num(r.year),
      bpm: num(r.bpm),
      musicalKey: str(r.key),
      /* La durata ha DUE colonne possibili e una sola è valorizzata. Si prende
         quella in millisecondi quando c'è, senza euristiche sulla grandezza del
         numero: il nome della colonna dice già l'unità. */
      durationS: (() => {
        const ms = num(r.durationMs);
        if (ms !== null) return ms / 1000;
        return num(r.durationSec);
      })(),
      path,
      filesize: num(r.fileSize),
      cues: [],
      rating: num(r.rating),
      /* Conservare l'identità nativa è ciò che permette di RISCRIVERE invece di
         reinserire: senza, un export tornerebbe indietro creando doppioni. */
      formatData: {
        assetId: r.id,
        locationId: r.location_id,
        portableId: portable,
        locationPath: base,
        ...(num(r.playCount) !== null ? { playCount: num(r.playCount) } : {}),
        ...(r.beatgridLocked ? { beatgridLocked: true } : {}),
        ...(r.stale ? { stale: true } : {}),
        ...(str(r.label) ? { label: str(r.label) } : {}),
        ...(str(r.remixer) ? { remixer: str(r.remixer) } : {}),
        ...(str(r.composer) ? { composer: str(r.composer) } : {}),
        ...(str(r.grouping) ? { grouping: str(r.grouping) } : {}),
        ...(str(r.comment) ? { comment: str(r.comment) } : {})
      },
      trackColor: null
    });
  }

  const { playlists, empty } = readContainers(db, sourceIdByAsset, warnings);

  /* ⚠ I cue di Serato 4 non stanno in questo database: restano nei tag dei file
     audio, come in Serato ≤3. Dirlo qui evita che un import "riuscito" con zero
     cue sembri una perdita di dati. */
  warnings.push(
    'I cue non sono in master.sqlite: per averli, importa anche i tag dei file audio.'
  );

  return {
    source: 'serato',
    formatNamespace: 'serato4',
    tracks,
    playlists,
    warnings,
    emptyContainers: empty
  };
}

function joinPath(base: string, file: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return base.endsWith(sep) ? base + file : base + sep + file;
}

function readContainers(
  db: BetterSqlite3.Database,
  sourceIdByAsset: Map<number, string>,
  warnings: string[]
): { playlists: NormPlaylist[]; empty: number } {
  const containerCols = columnsOf(db, 'container');
  if (containerCols.size === 0) return { playlists: [], empty: 0 };

  const containers = db
    .prepare(
      `SELECT id, parent_id, name, ${containerCols.has('list_order') ? 'list_order' : '0 AS list_order'}
         FROM container ORDER BY parent_id, list_order`
    )
    .all() as { id: number; parent_id: number | null; name: string; list_order: number }[];

  /* ⚠ `container.type` distingue crate, smart crate e cartelle, ma i valori
     dell'enum non sono documentati. Invece di indovinarli si guarda il fatto:
     un container che ha altri container come figli è una cartella. È una
     deduzione, non una lettura — e se sbaglia, sbaglia mostrando una cartella
     vuota, non perdendo brani. */
  const hasChildren = new Set(containers.map((c) => c.parent_id).filter((p): p is number => p !== null));

  const membership = readMembership(db, warnings);

  const playlists: NormPlaylist[] = [];
  let empty = 0;

  for (const c of containers) {
    const isFolder = hasChildren.has(c.id);
    const assetIds = membership.get(c.id) ?? [];
    const trackSourceIds = assetIds
      .map((a) => sourceIdByAsset.get(a))
      .filter((s): s is string => s !== undefined);

    if (!isFolder && trackSourceIds.length === 0) {
      empty++;
      continue;
    }

    playlists.push({
      sourceId: `container:${c.id}`,
      name: c.name,
      isFolder,
      parentSourceId: c.parent_id !== null ? `container:${c.parent_id}` : null,
      trackSourceIds
    });
  }

  return { playlists, empty };
}

/**
 * Appartenenza crate → asset, seguendo la catena completa.
 *
 * ⚠ Il join passa per `space_asset`: `container_asset.asset_id` esiste, ma è la
 * colonna `space_asset_id` a definire davvero l'appartenenza. Fidarsi della
 * prima e ignorare la seconda funziona finché l'utente ha un solo spazio, e
 * smette di funzionare esattamente quando serve.
 */
function readMembership(
  db: BetterSqlite3.Database,
  warnings: string[]
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  try {
    const rows = db
      .prepare(
        `SELECT lc.container_id AS container_id, sa.asset_id AS asset_id
           FROM container_asset ca
           JOIN location_container lc ON lc.id = ca.location_container_id
           JOIN space_asset sa        ON sa.id = ca.space_asset_id
          ORDER BY lc.container_id, ca.list_order`
      )
      .all() as { container_id: number; asset_id: number }[];
    for (const r of rows) {
      const list = out.get(r.container_id);
      if (list) list.push(r.asset_id);
      else out.set(r.container_id, [r.asset_id]);
    }
  } catch (err) {
    /* Se lo schema non ha la forma attesa si perdono le playlist, non i brani:
       vale la pena continuare dicendolo, invece di far fallire tutto l'import. */
    warnings.push(
      `Crate non letti (lo schema di questa versione non corrisponde): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return out;
}
