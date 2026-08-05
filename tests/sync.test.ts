import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import { linkCanonicalTracks } from '@core/identity';
import { DEST_CAPABILITY, planSync, resolveCues, type SyncMode } from '@core/sync';
import { getCuesForTrack, type CueRow } from '@adapters/common';

/**
 * Sincronizzazione dei punti fra software.
 *
 * Il rischio non è sbagliare la posizione di un cue: è far sparire in silenzio
 * lavoro fatto a mano. I test qui sotto guardano soprattutto CHI PERDE — dove
 * finisce, e se qualcuno lo conta.
 */

let nextId = 1;
function cue(p: Partial<CueRow> & { position_ms: number }): CueRow {
  return {
    id: nextId++,
    track_id: 1,
    cue_type: 'hot',
    cue_index: null,
    length_ms: null,
    color: null,
    label: null,
    ...p
  } as CueRow;
}

const hot = (idx: number, pos: number, label?: string) =>
  cue({ cue_type: 'hot', cue_index: idx, position_ms: pos, label: label ?? `H${idx}` });
const loop = (idx: number, pos: number, len = 4000) =>
  cue({ cue_type: 'loop', cue_index: idx, position_ms: pos, length_ms: len, label: `L${idx}` });
const memory = (pos: number) => cue({ cue_type: 'memory', cue_index: null, position_ms: pos });

const REKORDBOX = DEST_CAPABILITY.rekordbox; // 8 pad, sa retrocedere
const SERATO = DEST_CAPABILITY.serato; //       8+8 pad, NON sa retrocedere

describe('modo "riempi i vuoti" — il predefinito', () => {
  it('scrive solo dove il pad è libero', () => {
    const origin = [hot(0, 1000), hot(1, 2000), hot(2, 3000)];
    const dest = [hot(1, 9999, 'mio')];
    const r = resolveCues(origin, dest, 'fill', REKORDBOX);
    expect(r.filled).toBe(2);
    expect(r.replaced).toBe(0);
    // Il pad 1 resta quello della destinazione, intatto.
    const pad1 = r.cues.find((c) => c.cue_type === 'hot' && c.cue_index === 1);
    expect(pad1?.label).toBe('mio');
    expect(pad1?.position_ms).toBe(9999);
  });

  it('destinazione vuota: entra tutto, nessun conflitto', () => {
    const origin = [hot(0, 1000), hot(1, 2000)];
    const r = resolveCues(origin, [], 'fill', REKORDBOX);
    expect(r.filled).toBe(2);
    expect(r.replaced + r.lost).toBe(0);
    expect(r.cues.filter((c) => c.from === 'origin')).toHaveLength(2);
  });

  it('il punto dell’origine che non trova posto retrocede, non sparisce', () => {
    const origin = [hot(1, 1000, 'origine')];
    const dest = [hot(1, 2000, 'destinazione')];
    const r = resolveCues(origin, dest, 'fill', REKORDBOX);
    expect(r.demoted).toBe(1);
    expect(r.lost).toBe(0);
    const dem = r.cues.find((c) => c.from === 'origin');
    expect(dem?.cue_type).toBe('memory');
    expect(dem?.position_ms).toBe(1000);
  });
});

describe('modo "sovrascrivi" — vince l’origine', () => {
  it('l’origine prende il pad e la destinazione retrocede', () => {
    const origin = [hot(1, 1000, 'origine')];
    const dest = [hot(1, 2000, 'destinazione')];
    const r = resolveCues(origin, dest, 'overwrite', REKORDBOX);
    expect(r.replaced).toBe(1);
    expect(r.demoted).toBe(1);
    expect(r.lost).toBe(0);
    const pad = r.cues.find((c) => c.cue_type === 'hot' && c.cue_index === 1);
    expect(pad?.label).toBe('origine');
    const dem = r.cues.find((c) => c.cue_type === 'memory');
    expect(dem?.label).toBe('destinazione');
  });

  it('nessuna riga sparisce: quello che c’era si ritrova, spostato', () => {
    const origin = [hot(0, 100), hot(1, 200)];
    const dest = [hot(0, 900), hot(1, 800), hot(2, 700)];
    const r = resolveCues(origin, dest, 'overwrite', REKORDBOX);
    // 5 punti in ingresso, 5 in uscita: due retrocessi, nessuno perso.
    expect(r.cues).toHaveLength(5);
    expect(r.lost).toBe(0);
    expect(r.demoted).toBe(2);
  });
});

