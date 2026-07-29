import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { deleteOrphans, findOrphans, quarantineOrphans } from '@services/orphans/orphanFinder';
import { canonicalizeName, canonicalizePath } from '@services/fsutil';

let tmp: string;
let db: InstanceType<typeof Database>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'crateforge-orphans-'));
  db = new Database(':memory:');
  migrate(db);
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function makeMusicDir(): string {
  const music = join(tmp, 'music');
  mkdirSync(join(music, 'sub'), { recursive: true });
  writeFileSync(join(music, 'known.mp3'), 'a'.repeat(100));
  writeFileSync(join(music, 'orphan1.mp3'), 'b'.repeat(200));
  writeFileSync(join(music, 'sub', 'orphan2.flac'), 'c'.repeat(300));
  writeFileSync(join(music, 'not-audio.txt'), 'x'); // ignorato
  return music;
}

describe('findOrphans (diff disco vs libreria)', () => {
  it('trova solo i file assenti dal DB, case-insensitive', () => {
    const music = makeMusicDir();
    // path noto con case diverso: NON deve risultare orfano
    db.prepare(
      `INSERT INTO tracks (source, source_id, title, path) VALUES ('xml', '1', 'K', ?)`
    ).run(join(music, 'KNOWN.MP3'));

    return findOrphans(db, music).then((r) => {
      expect(r.scannedFiles).toBe(3); // txt escluso
      const names = r.orphans.map((o) => o.path);
      expect(names).toHaveLength(2);
      expect(names.some((p) => p.endsWith('orphan1.mp3'))).toBe(true);
      expect(names.some((p) => p.endsWith('orphan2.flac'))).toBe(true);
      expect(r.reclaimableBytes).toBe(500);
    });
  });
});

describe('canonicalizePath / canonicalizeName (NFC, rischio dati macOS)', () => {
  it('NFC e NFD della stessa stringa collassano sulla stessa chiave', () => {
    const nfc = 'Café.mp3'; // e precomposto (NFC)
    const nfd = 'Café.mp3'; // e + accento combinante (NFD)
    expect(nfc).not.toBe(nfd); // byte diversi
    expect(canonicalizeName(nfc)).toBe(canonicalizeName(nfd));
    expect(canonicalizePath('C:/M/' + nfc)).toBe(canonicalizePath('C:/M/' + nfd));
  });
});

describe('quarantineOrphans', () => {
  it('due orfani omonimi non si sovrascrivono (rename overwrite)', async () => {
    const music = join(tmp, 'music');
    mkdirSync(join(music, 'a'), { recursive: true });
    mkdirSync(join(music, 'b'), { recursive: true });
    writeFileSync(join(music, 'a', 'dup.mp3'), 'AAA');
    writeFileSync(join(music, 'b', 'dup.mp3'), 'BBB');
    const r = await quarantineOrphans(
      db,
      [join(music, 'a', 'dup.mp3'), join(music, 'b', 'dup.mp3')],
      join(tmp, 'q'),
      false
    );
    expect(r.moved).toBe(2);
    // Entrambi presenti in quarantena, il secondo con prefisso: nessuno perso.
    const q = join(r.quarantineDir);
    expect(existsSync(join(q, 'dup.mp3'))).toBe(true);
    expect(existsSync(join(q, '1_dup.mp3'))).toBe(true);
  });

  it('dry-run non tocca nulla (§3.6)', async () => {
    const music = makeMusicDir();
    const orphan = join(music, 'orphan1.mp3');
    const r = await quarantineOrphans(db, [orphan], join(tmp, 'quarantine'), true);
    expect(r.moved).toBe(1);
    expect(existsSync(orphan)).toBe(true); // ancora al suo posto
    const log = db.prepare(`SELECT outcome FROM oplog ORDER BY id DESC LIMIT 1`).get() as {
      outcome: string;
    };
    expect(log.outcome).toBe('dry-run');
  });

  it('esecuzione sposta (mai elimina) e logga', async () => {
    const music = makeMusicDir();
    const orphan = join(music, 'orphan1.mp3');
    const r = await quarantineOrphans(db, [orphan], join(tmp, 'quarantine'), false);
    expect(r.moved).toBe(1);
    expect(r.failed).toHaveLength(0);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(join(r.quarantineDir, 'orphan1.mp3'))).toBe(true);
  });
});

describe('deleteOrphans (scritture dirette, fase intermedia)', () => {
  it('dry-run: conta i byte, non elimina nulla', async () => {
    const music = makeMusicDir();
    const orphan = join(music, 'orphan1.mp3');
    const r = await deleteOrphans(db, [orphan], true);
    expect(r.freedBytes).toBe(200);
    expect(existsSync(orphan)).toBe(true);
  });

  it('esecuzione: elimina, riporta byte liberati, logga', async () => {
    const music = makeMusicDir();
    const orphan = join(music, 'orphan1.mp3');
    const r = await deleteOrphans(db, [orphan], false);
    expect(r.deleted).toBe(1);
    expect(r.freedBytes).toBe(200);
    expect(existsSync(orphan)).toBe(false);
    const log = db.prepare(`SELECT detail FROM oplog ORDER BY id DESC LIMIT 1`).get() as {
      detail: string;
    };
    expect(log.detail).toContain('DEFINITIVAMENTE');
  });

  it('file inesistente: finisce in failed, nessun crash', async () => {
    const r = await deleteOrphans(db, [join(tmp, 'ghost.mp3')], false);
    expect(r.deleted).toBe(0);
    expect(r.failed).toHaveLength(1);
  });
});
