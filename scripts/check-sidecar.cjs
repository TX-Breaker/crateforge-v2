/**
 * Prima di impacchettare: il sidecar compilato è aggiornato rispetto al suo sorgente?
 *
 * ⚠ È successo: gli installer hanno spedito per mesi un sidecar compilato ad
 * agosto, mentre `sidecar.py` cambiava. Correzioni già fatte e provate (cue
 * Serato, Auto-Cue sul battito, scrittura del database di Serato) non
 * arrivavano a chi installava, e l'errore compariva solo usandole —
 * «invalid choice: 'write-serato-database'». Un pacchetto non deve partire se
 * il binario è più vecchio del sorgente da cui dovrebbe venire.
 */
const { existsSync, statSync, readdirSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const src = join(root, 'python-sidecar', 'sidecar.py');
const dist = join(root, 'python-sidecar', 'dist', 'crateforge-sidecar');
const bin = ['crateforge-sidecar.exe', 'crateforge-sidecar'].map((n) => join(dist, n)).find(existsSync);

if (!bin) {
  console.error('Sidecar non compilato: esegui python-sidecar/build_sidecar.(ps1|sh) prima di "npm run dist".');
  process.exit(1);
}
// Ogni file Python del sidecar conta, non solo quello principale.
const sources = [src, ...readdirSync(join(root, 'python-sidecar')).filter((f) => f.endsWith('.py')).map((f) => join(root, 'python-sidecar', f))];
const newest = Math.max(...sources.map((f) => statSync(f).mtimeMs));
const built = statSync(bin).mtimeMs;
if (built < newest) {
  console.error(
    `Sidecar compilato il ${new Date(built).toISOString()} ma il sorgente è del ${new Date(newest).toISOString()}.\n` +
      'Ricompila con python-sidecar/build_sidecar.(ps1|sh) prima di impacchettare.'
  );
  process.exit(1);
}
console.log('Sidecar aggiornato rispetto al sorgente.');
