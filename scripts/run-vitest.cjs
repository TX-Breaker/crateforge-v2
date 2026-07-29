/**
 * Esegue Vitest dentro il runtime Node di Electron (ELECTRON_RUN_AS_NODE).
 *
 * Perché: postinstall (`electron-builder install-app-deps`) compila
 * better-sqlite3 per l'ABI di Electron; il Node di sistema ha un ABI diverso e
 * non può caricare il .node. Usando il binario di Electron come Node l'ABI
 * coincide e i test dell'UDM girano senza ricompilare nulla.
 */
const { spawnSync } = require('child_process');

// require('electron') da Node "normale" ritorna il percorso del binario.
const electron = require('electron');

const args = ['node_modules/vitest/vitest.mjs', ...process.argv.slice(2)];
const r = spawnSync(electron, args, {
  stdio: 'inherit',
  cwd: __dirname + '/..',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});
process.exit(r.status ?? 1);
