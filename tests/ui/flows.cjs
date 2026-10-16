/**
 * Test dei flussi che attraversano più schermate:
 *  1. primo avvio — tre passi, programmi trovati già spuntati, un import che
 *     fallisce e si salta sulla sua riga, ingresso nell'app;
 *  2. barra lavori + toast + centro notifiche — un import finto che emette
 *     progresso, lanciato dal menu «Importa» della Libreria.
 *
 * Il bridge finto qui è più "vivo" di quello dello smoke test: il dialog
 * restituisce un percorso e l'import dura, così la barra ha qualcosa da
 * mostrare e l'esito genera davvero un toast.
 */
const { app, BrowserWindow } = require('electron');
const { join } = require('path');
const { writeFileSync, mkdirSync } = require('fs');

const APP = join(__dirname, '..', '..');
const outDir = process.argv[2] || join(APP, 'out', 'ui-test');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];

const press = (el) =>
  `for (const type of ['pointerdown','mousedown','mouseup','click']) {
     ${el}.dispatchEvent(type.startsWith('pointer')
       ? new PointerEvent(type, { bubbles: true, cancelable: true })
       : new MouseEvent(type, { bubbles: true, cancelable: true }));
   }`;

/** Clic sul primo elemento il cui testo COMINCIA con `text` (gli elementi disabilitati non contano). */
const clickText = (sel, text) =>
  `(() => {
     const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
       .find(e => !e.disabled && (e.textContent||'').trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())}));
     if (!el) return false;
     ${press('el')}
     return true;
   })()`;

const isEnabled = (text) =>
  `(() => {
     const el = [...document.querySelectorAll('button')].find(e => (e.textContent||'').trim().startsWith(${JSON.stringify(text)}));
     return el ? !el.disabled : null;
   })()`;

const webPreferences = (preload) => ({
  preload: join(__dirname, preload),
  contextIsolation: true,
  sandbox: false,
  backgroundThrottling: false
});

