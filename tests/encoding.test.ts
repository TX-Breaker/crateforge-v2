import { describe, expect, it } from 'vitest';
import { decodeBuffer, fixDoubleEncodedUtf8, isExportSafe } from '@services/encoding/encoding';
import { hasSuspectEncoding } from '@core/xmlCollection';
import iconv from 'iconv-lite';

const CTRL = String.fromCharCode(7); // carattere di controllo (BEL)

describe('decodeBuffer', () => {
  it('decodifica UTF-8 pulito', () => {
    const r = decodeBuffer(Buffer.from('Città Führer 東京', 'utf-8'));
    expect(r.text).toBe('Città Führer 東京');
  });

  it('decodifica Shift-JIS (caratteri giapponesi)', () => {
    const buf = iconv.encode('東京タワー', 'Shift_JIS');
    const r = decodeBuffer(buf);
    expect(r.text).toBe('東京タワー');
  });
});

describe('fixDoubleEncodedUtf8', () => {
  it('ripara il mojibake classico', () => {
    // 'è' UTF-8 letto come Latin-1 → 'Ã¨'; 'à' → 'Ã' + NBSP (U+00A0)
    expect(fixDoubleEncodedUtf8('Citt' + String.fromCharCode(0xc3, 0xa0) + ' perduta')).toBe('Città perduta');
    expect(fixDoubleEncodedUtf8('TÃ¨sto')).toBe('Tèsto');
  });

  it('non tocca stringhe sane', () => {
    expect(fixDoubleEncodedUtf8('Testo normale')).toBeNull();
  });
});

describe('isExportSafe / hasSuspectEncoding', () => {
  it('accetta testo normale multi-alfabeto', () => {
    expect(isExportSafe('Testo ok')).toBe(true);
    expect(isExportSafe('東京 Москва دبي')).toBe(true);
    expect(isExportSafe(null)).toBe(true);
    expect(hasSuspectEncoding('東京タワー')).toBe(false);
  });

  it('rifiuta replacement char e caratteri di controllo', () => {
    expect(isExportSafe('bad' + CTRL + 'tag')).toBe(false);
    expect(isExportSafe('bad�tag')).toBe(false);
    expect(hasSuspectEncoding('bad�tag')).toBe(true);
    expect(hasSuspectEncoding('ctrl' + CTRL + 'char')).toBe(true);
  });

  it('riconosce il mojibake', () => {
    expect(hasSuspectEncoding('TÃ¨sto Rotto')).toBe(true);
  });
});
