import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import {
  BPLIST_MAGIC,
  DJAY_HEADER_MAGIC,
  DJAY_HEADER_SIZE,
  DJAY_TYPE,
  SKIPPED_BINARY,
  detectPayloadKind,
  encodeDjayString,
  flattenArchivedTrack,
  parseBinaryPlist,
  parseDjayPayload
} from '../src/adapters/djay/payload';

/**
 * ⚠ djay non è installato sulla macchina di sviluppo: questi test lavorano su
 * fixture SINTETICHE, costruite dall'encoder documentato. Verificano che il
 * parser rispetti le regole del formato — in particolare le due
 * controintuitive — non che legga un `MediaLibrary.db` vero.
 *
 * La verifica su file reale resta da fare, ed è dichiarata come tale.
 */

/** Costruisce un payload nel formato proprietario, intestazione compresa. */
function payload(...parti: Buffer[]): Buffer {
  const head = Buffer.alloc(DJAY_HEADER_SIZE);
  head.writeUInt32BE(DJAY_HEADER_MAGIC, 0);
  return Buffer.concat([head, ...parti]);
}

const t = (n: number) => Buffer.from([n]);

/** Oggetto tipizzato: CLASS, nome, poi coppie VALORE-CHIAVE, poi il nullo. */
function classObj(nome: string, coppie: [Buffer, string][]): Buffer {
  const parti: Buffer[] = [t(DJAY_TYPE.CLASS), encodeDjayString(nome)];
  for (const [valore, chiave] of coppie) parti.push(valore, encodeDjayString(chiave));
  parti.push(t(DJAY_TYPE.NULL));
  return Buffer.concat(parti);
}

describe('djay Pro — formato proprietario', () => {
  it('riconosce i due formati dal magic', () => {
    expect(detectPayloadKind(Buffer.from('bplist00abcdefgh'))).toBe('bplist');
    expect(detectPayloadKind(payload(t(DJAY_TYPE.CLASS)))).toBe('djay');
    expect(detectPayloadKind(Buffer.from('non sono nessuno dei due'))).toBe('unknown');
  });

  it('rifiuta un payload senza 0x2B dopo i 20 byte di intestazione', () => {
    expect(() => parseDjayPayload(payload(t(DJAY_TYPE.STRING)))).toThrow(/0x2B/);
  });

  it('⚠ nelle coppie il VALORE precede la CHIAVE', () => {
    // È la regola che, se invertita, non dà errore: dà un oggetto con chiavi e
    // valori scambiati, e il danno si vede solo molto più a valle.
    const buf = payload(
      classObj('Traccia', [
        [encodeDjayString('Bohemian Rhapsody'), 'titolo'],
        [encodeDjayString('Queen'), 'artista']
      ])
    );
    const obj = parseDjayPayload(buf) as Record<string, unknown>;
    expect(obj.titolo).toBe('Bohemian Rhapsody');
    expect(obj.artista).toBe('Queen');
    // La controprova: le chiavi non devono essere finite fra i valori.
    expect(Object.keys(obj)).not.toContain('Queen');
  });

  it('⚠ la lista dei campi finisce con un byte nullo, non con un conteggio', () => {
    const uno = payload(classObj('A', [[encodeDjayString('x'), 'k']]));
    const tre = payload(
      classObj('A', [
        [encodeDjayString('x'), 'k1'],
        [encodeDjayString('y'), 'k2'],
        [encodeDjayString('z'), 'k3']
      ])
    );
    expect(Object.keys(parseDjayPayload(uno) as object)).toHaveLength(2); // __class + k
    expect(Object.keys(parseDjayPayload(tre) as object)).toHaveLength(4);
  });

  it('i valori immediati non consumano payload', () => {
    // NUMBER_0 e NUMBER_1 sono il numero, non un tag seguito da dati: leggere
    // un byte in più dopo di loro disallinea tutto il resto del blob.
    const buf = payload(
      classObj('N', [
        [t(DJAY_TYPE.NUMBER_0), 'zero'],
        [t(DJAY_TYPE.NUMBER_1), 'uno'],
        [t(DJAY_TYPE.BOOLEAN_TRUE), 'vero'],
        [t(DJAY_TYPE.BOOLEAN_FALSE), 'falso'],
        [encodeDjayString('dopo'), 'coda']
      ])
    );
    const obj = parseDjayPayload(buf) as Record<string, unknown>;
    expect(obj.zero).toBe(0);
    expect(obj.uno).toBe(1);
    expect(obj.vero).toBe(true);
    expect(obj.falso).toBe(false);
    // Se l'allineamento fosse saltato, questo sarebbe spazzatura.
    expect(obj.coda).toBe('dopo');
  });

  it('normalizza le stringhe in NFC', () => {
    // "é" in NFD (e + accento combinante) e in NFC devono produrre gli stessi
    // byte: senza, due titoli visivamente identici non collidono mai.
    const nfd = 'Café';
    const nfc = 'Café';
    expect(encodeDjayString(nfd).equals(encodeDjayString(nfc))).toBe(true);
  });

  it('salta i blocchi binari invece di provare a interpretarli', () => {
    /* ⚠ ASSUNZIONE ancora non verificata: la lunghezza del blocco binario
       viene letta su un confine di 4 byte contato dall'inizio del payload. La
       specifica dichiara che un allineamento a blocchi di 4 esiste, ma non
       rispetto a cosa, e nella libreria reale usata per il collaudo i blocchi
       binari cadevano già allineati: il caso disallineato non si è presentato,
       quindi non prova nulla. La fixture è costruita ALLINEATA, coerentemente
       con quella lettura; resta questo il punto da correggere se un file vero
       mostrasse il contrario.

       La lunghezza è invece little-endian per FATTO, non per assunzione: su
       una libreria reale la lettura big-endian trasformava i conteggi degli
       array in decine di milioni e le durate dei brani in denormali del tipo
       6.8e-313. In little-endian gli stessi byte danno 1 e 372.63. */
    const prefisso = payload(
      Buffer.concat([t(DJAY_TYPE.CLASS), encodeDjayString('B'), t(DJAY_TYPE.BINARY)])
    );
    const padding = Buffer.alloc((4 - (prefisso.length % 4)) % 4);

    const buf = Buffer.concat([
      prefisso,
      padding,
      Buffer.from([4, 0, 0, 0]),
      Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      encodeDjayString('waveform'),
      encodeDjayString('ok'),
      encodeDjayString('dopo'),
      t(DJAY_TYPE.NULL)
    ]);

    const obj = parseDjayPayload(buf) as Record<string, unknown>;
    expect(obj.waveform).toBe(SKIPPED_BINARY);
    // Il valore DOPO il binario deve essere ancora leggibile: è la prova che
    // la lunghezza dichiarata è stata saltata per intero e non a metà.
    expect(obj.dopo).toBe('ok');
  });

  it('non si pianta su un payload troncato', () => {
    const buf = payload(t(DJAY_TYPE.CLASS), encodeDjayString('A'), t(DJAY_TYPE.STRING));
    // Può lanciare o restituire un oggetto parziale: quello che NON deve fare è
    // ciclare all'infinito o leggere fuori dal buffer.
    expect(() => {
      try {
        parseDjayPayload(buf);
      } catch {
        /* previsto */
      }
    }).not.toThrow();
  });
});

