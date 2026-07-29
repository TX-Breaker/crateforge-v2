import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeBackup, planBackup } from '@services/backup/incrementalBackup';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'crateforge-backup-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function setup() {
  const music = join(tmp, 'music');
  const backup = join(tmp, 'backup');
  mkdirSync(music, { recursive: true });
  writeFileSync(join(music, 'a.mp3'), 'AAA');
  writeFileSync(join(music, 'b.mp3'), 'BBBB');
  writeFileSync(join(tmp, 'master.db'), 'fakedb');
  writeFileSync(join(tmp, 'options.json'), '{}');
  return { music, backup };
}

describe('backup incrementale', () => {
  it('primo giro: tutto "new"; il piano è un dry-run puro', async () => {
    const { music, backup } = setup();
    const plan = await planBackup({ musicDir: music, backupDir: backup });
    expect(plan.items).toHaveLength(2);
    expect(plan.items.every((i) => i.reason === 'new')).toBe(true);
    expect(plan.totalBytes).toBe(7);
    expect(existsSync(backup)).toBe(false); // il piano non scrive nulla
  });

  it('secondo giro: copia solo i modificati (mtime+size)', async () => {
    const { music, backup } = setup();
    const opts = {
      musicDir: music,
      backupDir: backup,
      masterDbPath: join(tmp, 'master.db'),
      optionsJsonPath: join(tmp, 'options.json')
    };
    const plan1 = await planBackup(opts);
    const r1 = await executeBackup(plan1, opts);
    expect(r1.copied).toBe(2);
    // Snapshot DB creato PRIMA della copia (§3.2), con options.json
    expect(r1.dbSnapshotDir).toBeTruthy();
    expect(readFileSync(join(r1.dbSnapshotDir!, 'master.db'), 'utf-8')).toBe('fakedb');
    expect(existsSync(join(r1.dbSnapshotDir!, 'options.json'))).toBe(true);

    // Nessuna modifica → piano vuoto
    const plan2 = await planBackup(opts);
    expect(plan2.items).toHaveLength(0);

    // Modifica un file (contenuto + mtime futuro) → solo quello
    writeFileSync(join(music, 'a.mp3'), 'AAA2');
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(music, 'a.mp3'), future, future);
    const plan3 = await planBackup(opts);
    expect(plan3.items).toHaveLength(1);
    expect(plan3.items[0].reason).toBe('modified');
    expect(plan3.items[0].src.endsWith('a.mp3')).toBe(true);
  });

  it('con useHash verifica l\'integrità della copia (§3.5)', async () => {
    const { music, backup } = setup();
    const opts = { musicDir: music, backupDir: backup, useHash: true };
    const plan = await planBackup(opts);
    const r = await executeBackup(plan, opts);
    expect(r.copied).toBe(2);
    expect(r.failed).toHaveLength(0);
    expect(readFileSync(join(backup, 'music', 'a.mp3'), 'utf-8')).toBe('AAA');
  });
});
