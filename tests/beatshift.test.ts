import { describe, expect, it } from 'vitest';
import {
  appFromSource,
  audioKindOf,
  beatshiftSeconds,
  classifyMp3,
  id3TextValues,
  type BeatshiftApp,
  type BeatshiftCase
} from '../src/core/beatshift';

/* ------------------------------------------------------------ MP3 sintetici */

/** Header MPEG-1 Layer III, 128 kbps, 44.1 kHz, senza padding: frame da 417 byte. */
function header(channelMode: number): Buffer {
  const b = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  b[3] = (channelMode & 3) << 6;
  return b;
}

const FRAME = 417;

function crc16(buf: Buffer): number {
  let crc = 0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

interface Opts {
  info?: boolean;
  lame?: string | null;
  goodCrc?: boolean;
  infoMode?: number;
  audioMode?: number;
  id3?: Buffer;
}

function mp3(o: Opts = {}): Buffer {
  const infoMode = o.infoMode ?? 1; // joint stereo
  const audioMode = o.audioMode ?? 1;
  const frames: Buffer[] = [];
  if (o.info) {
    const f = Buffer.alloc(FRAME);
    header(infoMode).copy(f, 0);
    // stereo MPEG-1: frame Info a 4 + 32 = 36
    f.write('Info', 36, 'latin1');
    if (o.lame) {
      f.write(o.lame, 156, 'latin1');
      const crc = crc16(f.subarray(0, 190));
      f.writeUInt16BE(o.goodCrc === false ? crc ^ 0xffff : crc, 190);
    }
    frames.push(f);
  }
  for (let i = 0; i < 4; i++) {
    const f = Buffer.alloc(FRAME);
    header(audioMode).copy(f, 0);
    frames.push(f);
  }
  return Buffer.concat([o.id3 ?? Buffer.alloc(0), ...frames]);
}

/** Tag ID3v2.3 con frame di testo. */
function id3(frames: [string, string][]): Buffer {
  const body = Buffer.concat(
    frames.map(([id, text]) => {
      const payload = Buffer.concat([Buffer.from([0]), Buffer.from(text, 'latin1')]);
      const h = Buffer.alloc(10);
      h.write(id, 0, 'latin1');
      h.writeUInt32BE(payload.length, 4);
      return Buffer.concat([h, payload]);
    })
  );
  const head = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  const n = body.length;
  head[6] = (n >> 21) & 0x7f;
  head[7] = (n >> 14) & 0x7f;
  head[8] = (n >> 7) & 0x7f;
  head[9] = n & 0x7f;
  return Buffer.concat([head, body]);
}

const caso = (b: Buffer) => classifyMp3(b)?.case ?? null;

describe('beatshift — classificazione degli MP3', () => {
  it('A: nessun frame Info', () => {
    expect(caso(mp3())).toBe('A');
  });

  it('B: frame Info senza tag LAME, channel mode diverso dall audio', () => {
    expect(caso(mp3({ info: true, infoMode: 1, audioMode: 0 }))).toBe('B');
  });

  it('D: frame Info con lo stesso channel mode dell audio, che alcuni decoder suonano', () => {
    // Senza LAME sarebbe B; il channel mode uguale lo porta a D.
    expect(caso(mp3({ info: true, infoMode: 1, audioMode: 1 }))).toBe('D');
    // Con LAME integro è D direttamente.
    expect(caso(mp3({ info: true, lame: 'LAME3.100', infoMode: 1, audioMode: 1 }))).toBe('D');
  });

  it('C: tag LAME corrotto', () => {
    expect(caso(mp3({ info: true, lame: 'LAME3.100', goodCrc: false, infoMode: 1, audioMode: 0 }))).toBe('C');
  });

  it('C: D con channel mode diverso', () => {
    expect(caso(mp3({ info: true, lame: 'LAME3.100', infoMode: 1, audioMode: 0 }))).toBe('C');
  });

  it('le firme di encoder ingannevoli vincono sulla struttura', () => {
    // Un file senza frame Info sarebbe A, ma questo encoder è noto per mentire.
    expect(caso(mp3({ id3: id3([['TSSE', 'Lavf57.83.100']]) }))).toBe('C');
    expect(caso(mp3({ id3: id3([['TPUB', 'Beatport']]) }))).toBe('C');
    // ffmpeg senza tag LAME: D anche se la struttura direbbe B…
    expect(caso(mp3({ info: true, infoMode: 1, audioMode: 1, id3: id3([['TSSE', 'Lavf58.20.100']]) }))).toBe('D');
    // …ma la correzione del channel mode si applica DOPO le firme: con il
    // channel mode diverso diventa C, come qualunque altro D.
    expect(caso(mp3({ info: true, infoMode: 1, audioMode: 0, id3: id3([['TSSE', 'Lavf58.20.100']]) }))).toBe('C');
  });

  it('salta il tag ID3 per trovare l audio', () => {
    const b = mp3({ info: true, lame: 'LAME3.100', id3: id3([['TIT2', 'Titolo'], ['TPE1', 'Artista']]) });
    expect(caso(b)).toBe('D');
    expect(id3TextValues(b)).toEqual(['Titolo', 'Artista']);
  });

  it('su byte che non sono MP3 non inventa un caso', () => {
    expect(classifyMp3(Buffer.from('RIFF....WAVEfmt '))).toBeNull();
    expect(classifyMp3(Buffer.alloc(0))).toBeNull();
  });
});

/* ------------------------------------------------------------- la matrice */

const ms = (
  origin: BeatshiftApp,
  target: BeatshiftApp,
  kind: 'mp3' | 'mp4' | 'other',
  c: BeatshiftCase | null
) => Math.round(beatshiftSeconds({ origin, target, kind, mp3Case: c }) * 1000);

describe('beatshift — scarti fra software', () => {
  it('non sposta mai un cue che torna al software da cui è partito', () => {
    /* La tabella della specifica, composta, darebbe -26 ms per
       Rekordbox→Rekordbox sui file di caso B e C. Un cue che torna a casa deve
       restare dov'era: altrimenti ogni giro di sincronizzazione lo sposterebbe
       un po' di più. */
    for (const app of ['rekordbox', 'traktor', 'serato', 'virtualdj', 'engine'] as BeatshiftApp[]) {
      for (const c of ['A', 'B', 'C', 'D'] as BeatshiftCase[]) {
        expect(ms(app, app, 'mp3', c)).toBe(0);
      }
    }
  });

  it('non sposta i formati senza frame informativo', () => {
    expect(ms('rekordbox', 'traktor', 'other', null)).toBe(0);
    expect(ms('serato', 'rekordbox', 'other', null)).toBe(0);
  });

  it('non sposta un MP3 di cui non conosce il caso', () => {
    // Una correzione parziale è peggio di nessuna: sembra fatta.
    expect(ms('traktor', 'rekordbox', 'mp3', null)).toBe(0);
  });

  it('non sposta verso o da origini che non sono software DJ', () => {
    expect(beatshiftSeconds({ origin: null, target: 'rekordbox', kind: 'mp3', mp3Case: 'B' })).toBe(0);
    expect(beatshiftSeconds({ origin: 'rekordbox', target: null, kind: 'mp3', mp3Case: 'B' })).toBe(0);
  });

  it('valori della specifica, composti da import ed export', () => {
    // Traktor → Rekordbox
    expect(ms('traktor', 'rekordbox', 'mp3', 'A')).toBe(0);
    expect(ms('traktor', 'rekordbox', 'mp3', 'B')).toBe(-26);
    expect(ms('traktor', 'rekordbox', 'mp3', 'D')).toBe(0);
    // Serato → Rekordbox: B ha un valore suo
    expect(ms('serato', 'rekordbox', 'mp3', 'B')).toBe(-16);
    // Engine → Rekordbox: C ha un valore suo
    expect(ms('engine', 'rekordbox', 'mp3', 'C')).toBe(31);
    // Rekordbox → Serato: la differenza fra le due latenze
    expect(ms('rekordbox', 'serato', 'mp3', 'D')).toBe(-5);
    // Serato → VirtualDJ
    expect(ms('serato', 'virtualdj', 'mp3', 'B')).toBe(-72);
    // Rekordbox → Engine: solo la latenza d'origine
    expect(ms('rekordbox', 'engine', 'mp3', 'D')).toBe(-51);
  });

  it('i file MP4 hanno solo la correzione di 9 ms fra Rekordbox e Traktor/VirtualDJ', () => {
    expect(ms('rekordbox', 'traktor', 'mp4', null)).toBe(9);
    expect(ms('rekordbox', 'virtualdj', 'mp4', null)).toBe(-9);
    expect(ms('traktor', 'virtualdj', 'mp4', null)).toBe(-9);
    expect(ms('serato', 'traktor', 'mp4', null)).toBe(0);
  });

  it('documenta che la tabella non è antisimmetrica', () => {
    /* Non è un test di correttezza: fissa un fatto che chi usa la funzione deve
       conoscere. Andata e ritorno fra Traktor e Rekordbox su un file di caso B
       non si annullano — da qui la regola di applicare lo spostamento solo in
       uscita, senza mai riscriverlo nell'archivio interno. */
    const andata = ms('traktor', 'rekordbox', 'mp3', 'B');
    const ritorno = ms('rekordbox', 'traktor', 'mp3', 'B');
    expect(andata).toBe(-26);
    expect(ritorno).toBe(8);
    expect(andata + ritorno).not.toBe(0);
  });
});

describe('beatshift — origini e formati', () => {
  it('riconosce le sorgenti dell archivio interno', () => {
    expect(appFromSource('masterdb')).toBe('rekordbox');
    expect(appFromSource('rekordbox-usb')).toBe('rekordbox');
    expect(appFromSource('serato4')).toBe('serato');
    expect(appFromSource('analisi')).toBeNull();
    expect(appFromSource(null)).toBeNull();
  });

  it('riconosce il formato dall estensione', () => {
    expect(audioKindOf('C:/a/b.MP3')).toBe('mp3');
    expect(audioKindOf('/x/y.m4a')).toBe('mp4');
    expect(audioKindOf('/x/y.flac')).toBe('other');
    expect(audioKindOf(null)).toBe('other');
  });
});
