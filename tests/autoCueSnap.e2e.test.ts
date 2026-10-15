import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Allineamento al battito dei cue proposti dall'analisi automatica.
 *
 * Prima il "drop" cadeva su secondi interi (finestre di energia da un secondo)
 * e l'"outro" a durata − 32 s: istanti arbitrari, non battiti. Un hot cue fuori
 * battito, premuto a tempo, parte in anticipo o in ritardo sul colpo.
 *
 * ⚠ L'analisi completa richiede aubio, che nell'ambiente di sviluppo non è
 * installato: qui si verifica la funzione pura che fa l'allineamento, che non
 * dipende da aubio. La raccolta dei battiti usa l'API standard di
 * `aubio.tempo` e, se non produce battiti, i cue restano come prima.
 */

const SIDECAR_DIR = join(__dirname, '..', 'python-sidecar');
const VENV_PY =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');

function snap(t: number, beats: number[]): number {
  const r = spawnSync(
    VENV_PY,
    ['-c', `import json, sidecar as s; print(json.dumps(s._snap_to_beat(${t}, ${JSON.stringify(beats)})))`],
    { encoding: 'utf-8', timeout: 60_000, cwd: SIDECAR_DIR }
  );
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

describe.skipIf(!existsSync(VENV_PY))('Auto-Cue — allineamento al battito', () => {
  const beats = [0.5, 1.0, 1.5, 2.0, 2.5];

  it('porta il cue sul battito più vicino', () => {
    expect(snap(1.2, beats)).toBe(1.0);
    expect(snap(1.3, beats)).toBe(1.5);
    expect(snap(2.0, beats)).toBe(2.0);
  });

  it('non lo sposta di più di mezzo battito', () => {
    // A un battito intero prima del primo rilevato: non c'è un battito "suo".
    expect(snap(0.0, beats)).toBe(0.0);
    expect(snap(9.0, beats)).toBe(9.0);
  });

  it('senza battiti a sufficienza lascia il cue dov è', () => {
    expect(snap(1.2, [])).toBe(1.2);
    expect(snap(1.2, [1.0])).toBe(1.2);
  });
});
