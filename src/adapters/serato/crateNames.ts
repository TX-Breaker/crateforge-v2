import type BetterSqlite3 from 'better-sqlite3';

/**
 * Nomi dei crate Serato ≤3, con la gerarchia dentro il nome.
 *
 * ⚠ In Serato i crate annidati NON sono sottocartelle. `Subcrates/` è piatta, e
 * la gerarchia sta nel nome del file, con `%%` come separatore di livello:
 *
 *   Genere%%House%%Deep.crate   →   Genere › House › Deep
 *
 * Un writer che crei sottocartelle vere produce un albero che Serato non vede;
 * uno che scriva solo la foglia (`Deep.crate`) appiattisce la libreria e, se
 * due cartelle diverse contengono un crate omonimo, ne perde uno.
 *
 * Il lettore di questo progetto decodifica già `%%`. Finché il writer non lo
 * produceva, il round-trip non chiudeva: si importava un albero e se ne
 * riesportava un elenco piatto.
 */

export const SUBCRATE_SEPARATOR = '%%';

interface PlaylistNode {
  id: number;
  name: string;
  parent_id: number | null;
  is_folder: number;
}

/**
 * Percorso completo di una playlist, dai suoi antenati alla foglia.
 *
 * I cicli nell'albero non dovrebbero esistere — `parent_id` ha una foreign key
 * su `playlists(id)` — ma un database riparato a mano può contenerne, e una
 * ricorsione infinita qui bloccherebbe l'export senza dire perché. La guardia
 * costa un `Set`.
 */
export function playlistPath(nodes: Map<number, PlaylistNode>, id: number): string[] {
  const parts: string[] = [];
  const seen = new Set<number>();
  let current: number | null = id;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const node: PlaylistNode | undefined = nodes.get(current);
    if (!node) break;
    parts.unshift(node.name);
    current = node.parent_id;
  }
  return parts;
}

/**
 * Nome del crate per una playlist, gerarchia compresa.
 *
 * ⚠ I `%` presenti nei nomi originali vengono sostituiti con `_`. Non è
 * pignoleria: un crate chiamato «Sconti 50%» produrrebbe `Sconti 50%.crate`, e
 * uno chiamato «Sconti 50%%House» sarebbe indistinguibile da un annidamento.
 * Meglio un carattere alterato in un nome che una gerarchia inventata.
 */
export function crateNameFor(nodes: Map<number, PlaylistNode>, id: number): string {
  return playlistPath(nodes, id)
    .map((part) => part.replace(/%/g, '_').trim())
    .filter(Boolean)
    .join(SUBCRATE_SEPARATOR);
}

/** Albero delle playlist, indicizzato per id. */
export function loadPlaylistTree(db: BetterSqlite3.Database): Map<number, PlaylistNode> {
  const rows = db
    .prepare(`SELECT id, name, parent_id, is_folder FROM playlists`)
    .all() as PlaylistNode[];
  return new Map(rows.map((r) => [r.id, r]));
}