app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true });

  /* ---------------- 1. PRIMO AVVIO ---------------- */
  process.env.CF_ONBOARDED = '0';
  process.env.CF_FAIL_IMPORT = 'traktor';
  let win = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: webPreferences('preload.cjs') });
  await win.loadFile(join(APP, 'out/renderer/index.html'));
  await wait(2200);

  const steps = await win.webContents.executeJavaScript(`[...document.querySelectorAll('ol li')].map(l => l.textContent.trim())`);
  if (steps.length !== 3) problems.push(`primo avvio: attesi 3 passi, trovati ${steps.length}`);
  else console.log('OK  passi            ' + steps.join(' · '));

  const tiles = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('button[role="checkbox"]')].map(b => ({ text: b.innerText.replace(/\\n/g, ' '), on: b.getAttribute('aria-checked') === 'true' }))`
  );
  const on = tiles.filter((x) => x.on).length;
  const notFound = tiles.filter((x) => /non trovato/.test(x.text)).length;
  if (tiles.length !== 5) problems.push(`primo avvio: attesi 5 programmi, trovati ${tiles.length}`);
  if (on !== 3) problems.push(`primo avvio: i 3 programmi trovati devono essere già spuntati (spuntati: ${on})`);
  if (notFound !== 2) problems.push(`primo avvio: i programmi non trovati devono dirlo (${notFound})`);
  console.log(`OK  programmi        ${tiles.length} · ${on} spuntati · ${notFound} non trovati`);
  writeFileSync(join(outDir, 'welcome-pick.png'), (await win.webContents.capturePage()).toPNG());

  if (!(await win.webContents.executeJavaScript(clickText('button', 'Importa (3)'))))
    problems.push('primo avvio: pulsante «Importa (3)» non trovato');
  await wait(2500);

  const rows = await win.webContents.executeJavaScript(`document.body.innerText`);
  if (!/collection\.nml non leggibile/.test(rows)) problems.push('primo avvio: l’errore di import non compare sulla riga');
  if (!/Riprova/.test(rows) || !/Salta/.test(rows)) problems.push('primo avvio: mancano «Riprova» e «Salta» sulla riga fallita');
  if ((await win.webContents.executeJavaScript(isEnabled('Continua'))) !== false)
    problems.push('primo avvio: «Continua» deve restare fermo finché un import fallito non è deciso');
  writeFileSync(join(outDir, 'welcome-import.png'), (await win.webContents.capturePage()).toPNG());

  await win.webContents.executeJavaScript(clickText('li button', 'Salta'));
  await wait(500);
  if ((await win.webContents.executeJavaScript(isEnabled('Continua'))) !== true)
    problems.push('primo avvio: dopo «Salta» si deve poter continuare');
  else console.log('OK  import           errore sulla riga · Riprova/Salta · si prosegue dopo la scelta');

  await win.webContents.executeJavaScript(clickText('button', 'Continua'));
  await wait(800);
  if (!(await win.webContents.executeJavaScript(`document.body.innerText.includes('Tutto pronto')`)))
    problems.push('primo avvio: passo «Pronto» non raggiunto');
  writeFileSync(join(outDir, 'welcome-ready.png'), (await win.webContents.capturePage()).toPNG());

  const finish = await win.webContents.executeJavaScript(clickText('button', 'Guarda la libreria'));
  await wait(1500);
  const inApp = await win.webContents.executeJavaScript(`!!document.querySelector('nav button')`);
  if (!finish || !inApp) problems.push('primo avvio: «Guarda la libreria» non porta nell’app');
  else console.log('OK  fine             si entra nella Libreria');

  /* ---------------- 2. BARRA LAVORI / TOAST / NOTIFICHE ---------------- */
  // La finestra nuova va caricata PRIMA di chiudere la vecchia: distruggerla
  // mentre l'altra carica aborta il load (ERR_FAILED -2).
  process.env.CF_ONBOARDED = '1';
  delete process.env.CF_FAIL_IMPORT;
  const first = win;
  win = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: webPreferences('preload-job.cjs') });
  await win.loadFile(join(APP, 'out/renderer/index.html'));
  await wait(2200);
  first.destroy();
  await wait(300);

  await win.webContents.executeJavaScript(clickText('main button', 'Importa'));
  await wait(500);
  const started = await win.webContents.executeJavaScript(clickText('[data-radix-popper-content-wrapper] button', 'Rekordbox (file XML)'));
  if (!started) problems.push('barra lavori: voce «Rekordbox (file XML)» non trovata nel menu Importa');
  await wait(1200);

  const bar = await win.webContents.executeJavaScript(
    `(() => {
       const t = document.body.innerText;
       return {
         visible: /Rekordbox \\(file XML\\)/.test(t) && /Importazione libreria/.test(t),
         eta: /ETA/.test(t),
         cancel: /Annulla/.test(t),
         progressbar: !!document.querySelector('[role="progressbar"]')
       };
     })()`
  );
  if (!bar.visible) problems.push('barra lavori: non compare con la fase durante il lavoro');
  if (!bar.progressbar) problems.push('barra lavori: nessuna progressbar');
  if (!bar.cancel) problems.push('barra lavori: manca «Annulla»');
  console.log(`OK  barra lavori     fase visibile · ETA=${bar.eta} · annulla=${bar.cancel}`);
  writeFileSync(join(outDir, 'jobbar.png'), (await win.webContents.capturePage()).toPNG());

  await wait(3500);
  const done = await win.webContents.executeJavaScript(
    `(() => {
       const t = document.body.innerText;
       return { toast: /brani importati/.test(t) && !!document.querySelector('[data-sonner-toast]'), barGone: !/ETA/.test(t) };
     })()`
  );
  if (!done.toast) problems.push('toast: nessun toast di esito dopo il lavoro');
  else console.log('OK  toast            esito mostrato a fine lavoro');
  if (!done.barGone) problems.push('barra lavori: resta visibile dopo la fine');
  writeFileSync(join(outDir, 'toast.png'), (await win.webContents.capturePage()).toPNG());

  await win.webContents.executeJavaScript(`(() => { const b = document.querySelector('button[aria-label="Notifiche"]'); ${press('b')} return true; })()`);
  await wait(700);
  const center = await win.webContents.executeJavaScript(
    `(() => { const p = document.querySelector('[data-radix-popper-content-wrapper]'); return p ? p.innerText : ''; })()`
  );
  if (!/Rekordbox \(file XML\)/.test(center)) problems.push('centro notifiche: l’esito del lavoro non è stato registrato');
  else console.log('OK  notifiche        esito registrato nello storico');

  console.log('\n=========================================');
  if (problems.length === 0) console.log('FLOW TEST: nessun problema trovato.');
  else {
    console.log(`FLOW TEST: ${problems.length} problemi`);
    for (const p of problems) console.log(' - ' + p);
  }
  console.log('=========================================');
  app.exit(problems.length ? 1 : 0);
}).catch((err) => {
  console.log('\nFLOW TEST: interrotto da un errore\n - ' + (err && err.stack ? err.stack : String(err)));
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
