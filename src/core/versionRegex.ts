/**
 * Estrae l'etichetta di "versione" (Remix, Mashup, Bootleg, Extended…) dal
 * filename o dal titolo quando il tag dedicato manca.
 */
const VERSION_KEYWORDS = [
  'extended mix',
  'extended version',
  'extended edit',
  'extended',
  'radio edit',
  'radio mix',
  'club mix',
  'club edit',
  'original mix',
  'vocal mix',
  'dub mix',
  'instrumental',
  'acapella',
  'a cappella',
  'remaster(?:ed)?(?:\\s+\\d{4})?',
  'bootleg',
  'mashup',
  'mash-up',
  'rework',
  'remix',
  'flip',
  'vip(?:\\s+mix)?',
  'edit',
  'refix',
  'intro(?:\\s+clean)?',
  'clean',
  'dirty'
] as const;

// (Artist Remix) / [Extended Mix] / - Radio Edit  a fine stringa
const BRACKETED = new RegExp(
  `[([]([^()\\[\\]]*?\\b(?:${VERSION_KEYWORDS.join('|')})\\b[^()\\[\\]]*?)[)\\]]`,
  'i'
);
const TRAILING = new RegExp(
  `[-–—]\\s*([^-–—]*?\\b(?:${VERSION_KEYWORDS.join('|')})\\b[^-–—]*?)\\s*$`,
  'i'
);

function tidy(label: string): string {
  return label
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Ritorna l'etichetta versione (es. "Extended Mix", "Meduza Remix") o null.
 * Accetta un titolo o un filename (l'estensione viene ignorata).
 */
export function extractVersionLabel(titleOrFilename: string): string | null {
  if (!titleOrFilename) return null;
  const base = titleOrFilename.replace(/\.[a-z0-9]{2,5}$/i, '');
  const bracketed = base.match(BRACKETED);
  if (bracketed) return tidy(bracketed[1]);
  const trailing = base.match(TRAILING);
  if (trailing) return tidy(trailing[1]);
  return null;
}
