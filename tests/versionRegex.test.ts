import { describe, expect, it } from 'vitest';
import { extractVersionLabel } from '@core/versionRegex';

describe('extractVersionLabel', () => {
  it('estrae versioni tra parentesi', () => {
    expect(extractVersionLabel('Levels (Extended Mix)')).toBe('Extended Mix');
    expect(extractVersionLabel('Titolo [Meduza Remix]')).toBe('Meduza Remix');
    expect(extractVersionLabel('Song (Radio Edit)')).toBe('Radio Edit');
  });

  it('estrae versioni dopo il trattino', () => {
    expect(extractVersionLabel('Artist - Song - Club Mix')).toBe('Club Mix');
    expect(extractVersionLabel('Song – VIP Mix')).toBe('VIP Mix');
  });

  it('gestisce bootleg/mashup/rework', () => {
    expect(extractVersionLabel('Track (TX-Breaker Bootleg)')).toBe('TX-Breaker Bootleg');
    expect(extractVersionLabel('A vs B (Mashup)')).toBe('Mashup');
    expect(extractVersionLabel('Track (Mash-Up)')).toBe('Mash-Up');
  });

  it('ignora estensione file', () => {
    expect(extractVersionLabel('Artist - Song (Extended Mix).mp3')).toBe('Extended Mix');
    expect(extractVersionLabel('Song (Original Mix).flac')).toBe('Original Mix');
  });

  it('ritorna null senza versione', () => {
    expect(extractVersionLabel('Just A Song')).toBeNull();
    expect(extractVersionLabel('')).toBeNull();
  });

  it('non abbocca a parole simili dentro altre parole', () => {
    expect(extractVersionLabel('Reminiscence')).toBeNull();
  });
});
