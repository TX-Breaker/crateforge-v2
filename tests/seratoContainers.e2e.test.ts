import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Cue Serato fuori da ID3: FLAC, OGG e M4A.
 *
 * In ID3 i cue stanno in un frame GEOB "Serato Markers2". Negli altri
 * contenitori Serato usa un campo testuale (`serato_markers_v2` in FLAC,
 * `----:com.serato.dj:markersv2` in M4A) che porta lo STESSO contenuto avvolto
 * in un secondo strato base64, preceduto da `application/octet-stream`, due NUL
 * e il nome del frame. Prima di questa correzione quei cue venivano ignorati in
 * silenzio all'import.
 *
 * ⚠ La forma dello strato esterno viene dalla specifica, NON da file reali: la
 * macchina di collaudo non ha nessun FLAC o M4A taggato da Serato. Questi test
 * verificano che il codice rispetti la specifica e, soprattutto, che un
 * contenuto che non la rispetta non produca cue inventati.
 */

const SIDECAR_DIR = join(__dirname, '..', 'python-sidecar');
const VENV_PY =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');
const hasVenv = existsSync(VENV_PY);

function py(code: string): string {
  const r = spawnSync(VENV_PY, ['-c', code], { encoding: 'utf-8', timeout: 60_000, cwd: SIDECAR_DIR });
  if (r.status !== 0) throw new Error(`python fallito: ${r.stderr}`);
  return r.stdout.trim();
}

/** Contenuto GEOB con due cue, e i due involucri della specifica. */
const PREAMBOLO = `
import base64, json, sidecar as s
data = s._serato_build_markers2(b"\\x01\\x01", [
    ("CUE", s._serato_cue_entry(0, 1500, "#CC0000", "Intro")),
    ("CUE", s._serato_cue_entry(3, 45250, "#0000CC", "Drop")),
], None)
payload = b"application/octet-stream\\x00\\x00Serato Markers2\\x00" + data

def flac(p):
    return base64.b64encode(p)

def mp4(p):
    # Variante usata da Serato per MP4: '=' sostituito da 'A', riempimento a
    # 752 o 1444 caratteri con 'A', a capo ogni 72, multiplo di 4.
    enc = base64.b64encode(p).replace(b"=", b"A")
    pad = 1444 if len(p) > 752 else 752
    enc = enc.ljust(pad, b"A") if len(enc) < pad else enc + b"A"
    enc = b"\\n".join(enc[i:i+72] for i in range(0, len(enc), 72))
    return enc + b"A" * (-len(enc) % 4)

def cues(raw):
    inner = s._serato_unwrap_container(raw)
    if inner is None:
        return None
    return [[c[0], c[1], c[2], c[4], c[5]] for c in s.parse_serato_markers2(inner)]
`;

describe.skipIf(!hasVenv)('cue Serato fuori da ID3', () => {
  it('legge i cue dall involucro FLAC', () => {
    const out = JSON.parse(py(`${PREAMBOLO}\nprint(json.dumps(cues(flac(payload))))`));
    expect(out).toEqual([
      ['hot', 0, 1500, '#CC0000', 'Intro'],
      ['hot', 3, 45250, '#0000CC', 'Drop']
    ]);
  });

  it('legge i cue dall involucro M4A, con riempimento e a capo', () => {
    const out = JSON.parse(py(`${PREAMBOLO}\nprint(json.dumps(cues(mp4(payload))))`));
    expect(out).toEqual([
      ['hot', 0, 1500, '#CC0000', 'Intro'],
      ['hot', 3, 45250, '#0000CC', 'Drop']
    ]);
  });

  it('non inventa cue da un contenuto che non rispetta la forma', () => {
    // Base64 valido ma senza il nome del frame: nessun cue, non cue a caso.
    const out = py(`${PREAMBOLO}
print(json.dumps([
    cues(base64.b64encode(b"qualcos'altro del tutto")),
    cues(b"%%% non base64 %%%"),
    cues(flac(b"application/octet-stream\\x00\\x00Serato Markers2\\x00" + b"\\x01\\x01spazzatura")),
]))`);
    expect(JSON.parse(out)).toEqual([null, null, []]);
  });

  it('riconosce il contenitore dal tipo dei tag', () => {
    const out = py(`
import json, sidecar as s
def finto(nome, getall=False):
    T = type(nome, (), {})
    t = T()
    if getall:
        t.getall = lambda *_: []
    return type("Audio", (), {"tags": t})()
print(json.dumps([
    s._serato_container_kind(finto("ID3", True)),
    s._serato_container_kind(finto("VCFLACDict")),
    s._serato_container_kind(finto("MP4Tags")),
    s._serato_container_kind(finto("OggVCommentDict")),
]))`);
    expect(JSON.parse(out)).toEqual(['id3', 'flac', 'mp4', 'ogg']);
  });

  it('ricava la durata da tlen solo se ha una forma valida', () => {
    /* Ripiego per quando il file non è raggiungibile: la durata vera si legge
       dal file. `tlen` è testo arrotondato ("02:34.12") e un valore malformato
       deve dare nessuna durata, non una durata sbagliata. */
    const out = py(`
import json, sidecar as s
print(json.dumps([s._serato_tlen_seconds(x) for x in ["02:34.12", "10:05", "99:99.99", "", None, "abc"]]))`);
    expect(JSON.parse(out)).toEqual([154.12, 605, null, null, null, null]);
  });
});
