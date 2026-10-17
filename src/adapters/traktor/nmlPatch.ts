import { CAMELOT_TO_TRAKTOR } from './traktorKeys';
import {
  findTag,
  getAttr,
  replaceTag,
  setAttr,
  textOf,
  type LiveValues,
  type PatchResult
} from '../livePatch';

/**
 * Aggiorna sul posto `collection.nml` di Traktor.
 *
 * La chiave di ogni brano è VOLUME+DIR+FILE della sua LOCATION: è la stessa con
 * cui il lettore lo importa (`sourceId`) e con cui le playlist di Traktor lo
 * referenziano, quindi un brano si ritrova senza dipendere dal percorso
 * ricostruito.
 *
 * Campi: ENTRY@TITLE, ENTRY@ARTIST, ALBUM@TITLE, INFO@GENRE,
 * INFO@RELEASE_DATE, INFO@KEY, TEMPO@BPM, MUSICAL_KEY@VALUE. Un elemento che
 * manca si aggiunge solo se c'è un valore da metterci.
 *
 * ⚠ Non si toccano MODIFIED_DATE/MODIFIED_TIME: sono il segnale di modifica di
 * Traktor. Cambiarli farebbe sembrare il brano modificato DA Traktor al giro
 * successivo, e la sincronizzazione rimbalzerebbe avanti e indietro.
 */
export function patchTraktorNml(xml: string, updates: Map<string, LiveValues>): PatchResult {
  const found = new Set<string>();
  let patched = 0;

  const text = xml.replace(/<ENTRY\b[^>]*>[\s\S]*?<\/ENTRY>/g, (block) => {
    const loc = findTag(block, 'LOCATION');
    if (!loc) return block;
    const key = `${getAttr(loc.tag, 'VOLUME') ?? ''}${getAttr(loc.tag, 'DIR') ?? ''}${getAttr(loc.tag, 'FILE') ?? ''}`;
    const v = updates.get(key);
    if (!v) return block;
    found.add(key);
    patched++;
    /* Gli elementi mancanti vanno DOPO la LOCATION chiusa: inseriti subito
       dopo il tag d'apertura finirebbero dentro <LOCATION>…</LOCATION>. */
    const close = /^\s*<\/LOCATION>/.exec(block.slice(loc.end));
    return patchEntry(block, v, loc.end + (close ? close[0].length : 0));
  });

  return {
    text,
    patched,
    missing: [...updates.keys()].filter((k) => !found.has(k))
  };
}

function patchEntry(block: string, v: LiveValues, afterLocation: number): string {
  // Tag d'apertura di ENTRY: è sempre all'inizio del blocco.
  const entry = findTag(block, 'ENTRY')!;
  let tag = entry.tag;
  if ('title' in v) tag = setAttr(tag, 'TITLE', textOf(v.title));
  if ('artist' in v) tag = setAttr(tag, 'ARTIST', textOf(v.artist));
  const shift = tag.length - entry.tag.length;
  block = replaceTag(block, entry, tag);
  let insertAt = afterLocation + shift;

  /* Elementi figli: si aggiornano dove sono, o si inseriscono subito dopo
     LOCATION quando mancano e c'è qualcosa da scriverci. */
  const child = (name: string, attrs: [string, string][]) => {
    if (attrs.length === 0) return;
    const at = findTag(block, name);
    if (at) {
      let t = at.tag;
      for (const [k, val] of attrs) t = setAttr(t, k, val);
      block = replaceTag(block, at, t);
      if (at.start < insertAt) insertAt += t.length - at.tag.length;
    } else {
      let open = `<${name}>`;
      for (const [k, val] of attrs) open = setAttr(open, k, val);
      const t = `${open}</${name}>`;
      block = block.slice(0, insertAt) + t + block.slice(insertAt);
      insertAt += t.length;
    }
  };

  child('ALBUM', 'album' in v ? [['TITLE', textOf(v.album)]] : []);

  const info: [string, string][] = [];
  if ('genre' in v) info.push(['GENRE', textOf(v.genre)]);
  if ('year' in v) info.push(['RELEASE_DATE', v.year != null ? `${v.year}/1/1` : '']);
  if ('musicalKey' in v) info.push(['KEY', textOf(v.musicalKey)]);
  child('INFO', info);

  if ('bpm' in v && v.bpm != null && v.bpm > 0) child('TEMPO', [['BPM', v.bpm.toFixed(6)]]);

  if ('camelot' in v && v.camelot) {
    const idx = CAMELOT_TO_TRAKTOR[v.camelot];
    if (idx !== undefined) child('MUSICAL_KEY', [['VALUE', String(idx)]]);
  }
  return block;
}
