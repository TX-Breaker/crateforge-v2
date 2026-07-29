import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { listInbox, setInboxStatus, SyncDaemon, TagReader } from '@services/watcher/syncDaemon';
import { writeInboxXml } from '@adapters/rekordbox/inboxXml';
import { readFileSync } from 'fs';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cf-inbox-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function memDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

const fakeReader: TagReader = async (path) => {
  if (path.includes('corrotto')) throw new Error('tag illeggibili');
  return {
    title: 'Levels',
    artist: 'Avicii',
    album: null,
    genre: 'House',
    year: 2011,
    bpm: 126,
    musicalKey: 'C# minor',
    durationS: 210
  };
};

describe('SyncDaemon.scanOnce', () => {
  it('aggiunge solo audio nuovi, idempotente, marca i corrotti', async () => {
    const db = memDb();
    writeFileSync(join(dir, 'a.mp3'), 'x');
    writeFileSync(join(dir, 'corrotto.mp3'), 'x');
    writeFileSync(join(dir, 'nota.txt'), 'non-audio');
    const daemon = new SyncDaemon(db, fakeReader);

    const r1 = await daemon.scanOnce(dir);
    expect(r1.scanned).toBe(2); // solo estensioni audio
    expect(r1.added).toBe(2);
    expect(r1.withIssues).toBe(1);

    // idempotente: secondo giro non duplica
    const r2 = await daemon.scanOnce(dir);
    expect(r2.added).toBe(0);
    expect(r2.skipped).toBe(2);

    const items = listInbox(db, 'new');
    expect(items).toHaveLength(2);
    const good = items.find((i) => i.path.endsWith('a.mp3'))!;
    expect(good.camelot).toBe('12A'); // C# minor → 12A
    expect(good.has_tag_issues).toBe(0);
    const bad = items.find((i) => i.path.includes('corrotto'))!;
    expect(bad.has_tag_issues).toBe(1);
  });

  it('salta i file già in libreria (tracks.path)', async () => {
    const db = memDb();
    const p = join(dir, 'gia-in-lib.mp3');
    writeFileSync(p, 'x');
    db.prepare(
      `INSERT INTO tracks (source, source_id, title, path) VALUES ('xml', '1', 'X', ?)`
    ).run(p);
    const daemon = new SyncDaemon(db, fakeReader);
    const r = await daemon.scanOnce(dir);
    expect(r.added).toBe(0);
    expect(r.skipped).toBe(1);
  });
});

describe('inbox status + XML', () => {
  it('prepara XML con playlist Nuovi Acquisti e aggiorna lo stato', async () => {
    const db = memDb();
    writeFileSync(join(dir, 'a.mp3'), 'x');
    const daemon = new SyncDaemon(db, fakeReader);
    await daemon.scanOnce(dir);
    const items = listInbox(db, 'new');
    const outPath = join(dir, 'out.xml');
    const r = writeInboxXml(items, outPath);
    expect(r.written).toBe(1);
    const xml = readFileSync(outPath, 'utf-8');
    expect(xml).toContain('CrateForge – Nuovi Acquisti');
    expect(xml).toContain('Avicii');
    expect(xml).toContain('file://localhost/');

    setInboxStatus(db, items.map((i) => i.id), 'prepared');
    expect(listInbox(db, 'new')).toHaveLength(0);
    expect(listInbox(db, 'prepared')).toHaveLength(1);
  });
});
