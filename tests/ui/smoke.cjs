/**
 * Smoke test autonomo della UI costruita.
 *
 * Guida l'app reale (bundle di out/renderer) con un bridge IPC finto e, per ogni
 * schermata, ogni scheda e ogni pannello laterale, controlla:
 *   - nessun errore in console e nessuna eccezione non gestita;
 *   - la schermata non è bianca (il contenuto ha testo);
 *   - nessuna chiave di traduzione grezza a video (es. "fix.i.noBpm");
 *   - nessun testo "undefined"/"NaN"/"[object Object]" o segnaposto "{n}";
 *   - i controlli interattivi hanno un nome accessibile.
 * Poi prova le interazioni globali: palette comandi, notifiche, scorciatoie,
 * temi, densità, animazioni ridotte, e che i gate di scrittura partano spenti.
 *
 * Esce con codice 1 se trova qualcosa.
 */
const { app, BrowserWindow } = require('electron');
const { join } = require('path');
const { writeFileSync, mkdirSync } = require('fs');

const APP = join(__dirname, '..', '..');
const outDir = process.argv[2] || join(APP, 'out', 'ui-test');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const problems = [];
const consoleErrors = [];

/** schermate come compaiono nella barra laterale (italiano), con le loro schede */
const ROUTES = [
  ['Libreria', []],
  ['Da sistemare', []],
  ['Sincronizza', ['Converti', 'Tieni allineati']],
  ['Set', ['Crea', 'Controlla']],
  ['Backup', []],
  ['Report', ['Excel', 'SIAE', 'Cronologia']],
  ['Impostazioni', ['Generale', 'Sicurezza', 'Versioni', 'Informazioni']]
];

/** pannelli laterali aperti dalla schermata Da sistemare: [pulsante, testo atteso] */
const FIX_SHEETS = [
  ['Rivedi', 'Doppioni'],
  ['Aggiungi', 'Senza hot cue'],
  ['Cerca online', 'Cerca online'],
  ['File spostati', 'File spostati'],
  ['File fuori libreria', 'File fuori libreria'],
  ['Quarantena', 'Quarantena'],
  ['Separa le tracce', 'Separa le tracce']
];

const NAMESPACES =
  'nav|c|shell|lib|fix|rel|dup|q|orph|tag|cue|stem|sync|f|set|bak|rep|st|w|xl|slot|phase|job|notif|palette|action|shortcut|filter|badge|density|tracks|wheel|app';

const inspect = (selector) => `(() => {
  const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const root = all[all.length - 1];
  if (!root) return { ok: false, why: 'nessun ' + ${JSON.stringify(selector)} };
  const text = root.innerText || '';
  const rawKey = new RegExp('(^|\\\\s)(${NAMESPACES})\\\\.[a-zA-Z][\\\\w.]*(\\\\s|$)');
  const suspicious = [];
  if (text.trim().length < 20) suspicious.push('contenuto quasi vuoto');
  const raw = text.match(rawKey);
  if (raw) suspicious.push('chiave grezza a video: ' + raw[0].trim());
  if (/\\bundefined\\b/.test(text)) suspicious.push('testo "undefined"');
  if (/\\bNaN\\b/.test(text)) suspicious.push('testo "NaN"');
  if (/\\[object Object\\]/.test(text)) suspicious.push('"[object Object]"');
  if (/\\{[a-z]+\\}/.test(text)) suspicious.push('segnaposto {x} non sostituito');
  return { ok: true, len: text.length, suspicious, head: text.slice(0, 60).replace(/\\n/g, ' ') };
})()`;

/**
 * Nome accessibile calcolato da Chromium, non indovinato dal DOM: un <label> che
 * avvolge uno switch Radix nomina il controllo, ma textContent non lo vede.
 */
