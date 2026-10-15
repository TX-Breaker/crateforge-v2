import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * I due writer del sidecar su un FLAC, e il confine fra loro.
 *
 * ⚠ Esiste perché il confine è stato violato. Il rifiuto di scrivere cue
 * Serato fuori da ID3 è stato inserito per sbaglio nel writer dei tag GENERICI
 * — uno script sostituiva la prima occorrenza di un blocco che i due writer
 * hanno identico. Il risultato sarebbe stato che nessun tag poteva più essere
 * scritto su un FLAC o un M4A. Lo ha colto un test vicino solo per caso; questo
 * lo coglie per costruzione:
 *
 *  - write-tags DEVE scrivere un FLAC;
 *  - write-serato-cues DEVE rifiutarlo, prima di fare il backup, lasciando il
 *    file identico.
 */

const SIDECAR_DIR = join(__dirname, '..', 'python-sidecar');
const VENV_PY =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');
const SCRIPT = join(SIDECAR_DIR, 'sidecar.py');
const hasVenv = existsSync(VENV_PY);

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** FLAC minimo valido: `fLaC` + un blocco STREAMINFO, che mutagen accetta. */
function makeFlac(path: string): void {
  const code = `
import struct, sys
sr, ch, bps, total = 44100, 2, 16, 0
packed = (sr << 44) | ((ch - 1) << 41) | ((bps - 1) << 36) | total
info = struct.pack(">HH", 4096, 4096) + b"\\x00\\x00\\x00" * 2 + packed.to_bytes(8, "big") + b"\\x00" * 16
with open(sys.argv[1], "wb") as f:
    f.write(b"fLaC" + bytes([0x80]) + len(info).to_bytes(3, "big") + info)
`;
  const r = spawnSync(VENV_PY, ['-c', code, path], { encoding: 'utf-8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr);
}

function run(args: string[]) {
  const r = spawnSync(VENV_PY, [SCRIPT, ...args], { encoding: 'utf-8', timeout: 120_000 });
  const events = (r.stdout ?? '')
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l) as { type: string; data?: { results?: Record<string, unknown>[] } });
  return { code: r.status, done: events.find((e) => e.type === 'done') };
}

describe.skipIf(!hasVenv)('writer del sidecar su FLAC', () => {
  it('write-tags scrive i tag di un FLAC', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-flac-'));
    try {
      const flac = join(tmp, 'brano.flac');
      makeFlac(flac);
      const { code, done } = run([
        'write-tags',
        '--udm-path', join(tmp, 'u.db'),
        '--tags-json', JSON.stringify([{ path: flac, tags: { title: 'Titolo', artist: 'Artista' } }]),
        '--backup-dir', join(tmp, 'bk')
      ]);
      expect(code).toBe(0);
      const r = done!.data!.results![0];
      expect(r.error).toBeNull();
      expect(r.ok).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('write-serato-cues rifiuta un FLAC prima del backup, lasciandolo identico', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-flac-'));
    try {
      const flac = join(tmp, 'brano.flac');
      makeFlac(flac);
      const prima = sha256(flac);
      const bk = join(tmp, 'bk');
      const { done } = run([
        'write-serato-cues',
        '--udm-path', join(tmp, 'u.db'),
        '--cues-json', JSON.stringify([{ path: flac, cues: [{ index: 0, positionMs: 1000 }] }]),
        '--backup-dir', bk
      ]);
      const r = done!.data!.results![0];
      expect(r.ok).toBe(false);
      expect(String(r.error)).toMatch(/non verificato/);
      expect(sha256(flac)).toBe(prima);
      // Fermato prima di toccare il file: nessuna copia di backup del brano.
      const copie = existsSync(bk) ? readdirSync(bk).filter((f) => f.endsWith('.flac')) : [];
      expect(copie).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
