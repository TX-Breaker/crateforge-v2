import {
  applyChanges,
  findTag,
  getAttr,
  meaningful,
  replaceTag,
  textOf,
  type AttrChange,
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
  const changes: AttrChange[] = [];
  if ('title' in v) changes.push(['Title', textOf(v.title)]);
  if ('artist' in v) changes.push(['Author', textOf(v.artist)]);
  if ('album' in v) changes.push(['Album', textOf(v.album)]);
  if ('genre' in v) changes.push(['Genre', textOf(v.genre)]);
  if ('year' in v) changes.push(['Year', v.year != null ? String(v.year) : '']);
  if ('musicalKey' in v) changes.push(['Key', textOf(v.musicalKey)]);

  const tags = findTag(block, 'Tags');
  if ('bpm' in v && v.bpm != null && v.bpm > 0) {
    const current = tags ? Number(getAttr(tags.tag, 'Bpm')) : NaN;
    const inBpm = Number.isFinite(current) && current >= 10;
    const bpm = v.bpm;
    /* Stesso formato di quello presente, e confronto sul tempo, non sul testo. */
    changes.push([
      'Bpm',
      inBpm ? bpm.toFixed(6) : (60 / bpm).toFixed(6),
      (cur) => {
        const n = Number(cur);
        const asBpm = n >= 10 ? n : n > 0 ? 60 / n : NaN;
        return Math.abs(asBpm - bpm) < 0.001;
      }
    ]);
  }
  if (changes.length === 0) return block;

  /* Tonalità e tempo che il lettore prende da `Scan` (perché mancano in Tags)
     non sono una modifica: ricopiarli aggiungerebbe attributi che nessuno ha
     chiesto. Si scrivono solo se il valore è davvero diverso. */
  const scan = findTag(block, 'Scan');
  const fromScan = (name: string, value: string, same?: (c: string) => boolean) => {
    const cur = scan ? getAttr(scan.tag, name) : undefined;
    return cur !== undefined && (same ? same(cur) : cur === value);
  };
  const derived = ([n, val, same]: AttrChange) =>
    (n === 'Key' || n === 'Bpm') && (!tags || getAttr(tags.tag, n) === undefined) && fromScan(n, val, same);
  const real = changes.filter((c) => !derived(c));

  if (tags) return replaceTag(block, tags, applyChanges(tags.tag, real));

  // Nessun Tags: lo si crea solo se c'è un valore vero da metterci.
  const useful = meaningful(real);
  if (useful.length === 0) return block;
  const t = applyChanges('<Tags />', useful);
  if (selfClosing) {
    // <Song ... /> → <Song ...><Tags .../></Song>
    return block.replace(/\s*\/>$/, `>${t}</Song>`);
  }
  const song = findTag(block, 'Song')!;
  return block.slice(0, song.end) + t + block.slice(song.end);
}
