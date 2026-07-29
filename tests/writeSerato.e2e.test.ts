import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * E2E write-serato-cues / write-serato-crates.
 *
 * Il criterio di sicurezza di questo writer non è "il file si apre ancora", ma
 * due cose misurabili:
 *  1) round-trip: quello che scriviamo si rilegge identico con lo stesso parser
 *     che usa l'import;
 *  2) preservazione: le entry che NON sappiamo interpretare (COLOR, BPMLOCK,
 *     FLIP, e qualunque cosa Serato aggiunga) tornano indietro byte per byte.
 *
 * Serato tiene i cue dentro i file audio: senza (2) un writer "inverso del
 * reader" cancellerebbe in silenzio dati dell'utente che il reader ignora.
 */

const SIDECAR_DIR = join(__dirname, '..', 'python-sidecar');
const VENV_PY =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');
const SCRIPT = join(SIDECAR_DIR, 'sidecar.py');
const MAKE_FIXTURE = join(__dirname, 'fixtures', 'make_audio_fixture.py');
const hasVenv = existsSync(VENV_PY);

interface SidecarEvent {
  type: string;
  message?: string;
  data?: Record<string, unknown>;
}

function runSidecar(args: string[]): { code: number | null; events: SidecarEvent[] } {
  const r = spawnSync(VENV_PY, [SCRIPT, ...args], { encoding: 'utf-8', timeout: 120_000 });
  const events = (r.stdout ?? '')
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l) as SidecarEvent);
  return { code: r.status, events };
}

/** Esegue uno snippet Python che può importare il sidecar come modulo. */
function py(code: string, ...args: string[]): string {
  const r = spawnSync(VENV_PY, ['-c', code, ...args], {
    encoding: 'utf-8',
    timeout: 60_000,
    cwd: SIDECAR_DIR
  });
  if (r.status !== 0) throw new Error(`python fallito: ${r.stderr}`);
  return r.stdout.trim();
}