describe('dove la destinazione non sa retrocedere: si conta, non si tace', () => {
  it('Serato: il cue spodestato è perso davvero', () => {
    const origin = [hot(1, 1000, 'origine')];
    const dest = [hot(1, 2000, 'destinazione')];
    const r = resolveCues(origin, dest, 'overwrite', SERATO);
    expect(r.replaced).toBe(1);
    expect(r.demoted).toBe(0);
    expect(r.lost).toBe(1);
    // In uscita resta solo il punto dell'origine: la perdita è reale e contata.
    expect(r.cues).toHaveLength(1);
    expect(r.cues[0].label).toBe('origine');
  });

  it('Serato in "riempi i vuoti": si perde il punto dell’origine, non il tuo', () => {
    const origin = [hot(1, 1000, 'origine')];
    const dest = [hot(1, 2000, 'mio lavoro')];
    const r = resolveCues(origin, dest, 'fill', SERATO);
    expect(r.lost).toBe(1);
    expect(r.cues).toHaveLength(1);
    expect(r.cues[0].label).toBe('mio lavoro');
  });

  it('le memory dell’origine non arrivano su Serato, e il conto lo dice', () => {
    const r = resolveCues([memory(1000), memory(2000)], [], 'fill', SERATO);
    expect(r.lost).toBe(2);
    expect(r.cues).toHaveLength(0);
  });
});

describe('banchi separati: i loop non rubano i pad dei cue', () => {
  it('su Serato loop e hot cue hanno otto slot ciascuno', () => {
    const origin = [hot(0, 100), loop(0, 500)];
    const r = resolveCues(origin, [], 'fill', SERATO);
    expect(r.filled).toBe(2);
    expect(r.lost).toBe(0);
  });

  it('su Rekordbox condividono gli otto pad: il loop trova il pad occupato', () => {
    const origin = [loop(0, 500)];
    const dest = [hot(0, 100, 'gia qui')];
    const r = resolveCues(origin, dest, 'fill', REKORDBOX);
    expect(r.filled).toBe(0);
    expect(r.demoted).toBe(1);
  });

  it('Engine → Serato: otto cue e otto loop entrano tutti', () => {
    const origin = [
      ...Array.from({ length: 8 }, (_, i) => hot(i, i * 1000)),
      ...Array.from({ length: 8 }, (_, i) => loop(i, i * 2000))
    ];
    const r = resolveCues(origin, [], 'fill', SERATO);
    expect(r.filled).toBe(16);
    expect(r.lost).toBe(0);
  });

  it('Engine → Rekordbox: sedici punti per otto pad, otto retrocedono', () => {
    const origin = [
      ...Array.from({ length: 8 }, (_, i) => hot(i, i * 1000)),
      ...Array.from({ length: 8 }, (_, i) => loop(i, i * 2000))
    ];
    const r = resolveCues(origin, [], 'fill', REKORDBOX);
    expect(r.filled).toBe(8);
    expect(r.demoted).toBe(8);
    expect(r.lost).toBe(0);
    expect(r.cues).toHaveLength(16);
  });
});

describe('capacità dichiarate', () => {
  it('solo Rekordbox, Traktor e VirtualDJ sanno conservare fuori dai pad', () => {
    expect(DEST_CAPABILITY.rekordbox.canDemote).toBe(true);
    expect(DEST_CAPABILITY.traktor.canDemote).toBe(true);
    expect(DEST_CAPABILITY.virtualdj.canDemote).toBe(true);
    expect(DEST_CAPABILITY.serato.canDemote).toBe(false);
    expect(DEST_CAPABILITY.engine.canDemote).toBe(false);
  });

  it('nessuna destinazione promette più di otto pad per banco', () => {
    for (const [name, cap] of Object.entries(DEST_CAPABILITY)) {
      expect(cap.hotPads, name).toBeLessThanOrEqual(8);
      expect(cap.loopPads, name).toBeLessThanOrEqual(8);
    }
  });
});

