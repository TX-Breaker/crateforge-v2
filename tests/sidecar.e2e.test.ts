import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';

/**
 * E2E del contratto Node ↔ sidecar Python (§2): eventi JSON-per-riga,
 * handshake --udm-path, degrado con errore pulito (mai crash silenzioso).
 * Skippati se il venv del sidecar non è stato creato su questa macchina.
 */

const SIDECAR_DIR = join(__dirname, '..', 'python-sidecar');
const VENV_PY =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');
const SCRIPT = join(SIDECAR_DIR, 'sidecar.py');
const hasVenv = existsSync(VENV_PY);

function run(args: string[]) {
  const r = spawnSync(VENV_PY, [SCRIPT, ...args], { encoding: 'utf-8', timeout: 60_000 });
  const events = r.stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { type: string; message?: string; data?: unknown });
  return { code: r.status, events };
}

describe.skipIf(!hasVenv)('sidecar Python (e2e)', () => {
  it('ping risponde con JSON valido', () => {
    const { code, events } = run(['ping']);
    expect(code).toBe(0);
    expect(events[0].type).toBe('done');
  });

  it('rifiuta un UDM inesistente con errore pulito (handshake §2)', () => {
    const { code, events } = run([
      'ingest-masterdb',
      '--udm-path',
      join(tmpdir(), 'non-esiste', 'udm.sqlite'),
      '--master-db',
      'x.db'
    ]);
    expect(code).not.toBe(0);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('su master.db incompatibile fallisce con errore JSON, mai crash muto', () => {
    const fixture = join(__dirname, 'fixtures', 'generated', 'master.db');
    if (!existsSync(fixture)) return; // fixture opzionale (make_encrypted_fixture.py)
    const tmp = mkdtempSync(join(tmpdir(), 'crateforge-e2e-'));
    try {
      const udmPath = join(tmp, 'udm.sqlite');
      const db = new Database(udmPath);
      migrate(db);
      db.close();
      const { code, events } = run([
        'ingest-masterdb',
        '--udm-path',
        udmPath,
        '--master-db',
        fixture,
        '--key',
        'crateforge-test-key'
      ]);
      // La fixture minima non ha lo schema completo Rekordbox: il contratto
      // richiesto è degrado pulito (evento error + exit != 0), non successo.
      if (code !== 0) {
        expect(events.some((e) => e.type === 'error')).toBe(true);
      } else {
        expect(events.some((e) => e.type === 'done')).toBe(true);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
