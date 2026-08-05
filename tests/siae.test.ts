import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import {
  filterSessionRows,
  inWindow,
  minutesOfDay,
  minutesOfTimestamp
} from '@services/siae/siaeWindow';
import { exportSiaeReport, listHistorySessions } from '@services/siae/siaeReport';
import ExcelJS from 'exceljs';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Programma musicale SIAE.
 *
 * Qui si sbaglia in due modi, e sono opposti: includere un jingle di due
 * secondi come se fosse un'opera, oppure perdere per strada un brano davvero
 * suonato. Il secondo è il più grave — è un documento che l'utente firma.
 */

describe('lettura degli orari', () => {
  it('legge un orario scritto a mano', () => {
    expect(minutesOfDay('21:00')).toBe(1260);
    expect(minutesOfDay('06:00')).toBe(360);
    expect(minutesOfDay('00:00')).toBe(0);
  });

  it('rifiuta ciò che non è un orario invece di inventare un numero', () => {
    expect(minutesOfDay('')).toBeNull();
    expect(minutesOfDay('sera')).toBeNull();
    expect(minutesOfDay('25:00')).toBeNull();
    expect(minutesOfDay('21:70')).toBeNull();
    expect(minutesOfDay(null)).toBeNull();
  });

  /* Rekordbox scrive l'ora LOCALE della macchina che ha suonato, senza fuso.
     Passare da `Date` applicherebbe il fuso di chi apre il file: un set delle
     23:40 diventerebbe delle 21:40 su un altro computer. */
  it('prende l’ora dalla stringa, non dal fuso di chi legge', () => {
    expect(minutesOfTimestamp('2026-08-05 23:40:12')).toBe(23 * 60 + 40);
    expect(minutesOfTimestamp('2026-08-05T00:15:00')).toBe(15);
    expect(minutesOfTimestamp('2026-08-05T02:30:00+09:00')).toBe(150);
    expect(minutesOfTimestamp(null)).toBeNull();
    expect(minutesOfTimestamp('2026-08-05')).toBeNull();
  });
});

describe('la fascia che passa la mezzanotte', () => {
  const from = minutesOfDay('21:00')!;
  const to = minutesOfDay('06:00')!;

  it('tiene la sera e la notte, che è tutto il punto', () => {
    expect(inWindow(minutesOfDay('21:00')!, from, to)).toBe(true);
    expect(inWindow(minutesOfDay('23:59')!, from, to)).toBe(true);
    expect(inWindow(minutesOfDay('00:01')!, from, to)).toBe(true);
    expect(inWindow(minutesOfDay('05:59')!, from, to)).toBe(true);
  });

  it('lascia fuori il pomeriggio', () => {
    expect(inWindow(minutesOfDay('15:00')!, from, to)).toBe(false);
    expect(inWindow(minutesOfDay('20:59')!, from, to)).toBe(false);
  });

  /* Inizio incluso, fine esclusa: un brano partito alle 06:00 in punto è della
     mattina dopo. Con entrambi inclusi due serate consecutive se lo
     contenderebbero, e comparirebbe in due programmi musicali. */
  it('l’estremo alto è escluso: nessun brano in due serate', () => {
    expect(inWindow(minutesOfDay('06:00')!, from, to)).toBe(false);
  });

  it('una fascia normale resta normale', () => {
    const a = minutesOfDay('09:00')!;
    const b = minutesOfDay('18:00')!;
    expect(inWindow(minutesOfDay('12:00')!, a, b)).toBe(true);
    expect(inWindow(minutesOfDay('08:59')!, a, b)).toBe(false);
    expect(inWindow(minutesOfDay('18:00')!, a, b)).toBe(false);
  });

  it('estremi uguali = ventiquattr’ore, non zero minuti', () => {
    expect(inWindow(0, 600, 600)).toBe(true);
    expect(inWindow(1439, 600, 600)).toBe(true);
  });
});