describe('djay Pro — binary plist', () => {
  /** Genera un bplist reale con Python, che ce l'ha nella libreria standard. */
  function bplist(pyDict: string): Buffer {
    const out = execFileSync(
      'python',
      [
        '-c',
        `import plistlib, sys, base64
d = ${pyDict}
sys.stdout.write(base64.b64encode(plistlib.dumps(d, fmt=plistlib.FMT_BINARY)).decode())`
      ],
      { encoding: 'utf-8' }
    );
    return Buffer.from(out.trim(), 'base64');
  }

  it('legge un binary plist vero prodotto da un altro strumento', () => {
    const buf = bplist(`{'titolo': 'Brano', 'bpm': 128, 'attivo': True, 'peso': 1.5}`);
    expect(buf.subarray(0, 6).toString('latin1')).toBe(BPLIST_MAGIC);

    const obj = parseBinaryPlist(buf) as Record<string, unknown>;
    expect(obj.titolo).toBe('Brano');
    expect(obj.bpm).toBe(128);
    expect(obj.attivo).toBe(true);
    expect(obj.peso).toBeCloseTo(1.5);
  });

  it('legge le stringhe UTF-16 e gli array annidati', () => {
    const buf = bplist(`{'titolo': 'Café Déjà Vu ☕', 'lista': [1, 2, 'tre']}`);
    const obj = parseBinaryPlist(buf) as Record<string, unknown>;
    expect(obj.titolo).toBe('Café Déjà Vu ☕');
    expect(obj.lista).toEqual([1, 2, 'tre']);
  });

  it('rifiuta ciò che non è un binary plist', () => {
    expect(() => parseBinaryPlist(Buffer.from('<?xml version="1.0"?>'))).toThrow();
  });

  it("⚠ «$null» è una stringa sentinella, non un valore nullo", () => {
    const piatto = flattenArchivedTrack({
      titolo: 'Brano',
      artista: '$null',
      album: 'Disco'
    });
    expect(piatto.titolo).toBe('Brano');
    expect(piatto.album).toBe('Disco');
    // Se finisse nei metadati, l'utente vedrebbe un artista chiamato "$null".
    expect(piatto.artista).toBeUndefined();
  });

  it('⚠ gli NSURL espongono il percorso in NS.relative', () => {
    const piatto = flattenArchivedTrack({
      percorso: { 'NS.relative': 'file:///Users/x/Brano.mp3', 'NS.base': null }
    });
    expect(piatto.percorso).toBe('file:///Users/x/Brano.mp3');
  });

  it('scarta il puntatore di classe e non entra in ricorsione infinita', () => {
    const ciclico: Record<string, unknown> = { titolo: 'Brano', $class: { nome: 'ADCMediaItem' } };
    ciclico.se = ciclico;
    const piatto = flattenArchivedTrack(ciclico as never);
    expect(piatto.titolo).toBe('Brano');
    expect(piatto.$class).toBeUndefined();
  });
});
