/**
 * Pilota l'app REALE (main process vero, IPC veri, database vero) via CDP.
 *
 * Serve a verificare quello che il bridge finto non può dire: che i canali IPC
 * rispondano davvero, che il preflight giri, e soprattutto cosa rileva
 * `detect:djSoftware` sui percorsi effettivi di QUESTA macchina.
 *
 * L'app va avviata a parte con --remote-debugging-port=9222.
 */
const PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
}

const problems = [];
const ok = (label, detail) => console.log(`OK  ${label.padEnd(18)} ${detail}`);

const list = await targets();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.log('nessuna pagina trovata: l\'app è avviata con --remote-debugging-port?');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const cdp = new Cdp(ws);
await cdp.send('Runtime.enable');
await sleep(1500);

/* --- il bridge esiste e i canali rispondono davvero --- */
const bridge = await cdp.eval(`Object.keys(window.crateforge).sort().join(',')`);
ok('bridge', bridge.split(',').length + ' namespace esposti');

const stats = await cdp.eval(
  `(async () => JSON.stringify(await window.crateforge.library.stats()))()`
);
ok('library.stats', stats);

const health = await cdp.eval(
  `(async () => { const h = await window.crateforge.health.get(); return h.total + ' brani · score ' + h.score; })()`
);
ok('health.get', health);

const dist = await cdp.eval(
  `(async () => { const d = await window.crateforge.library.distribution(); return 'bpm ' + d.bpm.length + ' bucket · camelot ' + d.camelot.length + ' · noKey ' + d.noKey; })()`
);
ok('distribution', dist);

const pre = await cdp.eval(
  `(async () => { const p = await window.crateforge.preflight.get(); return p ? ('sidecar=' + p.sidecar.available + '/' + p.sidecar.runs + ' key=' + p.key.ready + ' ok=' + p.ok) : 'null'; })()`
);
ok('preflight', pre);

const sidecar = await cdp.eval(
  `(async () => JSON.stringify(await window.crateforge.sidecar.check()))()`
);
ok('sidecar.check', sidecar.slice(0, 110));

const rb = await cdp.eval(
  `(async () => { const r = await window.crateforge.rekordbox.defaultPaths(); return 'masterDb=' + r.masterDbExists + ' options=' + r.optionsJsonExists + ' · ' + r.dir; })()`
);
ok('rekordbox paths', rb);

/* --- il pezzo interessante: rilevamento reale su questa macchina --- */
const detect = await cdp.eval(
  `(async () => {
     const d = await window.crateforge.detect.djSoftware();
     return d.map(x => x.id + '=' + (x.found ? 'TROVATO' : 'no') + (x.limit ? '(' + x.limit + ')' : '') + (x.path ? ' → ' + x.path : '')).join('\\n');
   })()`
);
console.log('\n--- rilevamento reale su questa macchina ---');
console.log(detect);
console.log('-------------------------------------------\n');

/* --- il rilevamento non deve MAI dichiarare trovato un percorso inesistente --- */
const honest = await cdp.eval(
  `(async () => {
     const d = await window.crateforge.detect.djSoftware();
     return d.filter(x => x.found && !x.path).length;
   })()`
);
if (honest !== 0) problems.push(`rilevamento: ${honest} card dicono "trovato" senza percorso`);
else ok('onestà', 'nessun "trovato" senza percorso verificato');

/* --- oplog e quarantena reali --- */
const oplog = await cdp.eval(
  `(async () => { const r = await window.crateforge.oplog.list(5); return Array.isArray(r) ? r.length + ' voci' : 'non un array'; })()`
);
ok('oplog.list', oplog);

const q = await cdp.eval(
  `(async () => { const r = await window.crateforge.quarantine.list('C:/percorso/che/non/esiste'); return Array.isArray(r) ? 'array vuoto ok' : 'inatteso'; })()`
);
if (q !== 'array vuoto ok') problems.push('quarantine.list su percorso inesistente non restituisce un array vuoto');
else ok('quarantine.list', 'percorso inesistente → array vuoto, nessun crash');

/* --- il gate di sicurezza NON deve passare dal canale settings generico --- */
const gate = await cdp.eval(
  `(async () => {
     try {
       await window.crateforge.settings.set('directWrites', '1');
       return 'PASSATO (male)';
     } catch (e) { return 'RIFIUTATO: ' + String(e).slice(0, 80); }
   })()`
);
if (!/RIFIUTATO/.test(gate)) problems.push(`sicurezza: settings.set ha scritto un gate! (${gate})`);
else ok('gate via settings', gate.slice(0, 70));

/* --- errori raccolti nel renderer reale --- */
const rendererErrors = await cdp.eval(`(window.__cfErrors || []).length`);
if (rendererErrors) problems.push(`${rendererErrors} errori nel renderer reale`);

console.log('=========================================');
if (problems.length === 0) console.log('APP REALE: nessun problema trovato.');
else {
  console.log(`APP REALE: ${problems.length} problemi`);
  for (const p of problems) console.log(' - ' + p);
}
console.log('=========================================');
ws.close();
process.exit(problems.length ? 1 : 0);