describe('chi entra nel programma musicale', () => {
  const night = [
    { played_at: '2026-08-05 22:10:00', duration_s: 320, title: 'Apertura' },
    { played_at: '2026-08-06 01:30:00', duration_s: 400, title: 'Centro serata' },
    { played_at: '2026-08-06 05:50:00', duration_s: 380, title: 'Ultimo' },
    { played_at: '2026-08-05 18:00:00', duration_s: 300, title: 'Prova audio' },
    { played_at: '2026-08-06 00:45:00', duration_s: 4, title: 'Jingle' }
  ];

  it('la fascia toglie la prova audio, la soglia toglie il jingle', () => {
    const r = filterSessionRows(night, {
      fromTime: '21:00',
      toTime: '06:00',
      sampleUnderS: 30
    });
    expect(r.rows.map((x) => x.title)).toEqual(['Apertura', 'Centro serata', 'Ultimo']);
    expect(r.counts.outOfWindow).toBe(1);
    expect(r.counts.samples).toBe(1);
    expect(r.counts.unknownTime).toBe(0);
  });

  it('senza fascia entra tutta la sessione', () => {
    const r = filterSessionRows(night, { sampleUnderS: 30 });
    expect(r.rows).toHaveLength(4);
    expect(r.counts.outOfWindow).toBe(0);
  });

  it('soglia a zero: anche il jingle è un brano, se l’utente lo vuole', () => {
    const r = filterSessionRows(night, { sampleUnderS: 0 });
    expect(r.rows).toHaveLength(5);
    expect(r.counts.samples).toBe(0);
  });

  /* Il caso che conta: una cronologia senza orari. Escluderle avrebbe
     consegnato alla SIAE un elenco vuoto per una serata davvero suonata. */
  it('le righe senza orario restano dentro, e vengono dichiarate', () => {
    const r = filterSessionRows(
      [
        { played_at: null, duration_s: 300, title: 'Non so quando' },
        { played_at: '2026-08-05 22:00:00', duration_s: 300, title: 'So quando' }
      ],
      { fromTime: '21:00', toTime: '06:00', sampleUnderS: 30 }
    );
    expect(r.rows).toHaveLength(2);
    expect(r.counts.unknownTime).toBe(1);
    expect(r.counts.outOfWindow).toBe(0);
  });

  it('un brano senza durata non viene scambiato per un sample', () => {
    const r = filterSessionRows([{ played_at: null, duration_s: null, title: 'Boh' }], {
      sampleUnderS: 30
    });
    expect(r.rows).toHaveLength(1);
    expect(r.counts.samples).toBe(0);
  });

  it('la soglia è sulla durata del brano, non su quanto è stato suonato', () => {
    // 29 secondi esclusi, 30 tenuti: la soglia è "sotto", non "fino a".
    const r = filterSessionRows(
      [
        { played_at: null, duration_s: 29, title: 'Stacco' },
        { played_at: null, duration_s: 30, title: 'Intro corta' }
      ],
      { sampleUnderS: 30 }
    );
    expect(r.rows.map((x) => x.title)).toEqual(['Intro corta']);
  });
});

describe('il foglio che l’utente consegna', () => {
  /* Il criterio è testato sopra come funzione pura. Qui si controlla che finisca
     DAVVERO dentro il file: le esclusioni scritte in testa e l'ora di ogni
     brano. Un conteggio giusto che non arriva nel foglio non serve a nessuno. */
  it('scrive in testa la fascia usata e quello che ha tolto', async () => {
    const db = new Database(':memory:');
    migrate(db);
    const ins = db.prepare(
      `INSERT INTO play_history
         (session_id, session_name, position, title, artist, duration_s, played_at)
       VALUES ('s1', 'Sabato', ?, ?, ?, ?, ?)`
    );
    ins.run(0, 'Apertura', 'Tizio', 320, '2026-08-05 22:10:00');
    ins.run(1, 'Notte', 'Caio', 400, '2026-08-06 01:30:00');
    ins.run(2, 'Prova audio', 'Sempronio', 300, '2026-08-05 18:00:00');
    ins.run(3, 'Jingle', 'Radio', 4, '2026-08-06 00:45:00');

    const out = join(tmpdir(), `crateforge-siae-${process.pid}.xlsx`);
    const r = await exportSiaeReport(db, {
      sessionId: 's1',
      outPath: out,
      venue: 'Locale X',
      fromTime: '21:00',
      toTime: '06:00',
      sampleUnderS: 30
    });
    expect(r.rows).toBe(2);
    expect(r.samples).toBe(1);
    expect(r.outOfWindow).toBe(1);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const ws = wb.getWorksheet('SIAE')!;
    const cell = (row: number, col: number) => String(ws.getRow(row).getCell(col).value ?? '');
    // Le esclusioni sono in testa, non in fondo: si vedono aprendo il file.
    const head = Array.from({ length: 8 }, (_, i) => `${cell(i + 1, 1)}|${cell(i + 1, 2)}`).join('\n');
    expect(head).toContain('Fascia oraria|21:00 → 06:00');
    expect(head).toContain('Esclusi come sample|1 (durata sotto 30s)');
    expect(head).toContain('Esclusi fuori fascia|1');
    // E ogni riga porta la sua ora, che prima non esisteva.
    const body = ws.getSheetValues().map((row) => (row as unknown[])?.join('|') ?? '');
    expect(body.some((l) => l.includes('22:10') && l.includes('Apertura'))).toBe(true);
    expect(body.some((l) => l.includes('Prova audio'))).toBe(false);
    rmSync(out, { force: true });
  });
});

describe('elenco delle serate', () => {
  it('porta anche il primo e l’ultimo orario, per proporre la fascia', () => {
    const db = new Database(':memory:');
    migrate(db);
    const ins = db.prepare(
      `INSERT INTO play_history (session_id, session_name, session_date, position, title, played_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    ins.run('s1', 'Sabato', '2026-08-05', 0, 'A', '2026-08-05 22:10:00');
    ins.run('s1', 'Sabato', '2026-08-05', 1, 'B', '2026-08-06 03:00:00');
    const sessions = listHistorySessions(db);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tracks).toBe(2);
    expect(sessions[0].first_played_at).toBe('2026-08-05 22:10:00');
    expect(sessions[0].last_played_at).toBe('2026-08-06 03:00:00');
  });

  it('una cronologia vecchia, senza orari, non fa saltare l’elenco', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.prepare(
      `INSERT INTO play_history (session_id, session_name, position, title) VALUES ('s1', 'Vecchia', 0, 'A')`
    ).run();
    const sessions = listHistorySessions(db);
    expect(sessions[0].first_played_at).toBeNull();
  });
});
