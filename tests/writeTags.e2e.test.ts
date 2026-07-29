import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * E2E write-tags (§3.4): backup per-file verificato con hash, scrittura
 * mutagen, rollback automatico su errore. La fixture MP3 è generata in Python
 * (make_audio_fixture.py): un vero MPEG riconosciuto da mutagen, mai byte
 * fabbricati a mano in Node.
 */

const SIDECAR_DIR = join(__dirname, '..', 'python-sidecar');
const VENV_PY =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');
const SCRIPT = join(SIDECAR_DIR, 'sidecar.py');
const MAKE_FIXTURE = join(__dirname, 'fixtures', 'make_audio_fixture.py');
const hasVenv = existsSync(VENV_PY);

function runSidecar(args: string[]) {
  const r = spawnSync(VENV_PY, [SCRIPT, ...args], { encoding: 'utf-8', timeout: 60_000 });
  const events = r.stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { type: string; message?: string; data?: never });
  return { code: r.status, events };
}

function readTags(path: string): Record<string, string[]> {
  const py =
    'import json,sys,mutagen;a=mutagen.File(sys.argv[1],easy=True);' +
    'print(json.dumps({k:list(v) for k,v in (a or {}).items()}))';
  const r = spawnSync(VENV_PY, ['-c', py, path], { encoding: 'utf-8', timeout: 30_000 });
  return JSON.parse(r.stdout.trim());
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

interface WriteTagsDone {
  written: number;
  failed: number;
  backupDir: string;
  results: { path: string; ok: boolean; rolledBack: boolean; error: string | null }[];
}

describe.skipIf(!hasVenv)('sidecar write-tags (e2e, §3.4)', () => {
  it('scrive i tag, con backup identico all\'originale pre-scrittura', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'crateforge-wt-'));
    try {
      const mp3 = join(tmp, 'brano.mp3');
      const gen = spawnSync(
        VENV_PY,
        [MAKE_FIXTURE, mp3, '--title', 'Vecchio Titolo', '--artist', 'Vecchio Artista'],
        { encoding: 'utf-8', timeout: 30_000 }
      );
      expect(gen.status).toBe(0);
      const preHash = sha256(mp3);

      const backupDir = join(tmp, 'backup');
      const jobs = [
        { path: mp3, tags: { title: 'Nuovo Titolo', artist: 'Nuovo Artista', bpm: 128 } }
      ];
      const { code, events } = runSidecar([
        'write-tags',
        '--udm-path',
        join(tmp, 'udm.sqlite'),
        '--tags-json',
        JSON.stringify(jobs),
        '--backup-dir',
        backupDir
      ]);
      expect(code).toBe(0);
      const done = events.find((e) => e.type === 'done') as unknown as { data: WriteTagsDone };
      expect(done).toBeDefined();
      expect(done.data.written).toBe(1);
      expect(done.data.failed).toBe(0);

      // Il backup esiste ed è byte-identico all'originale PRIMA della scrittura.
      const backups = readdirSync(backupDir);
      expect(backups.length).toBe(1);
      expect(sha256(join(backupDir, backups[0]))).toBe(preHash);

      // I tag sono davvero cambiati e il file resta un MP3 leggibile.
      const tags = readTags(mp3);
      expect(tags.title).toEqual(['Nuovo Titolo']);
      expect(tags.artist).toEqual(['Nuovo Artista']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('su file non-audio: errore + rollback verificato, contenuto intatto', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'crateforge-wt-'));
    try {
      // .mp3 solo di nome: mutagen non lo riconosce → deve scattare il rollback.
      const fake = join(tmp, 'non-audio.mp3');
      writeFileSync(fake, 'questo non è un mp3');
      const preHash = sha256(fake);

      const { code, events } = runSidecar([
        'write-tags',
        '--udm-path',
        join(tmp, 'udm.sqlite'),
        '--tags-json',
        JSON.stringify([{ path: fake, tags: { title: 'X' } }]),
        '--backup-dir',
        join(tmp, 'backup')
      ]);
      expect(code).toBe(0); // il comando gestisce l'errore per-file, non crasha
      const done = events.find((e) => e.type === 'done') as unknown as { data: WriteTagsDone };
      expect(done.data.written).toBe(0);
      expect(done.data.failed).toBe(1);
      expect(done.data.results[0].rolledBack).toBe(true);
      // Rollback a prova di bomba: il file è byte-identico a prima.
      expect(sha256(fake)).toBe(preHash);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('accetta il payload via --tags-file (batch grandi, limite argv Windows)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'crateforge-wt-'));
    try {
      const mp3 = join(tmp, 'b.mp3');
      spawnSync(VENV_PY, [MAKE_FIXTURE, mp3, '--title', 'Old', '--artist', 'A'], {
        encoding: 'utf-8',
        timeout: 30_000
      });
      const tagsFile = join(tmp, 'tags.json');
      writeFileSync(tagsFile, JSON.stringify([{ path: mp3, tags: { title: 'Da File' } }]));
      const { code, events } = runSidecar([
        'write-tags',
        '--udm-path',
        join(tmp, 'udm.sqlite'),
        '--tags-file',
        tagsFile,
        '--backup-dir',
        join(tmp, 'backup')
      ]);
      expect(code).toBe(0);
      const done = events.find((e) => e.type === 'done') as unknown as { data: WriteTagsDone };
      expect(done.data.written).toBe(1);
      expect(readTags(mp3).title).toEqual(['Da File']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('file inesistente: fallisce pulito senza toccare nulla', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'crateforge-wt-'));
    try {
      const { code, events } = runSidecar([
        'write-tags',
        '--udm-path',
        join(tmp, 'udm.sqlite'),
        '--tags-json',
        JSON.stringify([{ path: join(tmp, 'manca.mp3'), tags: { title: 'X' } }]),
        '--backup-dir',
        join(tmp, 'backup')
      ]);
      expect(code).toBe(0);
      const done = events.find((e) => e.type === 'done') as unknown as { data: WriteTagsDone };
      expect(done.data.failed).toBe(1);
      expect(done.data.results[0].error).toContain('file non trovato');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
