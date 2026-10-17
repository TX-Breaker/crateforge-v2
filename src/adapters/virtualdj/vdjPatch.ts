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
 * Aggiorna sul posto `database.xml` di VirtualDJ.
 *
 * La chiave è `Song@FilePath`, la stessa con cui il lettore importa il brano.
 * Campi: Tags@Title, @Author, @Album, @Genre, @Year, @Key, @Bpm.
 *
 * ⚠ Il tempo in `Tags@Bpm` si scrive NEL FORMATO CHE C'È GIÀ. VirtualDJ lo
 * conserva come secondi per battito (0,46875 = 128 BPM), ma il lettore accetta
 * anche il valore in BPM: se il file usa uno dei due, si continua con quello.
 * Dove manca si usano i secondi per battito, come scrive l'analisi di VirtualDJ.
 * `Scan` non si tocca: è il risultato dell'analisi audio, non una scelta
 * dell'utente, e accoppiato a un tempo diverso sposterebbe la griglia.
 */
export function patchVirtualDjXml(xml: string, updates: Map<string, LiveValues>): PatchResult {
  const found = new Set<string>();
  let patched = 0;

  const text = xml.replace(/<Song\b[^>]*?(?:\/>|>[\s\S]*?<\/Song>)/g, (block) => {
    const song = findTag(block, 'Song')!;
    const path = getAttr(song.tag, 'FilePath');
    if (!path) return block;
    const v = updates.get(path);
    if (!v) return block;
    found.add(path);
    patched++;
    return patchSong(block, song.tag.endsWith('/>'), v);
  });

  return {
    text,
    patched,
    missing: [...updates.keys()].filter((k) => !found.has(k))
  };
}

function patchSong(block: string, selfClosing: boolean, v: LiveValues): string {
  const attrs: [string, string][] = [];
  if ('title' in v) attrs.push(['Title', textOf(v.title)]);
  if ('artist' in v) attrs.push(['Author', textOf(v.artist)]);
  if ('album' in v) attrs.push(['Album', textOf(v.album)]);
  if ('genre' in v) attrs.push(['Genre', textOf(v.genre)]);
  if ('year' in v) attrs.push(['Year', v.year != null ? String(v.year) : '']);
  if ('musicalKey' in v) attrs.push(['Key', textOf(v.musicalKey)]);

  const tags = findTag(block, 'Tags');
  if ('bpm' in v && v.bpm != null && v.bpm > 0) {
    const current = tags ? Number(getAttr(tags.tag, 'Bpm')) : NaN;
    const inBpm = Number.isFinite(current) && current >= 10;
    attrs.push(['Bpm', inBpm ? v.bpm.toFixed(6) : (60 / v.bpm).toFixed(6)]);
  }
  if (attrs.length === 0) return block;

  if (tags) {
    let t = tags.tag;
    for (const [k, val] of attrs) t = setAttr(t, k, val);
    return replaceTag(block, tags, t);
  }
  let t = '<Tags />';
  for (const [k, val] of attrs) t = setAttr(t, k, val);
  if (selfClosing) {
    // <Song ... /> → <Song ...><Tags .../></Song>
    return block.replace(/\s*\/>$/, `>${t}</Song>`);
  }
  const song = findTag(block, 'Song')!;
  return block.slice(0, song.end) + t + block.slice(song.end);
}