describe.skipIf(!hasVenv)('sidecar write-serato-cues (e2e)', () => {
  it('scrive cue e loop, e li rilegge con il parser dell import', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-serato-w-'));
    try {
      const mp3 = join(tmp, 'brano.mp3');
      spawnSync(VENV_PY, [MAKE_FIXTURE, mp3, '--title', 'T', '--artist', 'A'], {
        encoding: 'utf-8',
        timeout: 30_000
      });
      expect(existsSync(mp3)).toBe(true);

      const jobs = [
        {
          path: mp3,
          cues: [
            { index: 0, positionMs: 1000, color: '#CC0000', label: 'Intro' },
            { index: 3, positionMs: 45250, color: '#0000CC', label: 'Drop' }
          ],
          loops: [{ index: 1, startMs: 8000, endMs: 12000, color: '#27AAE1', label: 'Loop 2' }]
        }
      ];
      const { events } = runSidecar([
        'write-serato-cues',
        '--udm-path',
        join(tmp, 'udm.db'),
        '--cues-json',
        JSON.stringify(jobs),
        '--backup-dir',
        join(tmp, 'backup')
      ]);
      const done = events.find((e) => e.type === 'done');
      expect(done?.data?.written).toBe(1);
      expect(done?.data?.failed).toBe(0);

      // Rilettura con lo STESSO parser usato dall'import: se il round-trip non
      // regge, l'utente vedrebbe cue diversi da quelli che ha chiesto.
      const out = py(
        'import json,sys,mutagen,sidecar\n' +
          'a=mutagen.File(sys.argv[1])\n' +
          'g=[a.tags[k] for k in a.tags if str(k).startswith("GEOB") and a.tags[k].desc=="Serato Markers2"]\n' +
          'print(json.dumps(sidecar.parse_serato_markers2(bytes(g[0].data))))',
        mp3
      );
      const parsed = JSON.parse(out) as [string, number, number, number | null, string, string][];
      const hot = parsed.filter((p) => p[0] === 'hot');
      const loops = parsed.filter((p) => p[0] === 'loop');
      expect(hot).toHaveLength(2);
      expect(hot[0]).toEqual(['hot', 0, 1000, null, '#CC0000', 'Intro']);
      expect(hot[1]).toEqual(['hot', 3, 45250, null, '#0000CC', 'Drop']);
      expect(loops).toHaveLength(1);
      expect(loops[0][1]).toBe(1);
      expect(loops[0][2]).toBe(8000);
      expect(loops[0][3]).toBe(4000); // durata = fine - inizio
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 180_000);

  it('rimette identiche le entry che non sa interpretare', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-serato-p-'));
    try {
      const mp3 = join(tmp, 'brano.mp3');
      spawnSync(VENV_PY, [MAKE_FIXTURE, mp3, '--title', 'T', '--artist', 'A'], {
        encoding: 'utf-8',
        timeout: 30_000
      });

      // Blob di partenza con entry che il reader NON interpreta: COLOR (colore
      // della traccia), BPMLOCK e una entry inventata che sta per "qualcosa che
      // Serato aggiungerà in futuro".
      py(
        'import sys,mutagen,sidecar\n' +
          'from mutagen.id3 import GEOB\n' +
          'entries=[("COLOR", bytes.fromhex("00ff9900")), ("BPMLOCK", b"\\x01"), ("MYSTERY", b"dati opachi")]\n' +
          'blob=sidecar._serato_build_markers2(b"\\x01\\x01", entries, None)\n' +
          'a=mutagen.File(sys.argv[1])\n' +
          'a.tags.add(GEOB(encoding=0, mime="application/octet-stream", desc="Serato Markers2", data=blob))\n' +
          'a.save()',
        mp3
      );

      const { events } = runSidecar([
        'write-serato-cues',
        '--udm-path',
        join(tmp, 'udm.db'),
        '--cues-json',
        JSON.stringify([{ path: mp3, cues: [{ index: 0, positionMs: 500, color: '#112233', label: 'C' }] }]),
        '--backup-dir',
        join(tmp, 'backup')
      ]);
      expect(events.find((e) => e.type === 'done')?.data?.written).toBe(1);

      const out = py(
        'import base64,json,sys,mutagen,sidecar\n' +
          'a=mutagen.File(sys.argv[1])\n' +
          'g=[a.tags[k] for k in a.tags if str(k).startswith("GEOB") and a.tags[k].desc=="Serato Markers2"]\n' +
          'raw=bytes(g[0].data)\n' +
          'b64=raw[2:].replace(b"\\n", b"").split(b"\\x00")[0]\n' +
          'body=base64.b64decode(b64 + b"=" * (-len(b64) % 4))\n' +
          'print(json.dumps([(n, p.hex()) for n, p in sidecar._serato_split_entries(body)]))',
        mp3
      );
      const entries = JSON.parse(out) as [string, string][];
      const byName = new Map(entries);
      expect(byName.get('COLOR')).toBe('00ff9900');
      expect(byName.get('BPMLOCK')).toBe('01');
      expect(byName.get('MYSTERY')).toBe(Buffer.from('dati opachi', 'utf-8').toString('hex'));
      expect(entries.some(([n]) => n === 'CUE')).toBe(true);
      // COLOR resta in testa, come nei file scritti da Serato.
      expect(entries[0][0]).toBe('COLOR');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 180_000);

  it('annulla la scrittura se nel blob restano byte non riconosciuti', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-serato-x-'));
    try {
      const mp3 = join(tmp, 'brano.mp3');
      spawnSync(VENV_PY, [MAKE_FIXTURE, mp3, '--title', 'T', '--artist', 'A'], {
        encoding: 'utf-8',
        timeout: 30_000
      });
      // Corpo con una coda che il parser non sa consumare: è il caso "versione
      // di Serato più recente della nostra". Riscrivere cancellerebbe quei byte.
      py(
        'import base64,sys,mutagen,sidecar\n' +
          'from mutagen.id3 import GEOB\n' +
          'body=b"\\x01\\x01" + b"COLOR\\x00" + (4).to_bytes(4,"big") + bytes.fromhex("00ff9900") + b"coda-ignota"\n' +
          'enc=base64.b64encode(body)\n' +
          'blob=b"\\x01\\x01" + b"\\n".join(enc[i:i+72] for i in range(0,len(enc),72)) + b"\\x00"\n' +
          'a=mutagen.File(sys.argv[1])\n' +
          'a.tags.add(GEOB(encoding=0, mime="application/octet-stream", desc="Serato Markers2", data=blob))\n' +
          'a.save()',
        mp3
      );

      const { events } = runSidecar([
        'write-serato-cues',
        '--udm-path',
        join(tmp, 'udm.db'),
        '--cues-json',
        JSON.stringify([{ path: mp3, cues: [{ index: 0, positionMs: 500, color: '#112233', label: 'C' }] }]),
        '--backup-dir',
        join(tmp, 'backup')
      ]);
      const done = events.find((e) => e.type === 'done');
      expect(done?.data?.written).toBe(0);
      const results = done?.data?.results as { error: string | null; rolledBack: boolean }[];
      expect(results[0].error).toMatch(/non riconosciuti/);
      expect(results[0].rolledBack).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 180_000);
});

describe.skipIf(!hasVenv)('sidecar write-serato-crates (e2e)', () => {
  it('scrive i crate e non sovrascrive mai quelli esistenti', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cf-crates-'));
    try {
      const seratoDir = join(tmp, '_Serato_');
      const jobs = [
        { name: 'Set Sabato', paths: [join(tmp, 'a.mp3'), join(tmp, 'b.mp3')] },
        { name: 'Warmup', paths: [join(tmp, 'c.mp3')] }
      ];
      // La cartella _Serato_ deve esistere: il comando non la inventa.
      spawnSync(VENV_PY, ['-c', 'import os,sys;os.makedirs(sys.argv[1])', seratoDir], {
        encoding: 'utf-8'
      });

      const first = runSidecar([
        'write-serato-crates',
        '--udm-path',
        join(tmp, 'udm.db'),
        '--serato-dir',
        seratoDir,
        '--crates-json',
        JSON.stringify(jobs)
      ]);
      const done1 = first.events.find((e) => e.type === 'done');
      expect(done1?.data?.written).toBe(2);
      expect(existsSync(join(seratoDir, 'Subcrates', 'Set Sabato.crate'))).toBe(true);

      // Secondo giro: i crate ci sono già. Il formato non ha un round-trip
      // verificato contro un crate scritto da Serato, quindi non si tocca
      // nulla — si dichiara solo cosa è stato saltato.
      const second = runSidecar([
        'write-serato-crates',
        '--udm-path',
        join(tmp, 'udm.db'),
        '--serato-dir',
        seratoDir,
        '--crates-json',
        JSON.stringify(jobs)
      ]);
      const done2 = second.events.find((e) => e.type === 'done');
      expect(done2?.data?.written).toBe(0);
      expect(done2?.data?.skipped).toEqual(['Set Sabato', 'Warmup']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});
