import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Codec TLV di Serato ≤3 verificato contro il `database V2` REALE, in sola
 * lettura.
 *
 * ⚠ Nessun titolo, artista o percorso della libreria personale finisce negli
 * asserti o nell'output: si verificano la struttura del formato e le invarianti
 * del codec. Contare i record è lecito, stamparli no.
 *
 * Si auto-salta se Serato ≤3 non è installato.
 */

const seratoDir = join(homedir(), 'Music', '_Serato_');
const dbV2 = join(seratoDir, 'database V2');
const sidecar = join(process.cwd(), 'python-sidecar', 'sidecar.py');
const disponibile = existsSync(dbV2) && existsSync(sidecar);
const d = disponibile ? describe : describe.skip;

/** Esegue una sonda Python sul modulo del sidecar e restituisce il JSON. */
function probe(script: string): Record<string, unknown> {
  const out = execFileSync(
    'python',
    [
      '-c',
      `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('sc', r'${sidecar}')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
${script}`
    ],
    { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }
  );
  return JSON.parse(out.trim().split(/\r?\n/).pop() as string) as Record<string, unknown>;
}

d('Serato ≤3 — database V2 reale (sola lettura)', () => {
  it('il file si analizza per intero come catena di frame TLV', () => {
    // Invariante del formato: frame = [codice 4][lunghezza uint32 BE][payload],
    // senza padding. Se il parser consuma esattamente tutti i byte, le
    // lunghezze tornano — ed è l'unico modo di dirlo senza leggere i contenuti.
    const r = probe(`
raw = open(r'${dbV2}', 'rb').read()
consumati = 0
tipi = {}
for tag, payload in m._serato_fields(raw):
    consumati += 8 + len(payload)
    tipi[tag] = tipi.get(tag, 0) + 1
print(json.dumps({'totale': len(raw), 'consumati': consumati, 'tipi': tipi}))`);

    expect(r.consumati).toBe(r.totale);
    expect((r.tipi as Record<string, number>).vrsn).toBeGreaterThanOrEqual(1);
    expect((r.tipi as Record<string, number>).otrk).toBeGreaterThan(0);
  });

  it("l'intestazione è quella dichiarata dalla specifica", () => {
    const raw = readFileSync(dbV2);
    expect(raw.subarray(0, 4).toString('ascii')).toBe('vrsn');
    const len = raw.readUInt32BE(4);
    const versione = raw.subarray(8, 8 + len).toString('utf16le');
    // Il payload è UTF-16 BIG-endian: letto come LE i byte risultano scambiati.
    const swapped = Buffer.from(raw.subarray(8, 8 + len));
    swapped.swap16();
    expect(swapped.toString('utf16le')).toBe('2.0/Serato Scratch LIVE Database');
    expect(versione).not.toBe('2.0/Serato Scratch LIVE Database');
  });

  it('ogni record di traccia ha il campo di identità pfil', () => {
    const r = probe(`
raw = open(r'${dbV2}', 'rb').read()
otrk = [p for t, p in m._serato_fields(raw) if t == 'otrk']
con_pfil = 0
for p in otrk:
    if any(t == 'pfil' for t, _ in m._serato_fields(p)):
        con_pfil += 1
print(json.dumps({'record': len(otrk), 'conPfil': con_pfil}))`);

    expect(r.record).toBeGreaterThan(0);
    // pfil è la chiave con cui il merge riconosce i record: se manca su
    // qualcuno, quel record verrebbe preservato ma mai aggiornato.
    expect(r.conPfil).toBe(r.record);
  });

  it('la tipizzazione per prima lettera regge su tutti i campi reali', () => {
    // ⚠ È il punto della specifica: non esiste una tabella tag → tipo. Ogni
    // campo del file reale deve essere decodificabile dalla sola prima lettera
    // del suo codice, senza eccezioni e senza sollevare.
    const r = probe(`
raw = open(r'${dbV2}', 'rb').read()
lettere = {}
errori = 0
for tag, payload in m._serato_fields(raw):
    if tag != 'otrk':
        continue
    for st, sp in m._serato_fields(payload):
        lettere[st[:1]] = lettere.get(st[:1], 0) + 1
        try:
            m._serato_value(st, sp)
        except Exception:
            errori += 1
print(json.dumps({'lettere': lettere, 'errori': errori}))`);

    expect(r.errori).toBe(0);
    const lettere = Object.keys(r.lettere as Record<string, number>);
    expect(lettere.length).toBeGreaterThan(0);
    // Tutte le prime lettere osservate devono essere fra quelle che la regola
    // copre esplicitamente, oppure cadere nel ramo di default uint32.
    for (const l of lettere) expect(l.length).toBe(1);
  });

  it('il round-trip di un record non tocca un solo byte', () => {
    // Fondere zero aggiornamenti dentro un record deve restituire lo stesso
    // record: è la garanzia che il merge non danneggia ciò che non modifica.
    const r = probe(`
raw = open(r'${dbV2}', 'rb').read()
otrk = [p for t, p in m._serato_fields(raw) if t == 'otrk']
identici = sum(1 for p in otrk if m._serato_merge_otrk(p, {}) == p)
print(json.dumps({'record': len(otrk), 'identici': identici}))`);

    expect(r.identici).toBe(r.record);
  });

  it('i campi volatili sono esclusi dal confronto, così non si riscrive a vuoto', () => {
    const r = probe(`
raw = open(r'${dbV2}', 'rb').read()
otrk = [p for t, p in m._serato_fields(raw) if t == 'otrk']
p = otrk[0]
# Cambiare SOLO un campo volatile non deve contare come differenza.
mod = m._serato_merge_otrk(p, {'tlen': '9:99'})
print(json.dumps({
  'diversoNeiByte': mod != p,
  'consideratoUguale': m._serato_otrk_equivalent(p, mod),
  'volatili': list(m._DB_V2_VOLATILE),
}))`);

    expect(r.volatili).toEqual(['ufsb', 'tlen', 'tsiz']);
    expect(r.consideratoUguale).toBe(true);
  });
});
