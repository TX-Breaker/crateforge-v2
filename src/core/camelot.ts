/**
 * Conversione tonalità → notazione Camelot.
 * Accetta notazione classica ("Am", "F# minor", "Dbm"), Open Key ("4d"/"4m")
 * e Camelot già pronta ("8A").
 */
const CAMELOT_MAJOR: Record<string, string> = {
  B: '1B', 'F#': '2B', GB: '2B', DB: '3B', 'C#': '3B', AB: '4B', 'G#': '4B',
  EB: '5B', 'D#': '5B', BB: '6B', 'A#': '6B', F: '7B', C: '8B', G: '9B',
  D: '10B', A: '11B', E: '12B',
  // enarmonici teorici rari ma validi
  CB: '1B', FB: '12B', 'E#': '7B', 'B#': '8B'
};
const CAMELOT_MINOR: Record<string, string> = {
  'G#': '1A', AB: '1A', 'D#': '2A', EB: '2A', 'A#': '3A', BB: '3A', F: '4A',
  C: '5A', G: '6A', D: '7A', A: '8A', E: '9A', B: '10A', 'F#': '11A',
  GB: '11A', 'C#': '12A', DB: '12A',
  CB: '10A', FB: '9A', 'E#': '4A', 'B#': '5A'
};

const CAMELOT_RE = /^([1-9]|1[0-2])\s*([AB])$/i;
const OPEN_KEY_RE = /^([1-9]|1[0-2])\s*([dm])$/i;
// Open Key: numero uguale, ma 1d = 8B (offset di 7).
function openKeyToCamelot(num: number, mode: 'd' | 'm'): string {
  const camelotNum = ((num + 6) % 12) + 1;
  return `${camelotNum}${mode === 'd' ? 'B' : 'A'}`;
}

export function toCamelot(key: string | null | undefined): string | null {
  if (!key) return null;
  const raw = key.trim();
  if (!raw) return null;

  const camelot = raw.match(CAMELOT_RE);
  if (camelot) return `${Number(camelot[1])}${camelot[2].toUpperCase()}`;

  const openKey = raw.match(OPEN_KEY_RE);
  if (openKey) return openKeyToCamelot(Number(openKey[1]), openKey[2].toLowerCase() as 'd' | 'm');

  // Notazione classica: nota + eventuale alterazione + modo.
  const m = raw.match(/^([A-Ga-g])\s*([#♯b♭]?)\s*(.*)$/);
  if (!m) return null;
  const note = (m[1].toUpperCase() + normalizeAccidental(m[2])).toUpperCase();
  const modeRaw = m[3].trim();
  // Convenzione 'M' maiuscola = maggiore / 'm' minuscola = minore (alcuni tagger).
  const isMajorExact = modeRaw === 'M';
  const modeStr = modeRaw.toLowerCase();
  const isMinor =
    !isMajorExact &&
    (modeStr === 'm' || modeStr === '-' || modeStr.startsWith('min') || modeStr.endsWith('moll'));
  const isMajor =
    isMajorExact || modeStr === '' || modeStr.startsWith('maj') || modeStr.endsWith('dur');
  if (isMinor) return CAMELOT_MINOR[note] ?? null;
  if (isMajor) return CAMELOT_MAJOR[note] ?? null;
  return null;
}

function normalizeAccidental(acc: string): string {
  if (acc === '♯') return '#';
  if (acc === '♭') return 'B';
  if (acc === 'b') return 'B';
  return acc;
}
