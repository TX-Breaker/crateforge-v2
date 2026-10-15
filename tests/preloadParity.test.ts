import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

/**
 * Lo stub del preload usato dal test di fumo deve avere TUTTI i metodi del
 * preload vero.
 *
 * ⚠ Esiste perché la deriva è già costata cara. Allo stub mancava l'intero
 * spazio dei nomi `sync`: il pannello di sincronizzazione chiamava
 * `window.crateforge.sync.fields()` su `undefined`, il renderer lanciava e
 * l'applicazione smetteva di montare. Il fumo riportava quattordici problemi
 * diversi — niente <main>, voci di sidebar assenti, scorciatoie morte — dove ce
 * n'era uno solo. Poi mancavano `versions.detect` e `library.sources`, per la
 * stessa ragione.
 *
 * Il controllo carica entrambi i preload con un `electron` finto che cattura
 * l'oggetto esposto, e confronta la forma: ogni funzione del vero deve esistere,
 * con lo stesso percorso, nello stub. Chi aggiunge un metodo al preload lo
 * scopre qui, con il nome del metodo, invece che come un'interfaccia che non
 * si monta.
 */

const req = createRequire(__filename);

type Bridge = Record<string, unknown>;

async function caricaVero(): Promise<Bridge> {
  let esposto: Bridge | null = null;
  vi.doMock('electron', () => ({
    contextBridge: { exposeInMainWorld: (_: string, a: Bridge) => (esposto = a) },
    ipcRenderer: {
      invoke: () => Promise.resolve(),
      on: () => undefined,
      removeListener: () => undefined,
      removeAllListeners: () => undefined,
      send: () => undefined
    }
  }));
  await import('../src/preload/index');
  if (!esposto) throw new Error('il preload vero non ha esposto niente');
  return esposto;
}

function caricaStub(): Bridge {
  let esposto: Bridge | null = null;
  const electron = req.resolve('electron');
  const prima = req.cache[electron];
  req.cache[electron] = {
    id: electron,
    filename: electron,
    loaded: true,
    exports: { contextBridge: { exposeInMainWorld: (_: string, a: Bridge) => (esposto = a) } }
  } as unknown as NodeJS.Module;
  try {
    req('./ui/preload.cjs');
  } finally {
    if (prima) req.cache[electron] = prima;
    else delete req.cache[electron];
  }
  if (!esposto) throw new Error('lo stub non ha esposto niente');
  return esposto;
}

function mancanti(vero: Bridge, stub: Bridge | undefined, base = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(vero)) {
    const percorso = base ? `${base}.${k}` : k;
    const s = stub?.[k];
    if (typeof v === 'function') {
      if (typeof s !== 'function') out.push(percorso);
    } else if (v && typeof v === 'object') {
      out.push(...mancanti(v as Bridge, s as Bridge | undefined, percorso));
    }
  }
  return out;
}

describe('preload: lo stub del fumo resta allineato al vero', () => {
  it('ogni metodo del preload vero esiste nello stub', async () => {
    const vero = await caricaVero();
    const stub = caricaStub();
    expect(mancanti(vero, stub)).toEqual([]);
  });
});
