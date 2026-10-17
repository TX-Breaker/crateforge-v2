import type BetterSqlite3 from 'better-sqlite3';
import type { LiveValues } from '@adapters/livePatch';

/**
 * Aggiornamento dei metadati brano in Serato DJ Pro 4, sul posto.
 *
 * ⚠ Il database di Serato 4 ha DUE difese che questo modulo deve rispettare,
 * entrambe verificate sulla libreria reale (REA, ispezione `master.sqlite`
 * 2026-10-17, SHA-256 91a97508…):
 *
 * 1. TRIGGER CON FUNZIONI PRIVATE. Il trigger `after_asset_update` ricalcola
 *    TUTTE le colonne `_norm` (titolo, artista, album, genere, anno, tonalità,
 *    commenti, etichetta…) e `key_value` chiamando `serato_str_norm()` e
 *    `serato_raw_key_string_to_key_type()` — funzioni che Serato registra solo
 *    nella sua connessione. Da fuori, un UPDATE delle colonne testuali fallisce.
 *
 *    La via qui: registrare le due funzioni NELLA NOSTRA connessione, con le
 *    repliche verificate, e lasciare che il trigger di Serato faccia il suo
 *    lavoro. Il database non viene mai privato del suo trigger.
 *
 *    ⚠ La prima versione toglieva il trigger e scriveva a mano le colonne
 *    derivate: ne dimenticava una (`key_norm`), e un database senza trigger,
 *    anche per una transazione, è un rischio che non serve correre.
 *
 *    Le repliche: norm = NFD, via i combining marks, minuscole; key_value =
 *    minori 0-11 lungo le quinte dai bemolli (Abm…C#m), maggiori 12-23 (B…E).
 *    L'oracolo le confronta con OGNI valore già presente nella libreria prima
 *    di scrivere: una sola riga che non torna = niente scritture.
 *
 * 2. CACHE DI ORDINAMENTO. Le `anonymous_table_N` non si toccano (vedi
 *    `writer.ts`); per i metadati l'invalidazione passa da `updated_container`
 *    — la stessa coda che il trigger interno di Serato usa quando un brano
 *    entra in un crate. Limite dichiarato: le chiavi di ordinamento potrebbero
 *    restare vecchie finché Serato non ricostruisce la lista.
 *
 * `rating` arriva dall'UDM in 0-100 e va in `asset.rating` come REALE 0-1
 * (CHECK della tabella); `year` è TESTO; `bpm` è REALE. La tonalità si scrive
 * nella GRAFIA DI SERATO (Abm, Ebm, Bbm… F#m, C#m; B, F#, C#, Ab, Eb, Bb…),
 * ricavata dalla notazione Camelot: un «Dbm» di Rekordbox o un «G#m» di Engine
 * diventano «C#m» e «Abm», come li scriverebbe Serato stesso. Il colore NON si
 * scrive: l'enum di `asset.color` in Serato 4 non è stato verificato.
 */

export interface Serato4TrackPatchResult {
  patched: number;
  /** sourceId non risolti a un asset: non toccati. */
  missing: string[];
}

interface AssetRow {
  id: number;
  location_id: number | null;
  portable_id: string | null;
  name: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  key: string;
}