describe('prova a vuoto sulla libreria', () => {
  function libraryWithBoth() {
    const db = new Database(':memory:');
    migrate(db);
    const t = db.prepare(
      `INSERT INTO tracks (source, source_id, title, path) VALUES (?, ?, ?, ?)`
    );
    const c = db.prepare(
      `INSERT INTO cues (track_id, cue_type, cue_index, position_ms, length_ms)
       VALUES (?, ?, ?, ?, NULL)`
    );
    const rb = Number(t.run('masterdb', 'r1', 'Condivisa', 'C:/M/a.mp3').lastInsertRowid);
    const tr = Number(t.run('traktor', 't1', 'Condivisa', 'C:/M/a.mp3').lastInsertRowid);
    const solo = Number(t.run('masterdb', 'r2', 'Solo Rekordbox', 'C:/M/b.mp3').lastInsertRowid);
    c.run(rb, 'hot', 0, 1000);
    c.run(rb, 'hot', 1, 2000);
    c.run(tr, 'hot', 1, 9999); // conflitto sul pad 1
    c.run(solo, 'hot', 0, 500);
    linkCanonicalTracks(db);
    return db;
  }

  it('conta i brani in comune, non tutta la libreria', () => {
    const db = libraryWithBoth();
    const plan = planSync(db, {
      originSources: ['masterdb', 'xml'],
      destinationSources: ['traktor'],
      destination: 'traktor',
      mode: 'fill'
    });
    // "Solo Rekordbox" non esiste in Traktor: non c'è niente da sincronizzare.
    expect(plan.tracks).toBe(1);
    expect(plan.filled).toBe(1); // il pad 0 era libero
    expect(plan.demoted).toBe(1); // il pad 1 era occupato: l'origine retrocede
    expect(plan.lost).toBe(0);
    expect(plan.destroys).toBe(false);
  });

  it('in sovrascrivi il conto cambia, e lo dice prima di scrivere', () => {
    const db = libraryWithBoth();
    const plan = planSync(db, {
      originSources: ['masterdb', 'xml'],
      destinationSources: ['traktor'],
      destination: 'traktor',
      mode: 'overwrite'
    });
    expect(plan.filled).toBe(1);
    expect(plan.replaced).toBe(1);
    expect(plan.demoted).toBe(1); // il cue di Traktor scende a memory
    expect(plan.lost).toBe(0);
  });

  it('senza identità collegata non c’è niente da sincronizzare', () => {
    const db = new Database(':memory:');
    migrate(db);
    const t = db.prepare(`INSERT INTO tracks (source, source_id, title, path) VALUES (?, ?, ?, ?)`);
    const c = db.prepare(
      `INSERT INTO cues (track_id, cue_type, cue_index, position_ms) VALUES (?, 'hot', 0, 100)`
    );
    // Stesso file, ma linkCanonicalTracks NON è stato eseguito.
    const rb = Number(t.run('masterdb', 'r1', 'X', 'C:/M/a.mp3').lastInsertRowid);
    t.run('traktor', 't1', 'X', 'C:/M/a.mp3');
    c.run(rb);
    const plan = planSync(db, {
      originSources: ['masterdb'],
      destinationSources: ['traktor'],
      destination: 'traktor',
      mode: 'fill'
    });
    expect(plan.tracks).toBe(0);
  });

  it('quello che conta il piano è quello che scriveranno i writer', () => {
    const db = libraryWithBoth();
    const sync = {
      originSources: ['masterdb', 'xml'],
      destination: 'traktor',
      mode: 'fill' as SyncMode
    };
    const plan = planSync(db, { ...sync, destinationSources: ['traktor'] });
    const destId = (
      db.prepare(`SELECT id FROM tracks WHERE source = 'traktor'`).get() as { id: number }
    ).id;
    const cues = getCuesForTrack(db, destId, sync);
    // Il piano dice 1 riempito + 1 retrocesso: nei punti scritti si ritrovano
    // esattamente quelli, più il cue che la destinazione aveva già.
    expect(plan.filled + plan.demoted).toBe(2);
    expect(cues).toHaveLength(3);
    expect(cues.filter((c) => c.cue_type === 'memory')).toHaveLength(1);
    // Il pad conteso è rimasto della destinazione: "riempi i vuoti" non tocca.
    expect(cues.find((c) => c.cue_type === 'hot' && c.cue_index === 1)?.position_ms).toBe(9999);
  });

  it('un brano che nell’origine non esiste non viene svuotato', () => {
    const db = libraryWithBoth();
    const solo = (
      db.prepare(`SELECT id FROM tracks WHERE source_id = 'r2'`).get() as { id: number }
    ).id;
    const cues = getCuesForTrack(db, solo, {
      originSources: ['traktor'],
      destination: 'rekordbox',
      mode: 'overwrite'
    });
    expect(cues).toHaveLength(1);
    expect(cues[0].position_ms).toBe(500);
  });

  it('destinazione sconosciuta: si torna al comportamento normale, non si indovina', () => {
    const db = libraryWithBoth();
    const destId = (
      db.prepare(`SELECT id FROM tracks WHERE source = 'traktor'`).get() as { id: number }
    ).id;
    const cues = getCuesForTrack(db, destId, {
      originSources: ['masterdb'],
      destination: 'ableton',
      mode: 'overwrite'
    });
    expect(cues).toHaveLength(1); // solo i suoi
    expect(cues[0].position_ms).toBe(9999);
  });

  it('verso Serato dichiara che le perdite non sono recuperabili', () => {
    const db = libraryWithBoth();
    const plan = planSync(db, {
      originSources: ['masterdb', 'xml'],
      destinationSources: ['traktor'],
      destination: 'serato',
      mode: 'overwrite'
    });
    expect(plan.destroys).toBe(true);
  });
});
