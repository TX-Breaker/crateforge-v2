/**
 * Test dei due sistemi nuovi della V2:
 *  1. primo avvio — cinque passi, card di rilevamento nei tre stati, import;
 *  2. barra job + toast + centro notifiche — un job finto che emette progresso.
 *
 * Il bridge finto qui è più "vivo" di quello degli screenshot: il dialog
 * restituisce un percorso e l'import dura, così la barra job ha qualcosa da
 * mostrare e l'esito genera davvero un toast.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
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

const clickText = (sel, text) =>
  `(() => {
     const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
       .find(e => (e.textContent||'').trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
     if (!el) return false;
     ${press('el')}
     return true;
   })()`;

app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true });

  /* ---------------- 1. PRIMO AVVIO ---------------- */
  process.env.CF_ONBOARDED = '0';
  let win = new BrowserWindow({
    width: 1440, height: 900, show: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false }
  });
  await win.loadFile(join(APP, 'out/renderer/index.html'));
  await wait(2200);

  const steps = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('header span')].map(s => s.textContent.trim()).filter(Boolean).slice(0,6)`
  );
  if (steps.length < 5) problems.push(`primo avvio: attesi 5 passi, trovati ${steps.length}`);
  else console.log('OK  passi          ' + steps.join(' · '));

  // passo 2: rilevamento
  await win.webContents.executeJavaScript(clickText('footer button', 'Avanti'));
  await wait(1400);
  const detect = await win.webContents.executeJavaScript(
    `(() => {
       const text = document.querySelector('main, div')?.innerText || document.body.innerText;
       const cards = ['Rekordbox','Traktor','Serato','VirtualDJ','Engine DJ'].filter(n => text.includes(n));
       return {
         cards,
         ready: (text.match(/pronto/g) || []).length,
         readOnly: text.includes('sola lettura'),
         notFound: (text.match(/non trovato/g) || []).length,
         browse: (text.match(/Indica il file/g) || []).length,
         explains: text.includes('Come funziona il rilevamento')
       };
     })()`
  );
  const wantCards = ['Rekordbox', 'Traktor', 'Serato', 'VirtualDJ', 'Engine DJ'];
  for (const c of wantCards) if (!detect.cards.includes(c)) problems.push(`primo avvio: manca la card ${c}`);
  if (detect.ready < 2) problems.push('primo avvio: nessuna card "pronto"');
  if (!detect.readOnly) problems.push('primo avvio: Serato non dichiara il limite di sola lettura');
  if (detect.notFound < 2) problems.push('primo avvio: gli stati "non trovato" non compaiono');
  if (detect.browse < 2) problems.push('primo avvio: manca il fallback manuale sulle card non trovate');
  if (!detect.explains) problems.push('primo avvio: manca la spiegazione del rilevamento');
  console.log(
    `OK  rilevamento    ${detect.cards.length}/5 card · ${detect.ready} pronte · ${detect.notFound} non trovate · fallback ${detect.browse}`
  );
  writeFileSync(join(outDir, 'onboarding-detect.png'), (await win.webContents.capturePage()).toPNG());

  // passi 3→5
  await win.webContents.executeJavaScript(clickText('footer button', 'Avanti'));
  await wait(700);
  const importStep = await win.webContents.executeJavaScript(`document.body.innerText.includes('Importa le librerie')`);
  if (!importStep) problems.push('primo avvio: passo 3 (import) non raggiunto');
  const runImport = await win.webContents.executeJavaScript(clickText('button', 'Importa le librerie selezionate'));
  if (!runImport) problems.push('primo avvio: bottone di import non trovato');
  await wait(2500);
  const diag = await win.webContents.executeJavaScript(`document.body.innerText.includes('Prima diagnosi')`);
  if (!diag) problems.push('primo avvio: dopo l\'import non si arriva alla diagnosi');
  else console.log('OK  import+diagnosi passo 3 → 4 automatico dopo l\'import');
  await win.webContents.executeJavaScript(clickText('footer button', 'Avanti'));
  await wait(700);
  const prefs = await win.webContents.executeJavaScript(`document.body.innerText.includes('Come vuoi lavorare')`);
  if (!prefs) problems.push('primo avvio: passo 5 (preferenze) non raggiunto');
  const finish = await win.webContents.executeJavaScript(clickText('footer button', 'Inizia a usare'));
  await wait(1500);
  const inApp = await win.webContents.executeJavaScript(`!!document.querySelector('nav button')`);
  if (!finish || !inApp) problems.push('primo avvio: "Inizia a usare CrateForge" non porta nell\'app');
  else console.log('OK  fine wizard    si entra nella shell');

  /* ---------------- 2. BARRA JOB / TOAST / NOTIFICHE ---------------- */
  // La finestra nuova va creata e caricata PRIMA di chiudere la vecchia:
  // distruggerla mentre l'altra carica aborta il load (ERR_FAILED -2).
  process.env.CF_ONBOARDED = '1';
  const first = win;
  win = new BrowserWindow({
    width: 1440, height: 900, show: true,
    webPreferences: { preload: join(__dirname, 'preload-job.cjs'), contextIsolation: true, sandbox: false }
  });
  await win.loadFile(join(APP, 'out/renderer/index.html'));
  await wait(2200);
  first.destroy();
  await wait(300);

  const started = await win.webContents.executeJavaScript(clickText('button', 'Importa collection XML'));
  if (!started) problems.push('barra job: bottone di import non trovato in Panoramica');
  await wait(1200);

  const bar = await win.webContents.executeJavaScript(
    `(() => {
       const t = document.body.innerText;
       return {
         visible: /Importa collection XML/.test(t) && /Scansione file|Importazione libreria/.test(t),
         eta: /ETA/.test(t),
         cancel: /Annulla/.test(t),
         progressbar: !!document.querySelector('[role="progressbar"]')
       };
     })()`
  );
  if (!bar.visible) problems.push('barra job: non compare con fase durante il job');
  if (!bar.progressbar) problems.push('barra job: nessuna progressbar');
  if (!bar.cancel) problems.push('barra job: manca il bottone Annulla');
  console.log(`OK  barra job      fase visibile · ETA=${bar.eta} · annulla=${bar.cancel}`);
  writeFileSync(join(outDir, 'jobbar.png'), (await win.webContents.capturePage()).toPNG());

  await wait(3500);
  const done = await win.webContents.executeJavaScript(
    `(() => {
       const t = document.body.innerText;
       return { toast: /brani|playlist|cue/.test(t) && !!document.querySelector('[data-sonner-toast]'), barGone: !/ETA/.test(t) };
     })()`
  );
  if (!done.toast) problems.push('toast: nessun toast di esito dopo il job');
  else console.log('OK  toast          esito mostrato a fine job');
  if (!done.barGone) problems.push('barra job: resta visibile dopo la fine del job');
  writeFileSync(join(outDir, 'toast.png'), (await win.webContents.capturePage()).toPNG());

  // il centro notifiche deve aver registrato l'esito
  await win.webContents.executeJavaScript(
    `(() => { const b = document.querySelector('header button[aria-label]'); ${press('b')} return true; })()`
  );
  await wait(700);
  const center = await win.webContents.executeJavaScript(
    `(() => { const p = document.querySelector('[data-radix-popper-content-wrapper]'); return p ? p.innerText : ''; })()`
  );
  if (!/Importa collection XML/.test(center))
    problems.push('centro notifiche: l\'esito del job non è stato registrato');
  else console.log('OK  notifiche      esito registrato nello storico');

  console.log('\n=========================================');
  if (problems.length === 0) console.log('FLOW TEST: nessun problema trovato.');
  else {
    console.log(`FLOW TEST: ${problems.length} problemi`);
    for (const p of problems) console.log(' - ' + p);
  }
  console.log('=========================================');
  app.exit(problems.length ? 1 : 0);
});

app.on('window-all-closed', () => app.quit());