/** Minori 0-11 lungo il circolo delle quinte dai bemolli; è l'ordine reale. */
const MINOR_KEYS = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m'];
/** Maggiori 12-23, stesso circolo: B, F#, C#, Ab, Eb, Bb, F, C, G, D, A, E. */
const MAJOR_KEYS = ['B', 'F#', 'C#', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E'];
/** Enarmonici: Serato scrive i bemolli per Bb/Eb/Ab e i diesis altrove. */
const ENHARMONIC: Record<string, string> = {
  Db: 'C#', Dbm: 'C#m', Gb: 'F#', Gbm: 'F#m', 'G#m': 'Abm',
  'D#m': 'Ebm', 'A#m': 'Bbm', 'C#': 'Db', 'F#': 'Gb', 'G#': 'Ab', 'D#': 'Eb', 'A#': 'Bb'
};

/**
 * Replica di `serato_raw_key_string_to_key_type`. -1 = nessun tasto, come nel
 * default della colonna.
 */
export function seratoKeyValue(key: string | null | undefined): number {
  if (!key) return -1;
  const k = key.trim();
  for (const [table, base] of [
    [MINOR_KEYS, 0],
    [MAJOR_KEYS, 12]
  ] as const) {
    const idx = table.indexOf(k);
    if (idx >= 0) return base + idx;
    const alt = ENHARMONIC[k];
    if (alt != null) {
      const altIdx = table.indexOf(alt);
      if (altIdx >= 0) return base + altIdx;
    }
  }
  return -1;
}

/** Replica di `serato_str_norm`: NFD, via i combining marks, minuscole. */
export function seratoNorm(s: string | null | undefined): string {
  if (!s) return '';
  const folded = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return folded.toLowerCase();
}

function triggerSql(db: BetterSqlite3.Database): string | null {
  const r = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'after_asset_update'`)
    .get() as { sql: string } | undefined;
  return r?.sql ?? null;
}

/** Colonne testuali che il trigger normalizza, nell'elenco del trigger reale. */
const NORM_SOURCES = [
  'file_name', 'name', 'artist', 'album', 'genre', 'comments',
  'label', 'remixer', 'grouping', 'composer', 'year', 'key'
];

/** Grafia di Serato per una tonalità Camelot («12A» → «C#m»). */
export function seratoKeyName(camelot: string | null | undefined): string | null {
  const m = camelot ? /^(1[0-2]|[1-9])([AB])$/.exec(camelot) : null;
  if (!m) return null;
  return (m[2] === 'A' ? MINOR_KEYS : MAJOR_KEYS)[Number(m[1]) - 1];
}

/**
 * L'oracolo: le nostre repliche devono riprodurre OGNI valore già presente,
 * per ogni colonna normalizzata che questa versione dello schema ha. Una sola
 * riga che non torna significa che questo Serato normalizza diversamente:
 * scrivere, in quel caso, corromperebbe le colonne di ricerca.
 */
function verifyOracle(db: BetterSqlite3.Database): void {
  const cols = new Set((db.prepare(`PRAGMA table_info(asset)`).all() as { name: string }[]).map((c) => c.name));
  const pairs = NORM_SOURCES.filter((c) => cols.has(c) && cols.has(`${c}_norm`));
  const select = ['key', 'key_value', ...pairs.flatMap((c) => [c, `${c}_norm`])]
    .filter((c, i, a) => a.indexOf(c) === i)
    .join(', ');
  const rows = db.prepare(`SELECT ${select} FROM asset`).all() as Record<string, string | number | null>[];
  for (const r of rows) {
    const key = (r.key as string | null) ?? null;
    if (seratoKeyValue(key) !== ((r.key_value as number | null) ?? -1)) {
      throw new Error(
        `Verifica della libreria non superata: la tonalità "${key}" è codificata ` +
          `${r.key_value} ma la nostra tabella dà ${seratoKeyValue(key)}. Scrittura annullata.`
      );
    }
    for (const c of pairs) {
      const raw = (r[c] as string | null) ?? null;
      const norm = (r[`${c}_norm`] as string | null) ?? '';
      if (seratoNorm(raw) !== norm) {
        throw new Error(
          `Verifica della libreria non superata: la normalizzazione di ${c} non ` +
            `corrisponde a quella di Serato. Scrittura annullata.`
        );
      }
    }
  }
}

/** sourceId → asset id (`asset:<id>` oppure `<location>:<portable>`). */
function assetIdOf(db: BetterSqlite3.Database, sourceId: string): number | null {
  if (sourceId.startsWith('asset:')) {
    const id = Number(sourceId.slice('asset:'.length));
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  const sep = sourceId.indexOf(':');
  if (sep <= 0) return null;
  const locationId = Number(sourceId.slice(0, sep));
  const portable = sourceId.slice(sep + 1);
  if (!Number.isFinite(locationId) || !portable) return null;
  const r = db
    .prepare(`SELECT id FROM asset WHERE location_id = ? AND portable_id = ? LIMIT 1`)
    .get(locationId, portable) as { id: number } | undefined;
  return r?.id ?? null;
}

export function patchSerato4Tracks(
  db: BetterSqlite3.Database,
  byKey: Map<string, LiveValues>
): Serato4TrackPatchResult {
  if (!triggerSql(db)) {
    throw new Error(
      'Il trigger after_asset_update non è presente: questo database non sembra un ' +
        'master.sqlite di Serato 4 conosciuto. Scrittura rifiutata.'
    );
  }
  /* Le funzioni che il trigger di Serato chiama, registrate SOLO in questa
     connessione: il trigger resta quello di Serato e ricalcola da sé tutte le
     colonne derivate. */
  db.function('serato_str_norm', { deterministic: true }, (v: unknown) =>
    seratoNorm(v == null ? null : String(v))
  );
  db.function('serato_raw_key_string_to_key_type', { deterministic: true }, (v: unknown) =>
    seratoKeyValue(v == null ? null : String(v))
  );
  verifyOracle(db);

  const result: Serato4TrackPatchResult = { patched: 0, missing: [] };
  const touchedAssets: number[] = [];
  const getRow = db.prepare(
    `SELECT id, location_id, portable_id, name, artist, album, genre, year, key FROM asset WHERE id = ?`
  );

  const run = db.transaction(() => {
    for (const [sourceId, v] of byKey) {
      const assetId = assetIdOf(db, sourceId);
      const row = assetId === null ? undefined : (getRow.get(assetId) as AssetRow | undefined);
      if (!row) {
        result.missing.push(sourceId);
        continue;
      }
      const sets: string[] = [];
      const args: (string | number)[] = [];
      const put = (col: string, value: string | number) => {
        sets.push(`${col} = ?`);
        args.push(value);
      };
      if (v.title != null && v.title !== row.name) put('name', v.title);
      if (v.artist != null && v.artist !== row.artist) put('artist', v.artist);
      if (v.album != null && v.album !== row.album) put('album', v.album);
      if (v.genre != null && v.genre !== row.genre) put('genre', v.genre);
      if (v.year != null && String(v.year) !== row.year) put('year', String(v.year));
      if (v.bpm != null) put('bpm', Number(v.bpm.toFixed(2)));
      const keyName =
        seratoKeyName(v.camelot) ??
        (v.musicalKey && seratoKeyValue(v.musicalKey) >= 0
          ? seratoKeyName(camelotOfKeyValue(seratoKeyValue(v.musicalKey)))
          : null);
      if (keyName && keyName !== row.key) put('key', keyName);
      /* L'UDM normalizza 0-100; la tabella vuole un REALE 0-1 con CHECK. */
      if (v.rating != null) put('rating', Math.max(0, Math.min(1, v.rating / 100)));
      if (sets.length === 0) continue;
      put('time_modified', Math.floor(Date.now() / 1000));
      db.prepare(`UPDATE asset SET ${sets.join(', ')} WHERE id = ?`).run(...args, row.id);
      result.patched++;
      touchedAssets.push(row.id);
    }

    /* Le liste che contengono un brano toccato vanno segnate come da rivedere:
       è la stessa coda che i trigger interni di Serato usano. */
    if (touchedAssets.length > 0) {
      db.exec(
        `INSERT OR IGNORE INTO updated_container (container_id)
         SELECT DISTINCT lc.container_id
           FROM container_asset ca
           JOIN location_container lc ON lc.id = ca.location_container_id
          WHERE ca.asset_id IN (${touchedAssets.join(', ')})`
      );
    }
  });
  run();
  return result;
}

/** key_value di Serato → Camelot: minori 0-11 → 1A…12A, maggiori 12-23 → 1B…12B. */
function camelotOfKeyValue(kv: number): string | null {
  if (kv >= 0 && kv < 12) return `${kv + 1}A`;
  if (kv >= 12 && kv < 24) return `${kv - 11}B`;
  return null;
}
