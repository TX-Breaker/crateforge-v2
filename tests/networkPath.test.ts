import { describe, expect, it } from 'vitest';
import { isNetworkPath, isUncPath, networkPathWarning } from '../src/main/networkPath';

/**
 * Le librerie DJ sono database SQLite, e SQLite non regge i lock su SMB/NFS:
 * su una share si ottiene "impossibile aprire il database" anche con i
 * permessi giusti. Riconoscere il percorso di rete PRIMA serve a spiegare la
 * causa vera invece di lasciare all'utente un errore criptico.
 */
describe('riconoscimento dei percorsi di rete', () => {
  it('riconosce i percorsi UNC in entrambe le forme di separatore', () => {
    expect(isUncPath('\\\\NAS\\musica\\Engine Library')).toBe(true);
    expect(isUncPath('//nas/musica/Engine Library')).toBe(true);
    expect(isNetworkPath('\\\\NAS\\musica\\m.db')).toBe(true);
  });

  it('non scambia per rete un percorso locale', () => {
    expect(isUncPath('C:\\Users\\Vale\\Music\\m.db')).toBe(false);
    expect(isUncPath('/Users/utente/Music/m.db')).toBe(false);
    expect(isUncPath('')).toBe(false);
    // Una singola barra iniziale non è UNC: è la radice su Unix.
    expect(isUncPath('/nas/musica')).toBe(false);
  });

  it('avvisa solo quando serve: nessun rumore sui percorsi locali', () => {
    expect(networkPathWarning('C:\\Users\\Vale\\Music\\m.db')).toBeNull();
    const w = networkPathWarning('\\\\NAS\\musica\\Engine Library\\Database2\\m.db');
    expect(w).toContain('unità di rete');
    // L'avviso deve dire cosa fare, non solo che c'è un problema.
    expect(w).toContain('disco locale');
  });
});
