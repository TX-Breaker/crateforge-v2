/**
 * Aggiornamento SUL POSTO delle librerie dei programmi DJ: strumenti comuni.
 *
 * ⚠ La regola che rende accettabile scrivere nella libreria viva di un altro
 * programma: non si rigenera il file. Si cambiano soltanto gli attributi dei
 * campi sincronizzati, nei brani che l'archivio conosce, e tutto il resto —
 * brani che non conosciamo, playlist, cue, attributi che non sappiamo leggere,
 * perfino la formattazione — resta byte per byte com'era. Rigenerare la
 * collezione di Traktor dall'archivio cancellerebbe ciò che l'archivio non ha.
 */

/** I campi che un giro può scrivere. Solo le chiavi PRESENTI vengono toccate. */
export interface LiveValues {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  year?: number | null;
  bpm?: number | null;
  /** Testo della tonalità come la conserva l'archivio (es. «Am», «8A»). */
  musicalKey?: string | null;
  /** La stessa tonalità in notazione Camelot, per i formati che la vogliono numerica. */
  camelot?: string | null;
  /** 0-100, la normalizzazione del modello interno (le stelle 0-5 vanno ×20). */
  rating?: number | null;
}

export interface PatchResult {
  /** Il contenuto aggiornato. */
  text: string;
  /** Brani trovati e aggiornati. */
  patched: number;
  /** Chiavi richieste che il file non contiene (brano rimosso dal programma). */
  missing: string[];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

/** Decodifica le entità XML di un valore d'attributo. */
export function xmlDecode(v: string): string {
  return v.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e];
  });
}

/** Codifica un valore per un attributo tra virgolette doppie. */
export function xmlEncode(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;');
}

/** Valore di un attributo in un tag d'apertura, decodificato; `undefined` se manca. */
export function getAttr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? xmlDecode(m[1]) : undefined;
}

/**
 * Imposta un attributo in un tag d'apertura (`<X a="1" ...>` o `<X ... />`).
 * Se c'è lo sostituisce al suo posto; se manca lo aggiunge in fondo.
 */
export function setAttr(tag: string, name: string, value: string): string {
  const enc = xmlEncode(value);
  const re = new RegExp(`(\\s${name}=")[^"]*(")`);
  if (re.test(tag)) return tag.replace(re, (_m, a: string, b: string) => `${a}${enc}${b}`);
  return tag.replace(/(\s*\/?>)$/, ` ${name}="${enc}"$1`);
}

/** Primo tag d'apertura con quel nome dentro un blocco: [inizio, fine) o null. */
export function findTag(block: string, name: string): { start: number; end: number; tag: string } | null {
  const m = new RegExp(`<${name}\\b[^>]*>`).exec(block);
  return m ? { start: m.index, end: m.index + m[0].length, tag: m[0] } : null;
}

/** Sostituisce un tag d'apertura dentro un blocco. */
export function replaceTag(block: string, at: { start: number; end: number }, tag: string): string {
  return block.slice(0, at.start) + tag + block.slice(at.end);
}

/** Testo per un campo testuale: `null` diventa stringa vuota, come scrivono i programmi. */
export const textOf = (v: string | null | undefined): string => v ?? '';

/**
 * Una modifica richiesta a un attributo: il nome, il valore nuovo e, se serve,
 * come confrontarlo con quello presente (di serie: uguaglianza del testo).
 */
export type AttrChange = [name: string, value: string, same?: (current: string) => boolean];

/**
 * Applica a un tag solo le modifiche che CAMBIANO qualcosa.
 *
 * ⚠ Riscrivere un attributo con un valore equivalente non è innocuo: Traktor
 * conserva la data completa («2001/6/15») dove noi conosciamo solo l'anno, e
 * un valore vuoto aggiunto dove l'attributo non c'era è una modifica che
 * nessuno ha chiesto. Si tocca solo ciò che è davvero diverso, e un valore
 * vuoto non crea un attributo che manca.
 */
export function applyChanges(tag: string, changes: AttrChange[]): string {
  let t = tag;
  for (const [name, value, same] of changes) {
    const current = getAttr(t, name);
    if (current === undefined) {
      if (value !== '') t = setAttr(t, name, value);
      continue;
    }
    if (same ? same(current) : current === value) continue;
    t = setAttr(t, name, value);
  }
  return t;
}

/** Le modifiche che creerebbero davvero qualcosa in un elemento che manca. */
export const meaningful = (changes: AttrChange[]): AttrChange[] => changes.filter(([, v]) => v !== '');

/** Due tempi uguali entro un millesimo di BPM. */
export const sameBpm = (bpm: number) => (cur: string) => Math.abs(Number(cur) - bpm) < 0.001;