async function unnamedControls(dbg) {
  const { nodes } = await dbg.sendCommand('Accessibility.getFullAXTree');
  const interactive = new Set(['button', 'checkbox', 'switch', 'tab', 'link', 'textbox', 'combobox', 'radio']);
  const bad = nodes.filter((n) => interactive.has(n.role?.value) && !n.ignored && !(n.name?.value || '').trim());
  const byRole = {};
  for (const n of bad) byRole[n.role.value] = (byRole[n.role.value] || 0) + 1;
  return { count: bad.length, byRole };
}

/**
 * ⚠ Rete di sicurezza sull'intera esecuzione: un test che muore in silenzio
 * non dice che cosa e' rotto, e in piu' non dice nemmeno di essere rotto lui.
 */
app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    /* Senza, una finestra coperta da altre smette di disegnare: le animazioni
       d'uscita non finiscono mai e il test legge la schermata precedente. */
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false }
  });

  win.webContents.on('console-message', (_e, level, msg, line, src) => {
    if (level >= 2) consoleErrors.push(`${msg.slice(0, 200)} (${src}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, d) => problems.push(`renderer morto: ${d.reason}`));
  win.webContents.on('preload-error', (_e, p, err) => problems.push(`preload: ${err.message}`));

  await win.loadFile(join(APP, 'out/renderer/index.html'));
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Accessibility.enable');
  await win.webContents.executeJavaScript(
    `window.__cfErr = []; window.addEventListener('error', e => window.__cfErr.push(String(e.message)));
     window.addEventListener('unhandledrejection', e => window.__cfErr.push('rejection: ' + String(e.reason)));
     true`
  );
  await wait(2500);

  /** Radix attiva alcuni controlli su pointerdown: serve la sequenza completa. */
  const click = (sel, text, within = 'body') =>
    win.webContents.executeJavaScript(
      `(() => {
         const scopes = [...document.querySelectorAll(${JSON.stringify(within)})];
         const scope = scopes[scopes.length - 1] || document.body;
         const el = [...scope.querySelectorAll(${JSON.stringify(sel)})]
           .find(e => (e.textContent||'').trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())}));
         if (!el) return false;
         for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
           el.dispatchEvent(type.startsWith('pointer')
             ? new PointerEvent(type, { bubbles: true, cancelable: true })
             : new MouseEvent(type, { bubbles: true, cancelable: true }));
         }
         return true;
       })()`
    );

  const check = async (label, selector) => {
    const r = await win.webContents.executeJavaScript(inspect(selector));
    const ax = await unnamedControls(dbg);
    if (!r.ok) problems.push(`${label}: ${r.why}`);
    else {
      for (const s of r.suspicious) problems.push(`${label}: ${s}`);
      if (ax.count > 0) problems.push(`${label}: ${ax.count} controlli senza nome accessibile ${JSON.stringify(ax.byRole)}`);
      console.log(`OK  ${label.padEnd(28)} ${String(r.len).padStart(5)} char · ${r.head}`);
    }
  };

  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    writeFileSync(join(outDir, `${name}.png`), img.toPNG());
  };

  /* ---- giro completo delle schermate e delle schede ---- */
  for (const [route, tabs] of ROUTES) {
    if (!(await click('nav button', route))) {
      problems.push(`schermata non trovata nella barra laterale: ${route}`);
      continue;
    }
    await wait(650);
    await check(route, 'main');
    await shot(route.replace(/\s+/g, '-').toLowerCase());

    for (const tab of tabs) {
      if (!(await click('[role="radio"]', tab, 'main'))) {
        problems.push(`${route}: scheda non trovata "${tab}"`);
        continue;
      }
      await wait(500);
      const active = await win.webContents.executeJavaScript(
        `(() => {
           const a = [...document.querySelectorAll('main [role="radio"]')].find(e => e.getAttribute('aria-checked') === 'true' && (e.textContent||'').trim().toLowerCase().startsWith(${JSON.stringify(tab.toLowerCase())}));
           return !!a;
         })()`
      );
      if (!active) problems.push(`${route}: cliccata la scheda "${tab}" ma non risulta attiva`);
      await check(`${route} › ${tab}`, 'main');
    }
  }

  /* ---- Tieni allineati: «Allinea ora» e il suo resoconto ---- */
  await click('nav button', 'Sincronizza');
  await wait(600);
  await click('[role="radio"]', 'Tieni allineati', 'main');
  await wait(800);
  if (!(await click('button', 'Allinea ora', 'main'))) problems.push('Tieni allineati: «Allinea ora» non trovato');
  else {
    await wait(900);
    const rep = await win.webContents.executeJavaScript(
      `(() => { const m = [...document.querySelectorAll('main')].pop(); return m ? m.innerText : ''; })()`
    );
    if (!/Traktor: 12 brani aggiornati/.test(rep)) problems.push('Tieni allineati: il resoconto del giro non compare');
    else console.log('OK  Tieni allineati › Allinea ora  resoconto mostrato');
    await check('Tieni allineati › resoconto', 'main');
    await shot('keep-report');
  }
  const autoOff = await win.webContents.executeJavaScript(
    `(() => { const s = [...document.querySelectorAll('main button[role="switch"]')]; return s.length ? s.every(x => x.getAttribute('data-state') === 'unchecked') : null; })()`
  );
  if (autoOff !== true) problems.push('Tieni allineati: l’automatico deve partire spento');

  /* ---- pannelli laterali di Da sistemare ---- */
  await click('nav button', 'Da sistemare');
  await wait(600);
  for (const [button, title] of FIX_SHEETS) {
    if (!(await click('button', button, 'main'))) {
      problems.push(`Da sistemare: pulsante non trovato "${button}"`);
      continue;
    }
    await wait(900);
    const header = await win.webContents.executeJavaScript(
      `(() => { const d = [...document.querySelectorAll('[role="dialog"][data-state="open"]')].pop(); return d ? (d.querySelector('h2')?.textContent || '') : ''; })()`
    );
    if (!header.toLowerCase().startsWith(title.toLowerCase()))
      problems.push(`Da sistemare › ${button}: il pannello non si apre (titolo "${header}")`);
    else await check(`Pannello › ${title}`, '[role="dialog"][data-state="open"]');
    await shot(`sheet-${title.replace(/\s+/g, '-').toLowerCase()}`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await wait(500);
  }

  /* ---- interazioni globali ---- */
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control'] });
  await wait(600);
  const paletteOpen = await win.webContents.executeJavaScript(`!!document.querySelector('[cmdk-root]')`);
  if (!paletteOpen) problems.push('palette comandi: non si apre con Ctrl+K');
  else {
    const guarded = await win.webContents.executeJavaScript(
      `(() => {
         const items = [...document.querySelectorAll('[cmdk-item]')].map(i => (i.textContent||'').trim());
         return { total: items.length, guarded: items.filter(t => /apre la schermata/i.test(t)).length };
       })()`
    );
    if (guarded.total === 0) problems.push('palette comandi: nessuna voce elencata');
    if (guarded.guarded === 0) problems.push('palette comandi: le voci che modificano file non sono marcate');
    console.log(`OK  palette                      ${guarded.total} voci · ${guarded.guarded} protette`);
    await shot('palette');
  }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await wait(400);

  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })), true`);
  await wait(500);
  const shortcuts = await win.webContents.executeJavaScript(
    `(() => { const d = document.querySelector('[role="dialog"]'); return d ? (d.innerText||'').slice(0,40) : ''; })()`
  );
  if (!shortcuts) problems.push('scorciatoie: "?" non apre l’elenco');
  else console.log(`OK  scorciatoie                  ${shortcuts.replace(/\n/g, ' ')}`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await wait(400);

  const bell = await win.webContents.executeJavaScript(
    `(() => { const b = document.querySelector('button[aria-label="Notifiche"]'); if (!b) return false; b.click(); return true; })()`
  );
  await wait(600);
  const notif = await win.webContents.executeJavaScript(
    `(() => { const p = document.querySelector('[data-radix-popper-content-wrapper]'); return p ? (p.innerText||'').slice(0,60) : ''; })()`
  );
  if (!bell || !notif) problems.push('centro notifiche: non si apre dalla campanella');
  else console.log(`OK  notifiche                    ${notif.replace(/\n/g, ' ')}`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await wait(400);

  // Le quattro palette devono cambiare davvero il canvas (lettura dopo il cross-fade).
  const palettes = [];
  for (const [style, dark] of [['studio', true], ['studio', false], ['neutral', true], ['neutral', false]]) {
    await win.webContents.executeJavaScript(
      `(() => { document.documentElement.dataset.style = '${style}'; document.documentElement.classList.toggle('dark', ${dark}); return true; })()`
    );
    await wait(400);
    palettes.push(`${style}/${dark ? 'dark' : 'light'}=${await win.webContents.executeJavaScript(`getComputedStyle(document.body).backgroundColor`)}`);
  }
  if (new Set(palettes.map((p) => p.split('=')[1])).size !== 4)
    problems.push(`le quattro palette non danno quattro canvas distinti: ${palettes.join(' ')}`);
  else console.log(`OK  palette tema               ${palettes.join(' · ')}`);
  await win.webContents.executeJavaScript(`document.documentElement.dataset.style='studio'; document.documentElement.classList.add('dark'); true`);

  const dens = await win.webContents.executeJavaScript(
    `(() => {
       const read = () => getComputedStyle(document.documentElement).getPropertyValue('--row-h').trim();
       const a = read();
       document.documentElement.dataset.density = 'compact';
       const b = read();
       document.documentElement.dataset.density = 'comfortable';
       return a + '→' + b;
     })()`
  );
  if (!/46px→30px/.test(dens)) problems.push(`densità liste non cambia: ${dens}`);
  else console.log(`OK  densità                      ${dens}`);

  const rm = await win.webContents.executeJavaScript(
    `(() => {
       document.documentElement.dataset.motion = 'reduce';
       const el = document.querySelector('nav button');
       if (!el) { delete document.documentElement.dataset.motion; return 'NESSUN ELEMENTO: nav button non trovato'; }
       const d = getComputedStyle(el).transitionDuration;
       delete document.documentElement.dataset.motion;
       return d;
     })()`
  );
  if (!/^(1e-05s|0\.00001s|0s)$/.test(rm.trim())) problems.push(`reduced motion non azzera le transizioni: ${rm}`);
  else console.log(`OK  reduced motion               transition=${rm}`);

  /* ---- i gate di scrittura partono spenti ---- */
  await click('nav button', 'Impostazioni');
  await wait(600);
  await click('[role="radio"]', 'Sicurezza', 'main');
  await wait(600);
  const gates = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('main button[role="switch"]')].map(s => s.getAttribute('data-state'))`
  );
  if (gates.length !== 2 || gates.some((g) => g !== 'unchecked'))
    problems.push(`gate di scrittura: attesi due interruttori spenti, trovati ${JSON.stringify(gates)}`);
  else console.log(`OK  gate di scrittura            2 interruttori, spenti`);

  /* ---- errori raccolti ---- */
  try {
    const winErrors = await win.webContents.executeJavaScript(`window.__cfErr || []`);
    for (const e of winErrors) problems.push(`eccezione renderer: ${e}`);
  } catch (err) {
    problems.push(`impossibile leggere gli errori del renderer: ${err && err.message}`);
  }
  for (const e of consoleErrors) problems.push(`console: ${e}`);

  console.log('\n=========================================');
  if (problems.length === 0) console.log('SMOKE TEST: nessun problema trovato.');
  else {
    console.log(`SMOKE TEST: ${problems.length} problemi`);
    for (const p of problems) console.log(' - ' + p);
  }
  console.log('=========================================');
  app.exit(problems.length ? 1 : 0);
}).catch((err) => {
  console.log('\n=========================================');
  console.log('SMOKE TEST: interrotto da un errore');
  console.log(' - ' + (err && err.stack ? err.stack : String(err)));
  console.log('=========================================');
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
