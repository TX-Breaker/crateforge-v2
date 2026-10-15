import { closeSync, openSync, readSync } from 'fs';
import { classifyMp3, id3v2End, type Mp3Probe } from '@core/beatshift';

/**
 * Legge da disco quanto serve per classificare un MP3: l'intero tag ID3v2 e i
 * primi frame audio.
 *
 * ⚠ Non basta una finestra fissa dall'inizio del file. Un tag con la copertina
 * incorporata supera facilmente il megabyte, e con una finestra di 512 KB il
 * primo frame audio restava fuori: su una libreria reale capitava a 55 file su
 * 1141, che uscivano senza caso — cioè senza correzione — per una ragione che
 * non aveva niente a che fare con il file.
 */

/** Byte di audio letti dopo il tag: abbondano per due frame e per la ricerca del sincronismo. */
const AUDIO_WINDOW = 128 * 1024;
/** Un tag oltre questa dimensione non è un tag, è un file danneggiato. */
const MAX_TAG = 32 * 1024 * 1024;

export function probeMp3File(path: string): Mp3Probe | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const head = Buffer.alloc(10);
    const n = readSync(fd, head, 0, 10, 0);
    const tagEnd = n === 10 ? id3v2End(head) : 0;
    if (tagEnd > MAX_TAG) return null;
    const size = tagEnd + AUDIO_WINDOW;
    const buf = Buffer.alloc(size);
    const read = readSync(fd, buf, 0, size, 0);
    return classifyMp3(buf.subarray(0, read));
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Classificazione con memoria per la durata di un'operazione: un export tocca
 * lo stesso file una volta per cue, e rileggerlo ogni volta non serve.
 */
export function createBeatshiftCache(): (path: string) => Mp3Probe | null {
  const memo = new Map<string, Mp3Probe | null>();
  return (path: string) => {
    if (!memo.has(path)) memo.set(path, probeMp3File(path));
    return memo.get(path)!;
  };
}
