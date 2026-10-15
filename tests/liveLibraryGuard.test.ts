import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isLiveLibraryTarget } from '../src/main/liveLibraryGuard';

/**
 * Un export verso Traktor o VirtualDJ non deve mai sovrascrivere la libreria
 * viva. Il writer di Traktor lo prometteva nel suo commento, ma la finestra di
 * salvataggio permetteva di scegliere il `collection.nml` vero e lo si
 * sovrascriveva senza backup, anche con Traktor aperto.
 */
describe('guardia sulla libreria viva', () => {
  it('rifiuta la libreria rilevata, anche scritta con maiuscole diverse', () => {
    const live = join(tmpdir(), 'NI', 'Traktor 4.4.1', 'collection.nml');
    expect(isLiveLibraryTarget('traktor', live, live)).toBe(true);
    if (process.platform === 'win32') {
      expect(isLiveLibraryTarget('traktor', live.toUpperCase(), live)).toBe(true);
    }
  });

  it('rifiuta un file con il nome della libreria che esiste già, anche se non rilevato', () => {
    // Una versione di Traktor in una cartella che il rilevamento non vede.
    const dir = mkdtempSync(join(tmpdir(), 'cf-live-'));
    try {
      const nml = join(dir, 'collection.nml');
      writeFileSync(nml, '<NML/>');
      expect(isLiveLibraryTarget('traktor', nml, null)).toBe(true);
      const vdj = join(dir, 'database.xml');
      writeFileSync(vdj, '<VirtualDJ_Database/>');
      expect(isLiveLibraryTarget('virtualdj', vdj, null)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('consente un file nuovo, o con un altro nome', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-live-'));
    try {
      const live = join(dir, 'vera', 'collection.nml');
      // Stesso nome ma il file non esiste: non sovrascrive niente.
      expect(isLiveLibraryTarget('traktor', join(dir, 'collection.nml'), live)).toBe(false);
      expect(isLiveLibraryTarget('traktor', join(dir, 'crateforge-traktor.nml'), live)).toBe(false);
      // Il nome della libreria di un software non conta per un altro.
      writeFileSync(join(dir, 'database.xml'), '<x/>');
      expect(isLiveLibraryTarget('traktor', join(dir, 'database.xml'), live)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
