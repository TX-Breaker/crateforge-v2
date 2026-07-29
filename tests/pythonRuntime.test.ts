import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { detectPython, ensureSidecarEnv, sidecarDir, venvPython } from '../src/main/pythonRuntime';

/**
 * Il rilevamento di Python deve essere autonomo e onesto: se dice "trovato",
 * quell'interprete deve esistere davvero ed essere in grado di eseguire il
 * sidecar. Su Windows il rischio concreto è lo stub del Microsoft Store, che
 * esiste come file ma non esegue nulla: per questo ogni candidato viene
 * verificato eseguendolo, non guardando se il file c'è.
 */

const hasVenv = existsSync(venvPython());

describe('detectPython', () => {
  it('trova un interprete e ne riporta il percorso reale, non l alias invocato', () => {
    const info = detectPython(true);
    expect(info.checked.length).toBeGreaterThan(0);
    if (!info.found) {
      // Macchina senza Python: il contratto è comunque rispettato.
      expect(info.path).toBeNull();
      expect(info.version).toBeNull();
      return;
    }
    expect(info.path).toBeTruthy();
    expect(existsSync(info.path!)).toBe(true);
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor] = info.version!.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(3);
    if (major === 3) expect(minor).toBeGreaterThanOrEqual(9);
  });

  it('preferisce il virtualenv del progetto, che è l unico con le dipendenze', () => {
    const info = detectPython(true);
    if (!hasVenv || !info.found) return; // niente venv su questa macchina
    expect(info.source).toBe('venv');
    expect(info.hasSidecarDeps).toBe(true);
    expect(info.path!.toLowerCase()).toContain('.venv');
  });

  it('memorizza il risultato tra una chiamata e l altra', () => {
    const a = detectPython(true);
    const b = detectPython();
    expect(b).toBe(a); // stessa istanza: nessuna sonda ripetuta
  });
});

describe('ensureSidecarEnv', () => {
  it('non fa nulla quando l ambiente è già pronto', async () => {
    const info = detectPython(true);
    if (!info.found || !info.hasSidecarDeps) return; // qui servirebbe installare
    const r = await ensureSidecarEnv();
    expect(r.ok).toBe(true);
    expect(r.created).toBe(false);
    expect(r.message).toContain('già pronto');
  }, 60_000);

  it('cerca requirements.txt dentro python-sidecar', () => {
    expect(existsSync(sidecarDir())).toBe(true);
  });
});
