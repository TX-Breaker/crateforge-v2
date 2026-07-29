import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import {
  compareVersions,
  evaluateAppVersion,
  evaluateVersion,
  normalizeMarker,
  TESTED
} from '@core/djVersions';
import {
  probeEngine,
  probeRekordboxXml,
  probeSerato,
  probeTraktor,
  probeVirtualDj
} from '../src/main/versionProbe';

/**
 * Il blocco versioni è una promessa fatta all'utente: CrateForge scrive solo
 * verso formati che l'autore ha guardato byte per byte. I test qui sotto
 * verificano le due metà di quella promessa — che il confronto non sbagli, e
 * che il marcatore venga letto davvero dai file, non indovinato.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cf-ver-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('confronto tra versioni', () => {
  it('confronta per segmenti numerici, non come stringhe', () => {
    // Il caso che rompe l'ordinamento lessicale: 10 viene dopo 9.
    expect(compareVersions('3.0.10', '3.0.9')).toBe(1);
    expect(compareVersions('7.2.16', '7.2.9')).toBe(1);
    expect(compareVersions('3.0.2', '3.0.2')).toBe(0);
    expect(compareVersions('2024', '19')).toBe(1);
    // Segmenti mancanti valgono zero: 3.0 e 3.0.0 sono la stessa cosa.
    expect(compareVersions('3.0', '3.0.0')).toBe(0);
  });

  it('estrae il numero dai marcatori reali, che numeri puliti non sono', () => {
    expect(normalizeMarker('2.0/Serato Scratch LIVE Database')).toBe('2.0');
    expect(normalizeMarker('1.0/Serato ScratchLive Crate')).toBe('1.0');
    expect(normalizeMarker('  20 ')).toBe('20');
    expect(normalizeMarker(null)).toBeNull();
    expect(normalizeMarker('nessun numero')).toBeNull();
  });
});

describe('regola di ammissione', () => {
  it('lascia passare la versione collaudata e quelle precedenti', () => {
    const v = evaluateVersion('engine', '3.0.2');
    expect(v.status).toBe('ok');
    expect(v.blocksWrite).toBe(false);
    expect(evaluateVersion('engine', '2.18.0').status).toBe('ok');
  });

  it('blocca la SCRITTURA verso una versione più recente, ma non la lettura', () => {
    const v = evaluateVersion('engine', '3.1.0');
    expect(v.status).toBe('newer');
    expect(v.blocksWrite).toBe(true);
    expect(v.blocksRead).toBe(false);
    // Il messaggio deve dire cosa è successo e perché, non "operazione non riuscita".
    expect(v.message).toContain('3.1.0');
    expect(v.message).toContain(TESTED.engine.maxTested);
  });

  it('in modalità severa blocca anche la lettura', () => {
    expect(evaluateVersion('engine', '3.1.0', { gate: 'strict' }).blocksRead).toBe(true);
  });

  it('tratta il marcatore assente come non collaudabile, non come "va bene"', () => {
    const v = evaluateVersion('serato', null);
    expect(v.status).toBe('unknown');
    expect(v.blocksWrite).toBe(true);
  });

  it('lo sblocco vale per quella versione e per quelle precedenti, non per le successive', () => {
    expect(evaluateVersion('engine', '3.1.0', { acknowledged: '3.1.0' }).status).toBe('acknowledged');
    // Sotto la soglia collaudata lo sblocco non serve: resta 'ok'.
    expect(evaluateVersion('engine', '3.0.1', { acknowledged: '3.1.0' }).status).toBe('ok');
    // Tra la soglia collaudata e quella sbloccata: passa, ma dichiarato.
    expect(evaluateVersion('engine', '3.0.9', { acknowledged: '3.1.0' }).status).toBe('acknowledged');
    // Una versione ancora più nuova resta bloccata: lo sblocco non è un lasciapassare.
    const oltre = evaluateVersion('engine', '4.0.0', { acknowledged: '3.1.0' });
    expect(oltre.status).toBe('newer');
    expect(oltre.blocksWrite).toBe(true);
  });

  it('scrittura diretta nel master.db: si confronta la versione dell app installata', () => {
    expect(evaluateAppVersion('rekordbox', '7.2.16').blocksWrite).toBe(false);
    expect(evaluateAppVersion('rekordbox', '7.3.0').blocksWrite).toBe(true);
    expect(evaluateAppVersion('rekordbox', null).blocksWrite).toBe(true);
    expect(evaluateAppVersion('rekordbox', '8.0.0', { acknowledged: '8.0.0' }).blocksWrite).toBe(false);
  });

  it('ogni riga del registro dichiara con che cosa è stato fatto il collaudo', () => {
    for (const [software, entry] of Object.entries(TESTED)) {
      expect(entry.maxTested, software).toMatch(/\d/);
      expect(entry.evidence.length, software).toBeGreaterThan(20);
      expect(entry.testedOn, software).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('lettura del marcatore dai file', () => {
  it('Engine: legge schemaVersion dalla tabella Information', () => {
    const p = join(dir, 'm.db');
    const db = new Database(p);
    db.exec(`CREATE TABLE Information (
      id INTEGER PRIMARY KEY, uuid TEXT,
      schemaVersionMajor INTEGER, schemaVersionMinor INTEGER, schemaVersionPatch INTEGER)`);
    db.prepare(
      `INSERT INTO Information (id,uuid,schemaVersionMajor,schemaVersionMinor,schemaVersionPatch)
       VALUES (1,'x',3,0,2)`
    ).run();
    db.close();
    expect(probeEngine(p)).toBe('3.0.2');
  });

  it('Engine: un database senza Information non inventa una versione', () => {
    const p = join(dir, 'vuoto.db');
    const db = new Database(p);
    db.exec('CREATE TABLE Nulla (id INTEGER)');
    db.close();
    expect(probeEngine(p)).toBeNull();
    expect(probeEngine(join(dir, 'inesistente.db'))).toBeNull();
  });

  it('Serato: legge il campo vrsn in testa a "database V2"', () => {
    const sd = join(dir, '_Serato_');
    mkdirSync(sd);
    const testo = Buffer.from('2.0/Serato Scratch LIVE Database', 'utf16le').swap16();
    const len = Buffer.alloc(4);
    len.writeUInt32BE(testo.length);
    writeFileSync(join(sd, 'database V2'), Buffer.concat([Buffer.from('vrsn', 'ascii'), len, testo]));
    expect(probeSerato(sd)).toBe('2.0/Serato Scratch LIVE Database');
  });

  it('Traktor e VirtualDJ: leggono l attributo di versione dalla testa del file', () => {
    const nml = join(dir, 'collection.nml');
    writeFileSync(nml, '<?xml version="1.0"?>\n<NML VERSION="20"><HEAD PROGRAM="Traktor"/></NML>');
    expect(probeTraktor(nml)).toBe('20');

    const vdj = join(dir, 'database.xml');
    writeFileSync(vdj, '<?xml version="1.0"?>\n<VirtualDJ_Database Version="2024"></VirtualDJ_Database>');
    expect(probeVirtualDj(vdj)).toBe('2024');
  });

  it('Rekordbox: distingue la versione del FORMATO da quella dell app che ha esportato', () => {
    const xml = join(dir, 'collection.xml');
    writeFileSync(
      xml,
      '<?xml version="1.0"?>\n<DJ_PLAYLISTS Version="1.0.0">' +
        '<PRODUCT Name="rekordbox" Version="7.2.16" Company="AlphaTheta"/></DJ_PLAYLISTS>'
    );
    const r = probeRekordboxXml(xml);
    expect(r.format).toBe('1.0.0');
    expect(r.app).toBe('7.2.16');
  });
});

/* Sulla macchina dell'autore le librerie vere esistono: il registro deve
   corrispondere a quello che c'è davvero, altrimenti dichiara il falso. */
const ENGINE_REALE = join(homedir(), 'Music', 'Engine Library', 'Database2', 'm.db');
const SERATO_REALE = join(homedir(), 'Music', '_Serato_');

describe.skipIf(!existsSync(ENGINE_REALE))('registro contro la libreria Engine reale', () => {
  it('la versione installata risulta collaudata', () => {
    const marker = probeEngine(ENGINE_REALE);
    expect(marker).not.toBeNull();
    expect(evaluateVersion('engine', marker).status).toBe('ok');
  });
});

describe.skipIf(!existsSync(join(SERATO_REALE, 'database V2')))(
  'registro contro la libreria Serato reale',
  () => {
    it('la versione installata risulta collaudata', () => {
      const marker = probeSerato(SERATO_REALE);
      expect(marker).not.toBeNull();
      expect(evaluateVersion('serato', marker).status).toBe('ok');
    });
  }
);
