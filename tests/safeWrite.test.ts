import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { cleanStaging, safeWrite, safeWriteBuffer } from '../src/services/safeWrite';

/**
 * La catena di scrittura sicura.
 *
 * ⚠ Il test che conta è quello sul fallimento: una catena che funziona quando
 * tutto va bene non serve a niente. Quello che deve reggere è il caso in cui la
 * costruzione lancia a metà, o la verifica non torna — e in entrambi i casi
 * l'originale deve essere ancora lì, intatto.
 */

function tmp() {
  return mkdtempSync(join(tmpdir(), 'cf-safewrite-'));
}

describe('catena di scrittura sicura', () => {
  it('scrive e verifica il caso normale', async () => {
    const d = tmp();
    const target = join(d, 'libreria.db');
    writeFileSync(target, 'vecchio');

    const r = await safeWrite({
      target,
      backupDir: join(d, 'bk'),
      build: async (staging) => writeFile(staging, 'nuovo')
    });

    expect(r.ok).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('nuovo');
    expect(r.backupPath).toBeTruthy();
    expect(readFileSync(r.backupPath as string, 'utf-8')).toBe('vecchio');
  });

  it('⚠ se la costruzione fallisce, l’originale non è stato toccato', async () => {
    const d = tmp();
    const target = join(d, 'libreria.db');
    writeFileSync(target, 'originale');

    const r = await safeWrite({
      target,
      backupDir: join(d, 'bk'),
      build: async (staging) => {
        await writeFile(staging, 'meta scrittura');
        throw new Error('disco pieno');
      }
    });

    expect(r.ok).toBe(false);
    expect(r.rolledBack).toBe(false); // non c'era niente da ripristinare
    expect(readFileSync(target, 'utf-8')).toBe('originale');
    expect(r.message).toContain('non è stato modificato');
    // Nessuno staging lasciato in giro.
    expect(existsSync(`${target}.cfnew`)).toBe(false);
  });

  it('⚠ se la validazione rifiuta il file nuovo, non lo mette al posto del vecchio', async () => {
    const d = tmp();
    const target = join(d, 'libreria.db');
    writeFileSync(target, 'originale');

    const r = await safeWrite({
      target,
      backupDir: join(d, 'bk'),
      build: async (staging) => writeFile(staging, 'contenuto incoerente'),
      validate: async () => 'conteggio dei record non coerente'
    });

    expect(r.ok).toBe(false);
    expect(readFileSync(target, 'utf-8')).toBe('originale');
    expect(r.message).toContain('coerente');
  });

  it('se la verifica finale fallisce, ripristina e lo dice', async () => {
    const d = tmp();
    const target = join(d, 'libreria.db');
    writeFileSync(target, 'originale');

    let primaChiamata = true;
    const r = await safeWrite({
      target,
      backupDir: join(d, 'bk'),
      build: async (staging) => writeFile(staging, 'nuovo'),
      validate: async () => {
        // Passa sullo staging, fallisce sulla destinazione: è il caso della
        // copia troncata da un supporto che ha mentito.
        if (primaChiamata) {
          primaChiamata = false;
          return null;
        }
        return 'il file scritto non si rilegge';
      }
    });

    expect(r.ok).toBe(false);
    expect(r.rolledBack).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('originale');
  });

  it('senza copia di sicurezza verificata la scrittura non parte', async () => {
    const d = tmp();
    const target = join(d, 'libreria.db');
    writeFileSync(target, 'originale');

    // Cartella di backup che non si può creare: un file al suo posto.
    const bk = join(d, 'bk');
    writeFileSync(bk, 'sono un file, non una cartella');

    const r = await safeWrite({
      target,
      backupDir: bk,
      build: async (staging) => writeFile(staging, 'nuovo')
    });

    expect(r.ok).toBe(false);
    expect(readFileSync(target, 'utf-8')).toBe('originale');
    expect(r.message).toContain('sicurezza');
  });

  it('un bersaglio che non esiste ancora si crea, senza backup', async () => {
    const d = tmp();
    const target = join(d, 'nuovo.db');

    const r = await safeWrite({
      target,
      backupDir: join(d, 'bk'),
      build: async (staging) => writeFile(staging, 'contenuto')
    });

    expect(r.ok).toBe(true);
    expect(r.backupPath).toBeNull();
    expect(readFileSync(target, 'utf-8')).toBe('contenuto');
  });

  it('⚠ il costruttore riceve l’originale, per fondere invece di rigenerare', async () => {
    // È il motivo per cui la firma lo passa: quasi tutti i writer di questo
    // progetto devono rileggere ciò che c'è, o cancellano quello che non
    // conoscono.
    const d = tmp();
    const target = join(d, 'libreria.db');
    writeFileSync(target, 'riga estranea\n');

    const r = await safeWrite({
      target,
      backupDir: join(d, 'bk'),
      build: async (staging, originale) => {
        const prima = originale ? readFileSync(originale, 'utf-8') : '';
        await writeFile(staging, prima + 'riga nuova\n');
      }
    });

    expect(r.ok).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('riga estranea\nriga nuova\n');
  });

  it('un file vuoto non passa la verifica', async () => {
    const d = tmp();
    const target = join(d, 'libreria.db');
    writeFileSync(target, 'originale');

    const r = await safeWrite({
      target,
      backupDir: join(d, 'bk'),
      build: async (staging) => writeFile(staging, '')
    });

    expect(r.ok).toBe(false);
    expect(readFileSync(target, 'utf-8')).toBe('originale');
  });

  it('pulisce uno staging rimasto da un’esecuzione interrotta', () => {
    const d = tmp();
    const target = join(d, 'libreria.db');
    writeFileSync(`${target}.cfnew`, 'residuo');
    cleanStaging(target);
    expect(existsSync(`${target}.cfnew`)).toBe(false);
  });

  it('la scorciatoia per contenuto già pronto passa dalla stessa catena', async () => {
    const d = tmp();
    const target = join(d, 'x.txt');
    writeFileSync(target, 'vecchio');

    const r = await safeWriteBuffer(target, join(d, 'bk'), 'nuovo');
    expect(r.ok).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('nuovo');
    expect(readFileSync(r.backupPath as string, 'utf-8')).toBe('vecchio');
  });
});
