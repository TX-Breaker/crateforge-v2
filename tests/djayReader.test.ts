import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFrom } from '../src/adapters/djay/reader';
import {
  DJAY_HEADER_MAGIC,
  DJAY_HEADER_SIZE,
  DJAY_TYPE,
  encodeDjayString
} from '../src/adapters/djay/payload';
import { DJAY_ROOT_PLAYLIST_UUID } from '../src/adapters/djay';

/**
 * ⚠ djay non è installato sulla macchina di sviluppo: questa è una libreria
 * SINTETICA costruita con l'encoder documentato. Verifica che il lettore
 * attraversi l'archivio chiave-valore e ricostruisca l'albero, non che regga
 * su un `MediaLibrary.db` vero.
 */

const t = (n: number) => Buffer.from([n]);

function payload(nome: string, coppie: [Buffer, string][]): Buffer {
  const head = Buffer.alloc(DJAY_HEADER_SIZE);
  head.writeUInt32BE(DJAY_HEADER_MAGIC, 0);
  const parti: Buffer[] = [head, t(DJAY_TYPE.CLASS), encodeDjayString(nome)];
  for (const [v, k] of coppie) parti.push(v, encodeDjayString(k));
  parti.push(t(DJAY_TYPE.NULL));
  return Buffer.concat(parti);
}

function libreriaFinta() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE database2 (
    rowid INTEGER PRIMARY KEY, collection TEXT, key TEXT, data BLOB, metadata BLOB)`);
  const ins = db.prepare(`INSERT INTO database2 (collection, key, data) VALUES (?, ?, ?)`);

  /* ⚠ I nomi delle collezioni sono quelli OSSERVATI in un `MediaLibrary.db`
     reale, non nomi verosimili. La versione precedente di questa fixture usava
     'mediaItem' e 'Playlist', che in una libreria vera non esistono: il test
     passava perché il lettore accettava qualunque collezione con un titolo, ed
     è esattamente il difetto che la fixture avrebbe dovuto scoprire. Una
     fixture inventata conferma il codice invece di metterlo alla prova. */
  ins.run(
    'mediaItemTitleIDs',
    'uuid-brano-1',
    payload('ADCMediaItem', [
      [encodeDjayString('Primo Brano'), 'title'],
      [encodeDjayString('Artista Uno'), 'artist'],
      [encodeDjayString('C:/Musica/uno.mp3'), 'location']
    ])
  );
  ins.run(
    'globalMediaItemLocations',
    'uuid-brano-2',
    payload('ADCMediaItem', [
      [encodeDjayString('Secondo Brano'), 'title'],
      [encodeDjayString('C:/Musica/due.mp3'), 'location']
    ])
  );
  // Riga illeggibile: il lettore la deve contare, non morire.
  ins.run('mediaItemTitleIDs', 'uuid-rotto', Buffer.from('non sono un payload valido'));

  /* Un pacchetto di contenuti di djay. Ha un nome come un brano, e su una
     libreria reale ce ne sono un centinaio: se il lettore lo scambia per
     musica, l'utente si ritrova la libreria piena di roba che non ha mai
     comprato. */
  ins.run(
    'contentPacks',
    'uuid-pacchetto',
    payload('ADCContentPack', [
      [encodeDjayString('Pacchetto Contenuti'), 'name'],
      [encodeDjayString('Electronic'), 'category']
    ])
  );

  ins.run(
    'mediaItemPlaylists',
    DJAY_ROOT_PLAYLIST_UUID,
    payload('ADCPlaylist', [
      [encodeDjayString(DJAY_ROOT_PLAYLIST_UUID), 'uuid'],
      [encodeDjayString('Playlists'), 'name']
    ])
  );
  return db;
}

describe('djay Pro — lettore (libreria sintetica)', () => {
  it('attraversa l’archivio chiave-valore invece di cercare una tabella di tracce', () => {
    const db = libreriaFinta();
    try {
      const lib = readFrom(db);
      expect(lib.source).toBe('djay');
      expect(lib.tracks.length).toBe(2);
      expect(lib.tracks.map((x) => x.title).sort()).toEqual(['Primo Brano', 'Secondo Brano']);
    } finally {
      db.close();
    }
  });

  it('rifiuta un database che non ha database2, con un messaggio che lo dice', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE Track (id INTEGER)`);
    try {
      expect(() => readFrom(db)).toThrow(/database2/);
    } finally {
      db.close();
    }
  });

  it('conta le righe illeggibili invece di arrendersi alla prima', () => {
    const db = libreriaFinta();
    try {
      const lib = readFrom(db);
      // Un formato non collaudato che si ferma al primo intoppo non dice mai
      // quanto ci andava vicino.
      expect(lib.unreadable).toBe(1);
      // 5 righe in tutto: 2 brani, 1 rotta, 1 pacchetto di contenuti, 1 playlist.
      expect(lib.scanned).toBe(5);
      expect(lib.warnings.some((w) => w.includes('1 righe'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('⚠ non importa i pacchetti di contenuti di djay come musica', () => {
    /* Su una libreria reale i `contentPacks` sono un centinaio e hanno tutti un
       nome. La regola «ha un titolo, quindi è una traccia» li importava tutti.
       Il pacchetto deve comparire nella ripartizione — la riga esiste, non si
       finge il contrario — ma non fra le tracce. */
    const db = libreriaFinta();
    try {
      const lib = readFrom(db);
      expect(lib.tracks.some((t) => (t.title ?? '').includes('Pacchetto'))).toBe(false);
      const pacchetti = lib.byCollection.find((c) => c.collection === 'contentPacks');
      expect(pacchetti?.rows).toBe(1);
      // Ignorata per scelta, quindi non è un errore da riportare all'utente.
      expect(pacchetti?.unreadable).toBe(0);
    } finally {
      db.close();
    }
  });

  it('⚠ la radice delle playlist è una cartella anche se non ha figli', () => {
    // Caso di una libreria appena creata: se non gestito, si perde la radice e
    // con essa tutto l'albero.
    const db = libreriaFinta();
    try {
      const lib = readFrom(db);
      const radice = lib.playlists.find((p) => p.sourceId === DJAY_ROOT_PLAYLIST_UUID);
      expect(radice).toBeDefined();
      expect(radice!.isFolder).toBe(true);
      expect(radice!.parentSourceId).toBeNull();
    } finally {
      db.close();
    }
  });

  it('conserva chiave e collezione native per poter riscrivere invece di reinserire', () => {
    const db = libreriaFinta();
    try {
      const lib = readFrom(db);
      for (const tr of lib.tracks) {
        const fd = tr.formatData as Record<string, unknown>;
        expect(fd.key).toBe(tr.sourceId);
        expect(typeof fd.collection).toBe('string');
      }
    } finally {
      db.close();
    }
  });

  it('dichiara che i cue non sono stati importati', () => {
    const db = libreriaFinta();
    try {
      const lib = readFrom(db);
      expect(lib.tracks.every((x) => x.cues.length === 0)).toBe(true);
      expect(lib.warnings.some((w) => w.toLowerCase().includes('cue'))).toBe(true);
    } finally {
      db.close();
    }
  });
});
