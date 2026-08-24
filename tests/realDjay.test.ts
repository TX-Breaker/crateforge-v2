import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { readDjayLibrary } from '../src/adapters/djay/reader';
import { djayDatabasePath, DJAY_DB_FILENAME } from '../src/adapters/djay';

/**
 * Validazione del lettore djay Pro contro la libreria REALE installata su
 * questa macchina, aperta in SOLA LETTURA.
 *
 * ⚠ Nessun titolo, artista o percorso della libreria personale finisce negli
 * asserti o nell'output: si verificano forme, conteggi e invarianti. Un test
 * che stampasse la libreria dell'utente sarebbe un test che la copia dentro un
 * log di CI.
 *
 * Si auto-salta se djay non è installato: la suite deve girare anche su una
 * macchina pulita.
 */

const db = djayDatabasePath();
const disponibile = db !== null && existsSync(db);
const d = disponibile ? describe : describe.skip;

d('djay Pro — libreria reale (sola lettura)', () => {
  it('trova il database dove djay lo mette davvero', () => {
    // ⚠ Non è in %LOCALAPPDATA%, dove questo codice lo cercava prima della
    // verifica: djay arriva dallo Store e tiene la libreria fra i documenti
    // dell'utente. Il test fissa la scoperta.
    expect(db!.endsWith(DJAY_DB_FILENAME)).toBe(true);
    if (process.platform === 'win32') {
      expect(db!.toLowerCase()).toContain('music');
      expect(db!.toLowerCase()).not.toContain('appdata\local\djay');
    }
  });

  it('legge la libreria senza lanciare e rende conto di ogni riga', () => {
    const lib = readDjayLibrary(db!);
    expect(lib.source).toBe('djay');
    expect(lib.scanned).toBeGreaterThan(0);
    // Ogni riga letta compare nella ripartizione: il denominatore deve tornare,
    // altrimenti i numeri mostrati all'utente sono inventati.
    const somma = lib.byCollection.reduce((n, c) => n + c.rows, 0);
    expect(somma).toBe(lib.scanned);
    expect(lib.unreadable).toBeLessThanOrEqual(lib.scanned);
  });

  it('il formato proprietario si decodifica in little-endian', () => {
    /* È la scoperta che ha cambiato il parser. In big-endian, sulla stessa
       libreria, i conteggi degli array diventavano decine di milioni e le
       durate dei brani denormali del tipo 6.8e-313. Il test non rilegge i
       byte: verifica la conseguenza osservabile, cioè che le collezioni
       strutturali si decodifichino tutte. */
    const lib = readDjayLibrary(db!);
    const perNome = new Map(lib.byCollection.map((c) => [c.collection, c]));
    for (const nome of ['contentPackMediaItems', 'mediaItemTitleIDs', 'mediaItemPlaylists']) {
      const c = perNome.get(nome);
      if (!c) continue;
      expect(c.unreadable, `${nome}: righe illeggibili`).toBe(0);
    }
  });

  it('non scambia i contenuti di djay per musica dell utente', () => {
    /* ⚠ Il test che la versione precedente non aveva. La regola era «ha un
       titolo, quindi è una traccia», e su questa libreria produceva 80 tracce
       da 99 pacchetti di contenuti distribuiti da djay. Il numero di brani non
       può superare il numero di righe nelle collezioni che contengono brani. */
    const lib = readDjayLibrary(db!);
    const perNome = new Map(lib.byCollection.map((c) => [c.collection, c.rows]));
    const capienza =
      (perNome.get('mediaItemTitleIDs') ?? 0) + (perNome.get('globalMediaItemLocations') ?? 0);
    expect(lib.tracks.length).toBeLessThanOrEqual(capienza);

    const pacchetti =
      (perNome.get('contentPacks') ?? 0) + (perNome.get('contentPackMediaItems') ?? 0);
    if (pacchetti > 0) {
      // Se i pacchetti rientrassero fra le tracce, il conteggio li supererebbe.
      expect(lib.tracks.length).toBeLessThan(pacchetti);
    }
  });

  it('dichiara che cue, valutazioni e analisi non sono importati', () => {
    // Un import che tace su ciò che non ha portato è peggio di uno che fallisce:
    // l'utente crede di avere i suoi cue e li scopre assenti in serata.
    const lib = readDjayLibrary(db!);
    expect(lib.warnings.some((w) => w.toLowerCase().includes('cue'))).toBe(true);
    expect(lib.warnings.some((w) => w.toLowerCase().includes('beatgrid'))).toBe(true);
  });
});
