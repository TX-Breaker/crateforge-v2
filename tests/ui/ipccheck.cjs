/**
 * Confronto dei canali IPC: ogni `ipcRenderer.invoke('X')` del preload deve avere
 * un `ipcMain.handle('X')` nel main, e viceversa ogni handler dovrebbe essere
 * raggiungibile. Un disallineamento qui non lo prende TypeScript: esploderebbe
 * solo a runtime, al primo clic.
 */
const fs = require('fs');

const { join } = require('path');
const APP = join(__dirname, '..', '..');
const preload = fs.readFileSync(`${APP}/src/preload/index.ts`, 'utf8');
const main = fs.readFileSync(`${APP}/src/main/ipc.ts`, 'utf8');

const invoked = new Set();
for (const m of preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)) invoked.add(m[1]);
const onEvents = new Set();
for (const m of preload.matchAll(/ipcRenderer\.on\(\s*'([^']+)'/g)) onEvents.add(m[1]);

const handled = new Set();
for (const m of main.matchAll(/ipcMain\.handle\(\s*\n?\s*'([^']+)'/g)) handled.add(m[1]);

const sent = new Set();
for (const file of ['src/main/ipc.ts', 'src/main/index.ts', 'src/main/progress.ts', 'src/main/preflight.ts']) {
  const src = fs.readFileSync(`${APP}/${file}`, 'utf8');
  for (const m of src.matchAll(/send\(\s*'([^']+)'/g)) sent.add(m[1]);
  // Non tutti i canali compaiono come literal nella send: ThrottledProgress usa
  // `this.channel`. Valgono quindi anche le costanti di canale del main.
  for (const m of src.matchAll(/channel\s*=\s*'([^']+)'/g)) sent.add(m[1]);
}

let bad = 0;
for (const ch of [...invoked].sort()) {
  if (!handled.has(ch)) {
    console.log(`MANCA handler nel main: ${ch}`);
    bad++;
  }
}
for (const ch of [...handled].sort()) {
  if (!invoked.has(ch)) console.log(`(info) handler non chiamato dal preload: ${ch}`);
}
for (const ch of [...onEvents].sort()) {
  if (!sent.has(ch)) {
    console.log(`MANCA send nel main per l'evento: ${ch}`);
    bad++;
  }
}

console.log(`\ninvoke: ${invoked.size} · handle: ${handled.size} · eventi: ${onEvents.size} · disallineamenti: ${bad}`);
process.exit(bad ? 1 : 0);
