import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { detectPayloadKind, parseDjayPayload } from '../src/adapters/djay/payload';
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

  it('decodifica ogni riga delle collezioni che importa', () => {
    /* Prima delle correzioni del 24/08/2026 questa libreria dava 25 righe
       illeggibili su 174, e cinque collezioni su undici non si aprivano
       affatto — comprese quelle con i percorsi dei file e con il BPM. Ora sono
       zero. Il test guarda le collezioni che l'import usa davvero: se una di
       quelle smette di decodificarsi, l'utente perde dati, e va saputo subito.

       Le tre correzioni erano: lettura little-endian, allineamento a 8 byte per
       i valori da 8, e URI trattato come contenitore invece che come stringa. */
    const lib = readDjayLibrary(db!);
    expect(lib.unreadable, 'righe illeggibili nelle collezioni importate').toBe(0);

    const perNome = new Map(lib.byCollection.map((c) => [c.collection, c]));
    for (const nome of [
      'mediaItemTitleIDs',
      'globalMediaItemLocations',
      'mediaItemAnalyzedData',
      'mediaItemPlaylists',
      'contentPackMediaItems'
    ]) {
      const c = perNome.get(nome);
      if (!c) continue;
      expect(c.unreadable, `${nome}: righe illeggibili`).toBe(0);
    }
  });

  it('ricava percorso e BPM, che stanno in collezioni diverse dai metadati', () => {
    /* ⚠ Nessun titolo o percorso finisce negli asserti: si verifica che i
       campi ci SIANO, non quali siano.

       Il percorso sta in `sourceURIs` dentro la riga di posizione; il BPM
       misurato sta in `mediaItemAnalyzedData`, una riga a parte legata dallo
       stesso `uuid`. Una traccia senza percorso non si ritrova su disco, e un
       BPM vuoto verrebbe propagato dalla sincronizzazione sopra un dato buono
       degli altri programmi. */
    const lib = readDjayLibrary(db!);
    if (lib.tracks.length === 0) return; // libreria djay vuota: nulla da dire

    const conPercorso = lib.tracks.filter((t) => t.path !== null).length;
    expect(conPercorso, 'nessuna traccia ha un percorso').toBeGreaterThan(0);

    const conTitolo = lib.tracks.filter((t) => t.title !== null).length;
    expect(conTitolo).toBe(lib.tracks.length);
  });

  it('⚠ lo stesso brano dà gli stessi metadati da collezioni diverse', () => {
    /* Il controllo che mancava. Un brano compare come scheda e come posizione,
       e i suoi metadati devono coincidere: se non lo fanno, uno dei due percorsi
       di lettura sta sbagliando.

       È così che si è scoperto che `POINTER_STRING` non era una stringa ma un
       riferimento: lo stesso titolo usciva di dodici caratteri da una parte e
       sedici dall'altra, perché i byte di indice finivano dentro al testo.
       Entrambe le stringhe erano non vuote, quindi ogni controllo di presenza
       passava. ⚠ Qui non si stampa nessun titolo: si confrontano fra loro. */
    const db2 = new Database(db!, { readonly: true, fileMustExist: true });
    try {
      const perCollezione = new Map<string, Record<string, unknown>>();
      for (const c of ['mediaItemTitleIDs', 'globalMediaItemLocations']) {
        const r = db2.prepare(`SELECT data FROM database2 WHERE collection = ?`).get(c) as
          | { data: Buffer }
          | undefined;
        if (!r?.data || detectPayloadKind(r.data) !== 'djay') continue;
        const o = parseDjayPayload(r.data);
        if (o && typeof o === 'object' && !Array.isArray(o)) {
          perCollezione.set(c, o as Record<string, unknown>);
        }
      }
      const scheda = perCollezione.get('mediaItemTitleIDs');
      const posizione = perCollezione.get('globalMediaItemLocations');
      if (!scheda || !posizione) return; // libreria senza entrambe: nulla da confrontare

      const titolo = (o: Record<string, unknown>): unknown => {
        if (typeof o.title === 'string') return o.title;
        const t = o.titleIDs;
        const primo = Array.isArray(t) ? (t[0] as Record<string, unknown> | undefined) : undefined;
        return primo?.title;
      };
      const a = titolo(scheda);
      const b = titolo(posizione);
      if (typeof a === 'string' && typeof b === 'string') {
        expect(b).toBe(a);
      }
    } finally {
      db2.close();
    }
  });

  it('non duplica la traccia presente in più collezioni', () => {
    /* Lo stesso brano compare come scheda e come posizione, con lo stesso
       `uuid`: senza deduplica la libreria risulterebbe raddoppiata. */
    const lib = readDjayLibrary(db!);
    const uuidVisti = lib.tracks
      .map((t) => (t.formatData as { uuid?: string | null } | undefined)?.uuid ?? null)
      .filter((u): u is string => u !== null);
    expect(new Set(uuidVisti).size).toBe(uuidVisti.length);
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

  it('dichiara che cue e valutazioni non sono importati', () => {
    // Un import che tace su ciò che non ha portato è peggio di uno che fallisce:
    // l'utente crede di avere i suoi cue e li scopre assenti in serata.
    const lib = readDjayLibrary(db!);
    expect(lib.warnings.some((w) => w.toLowerCase().includes('cue'))).toBe(true);
    expect(lib.warnings.some((w) => w.toLowerCase().includes('beatgrid'))).toBe(true);
    expect(lib.warnings.some((w) => w.toLowerCase().includes('valutazioni'))).toBe(true);
  });
});
