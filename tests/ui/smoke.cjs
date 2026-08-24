/**
 * Smoke test autonomo della UI costruita.
 *
 * Guida l'app reale (bundle di out/renderer) con un bridge IPC finto e, per ogni
 * destinazione e ogni tab, controlla:
 *   - nessun errore in console e nessuna eccezione non gestita;
 *   - la pagina non è bianca (il contenuto ha testo);
 *   - nessuna chiave i18n grezza a video (es. "step1", "nav.tracks");
 *   - nessun testo "undefined"/"NaN"/"[object Object]" sfuggito;
 *   - i controlli interattivi hanno un nome accessibile.
 * Poi prova le interazioni globali: palette comandi, notifiche, scorciatoie,
 * cambio tema/stile/densità e il rientro da Esperto a Semplice.
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

/** rotte come compaiono nella sidebar (italiano), con le loro tab */
const ROUTES = [
  ['Panoramica', []],
  ['Salute', []],
  ['Tracce', []],
  ['Backup', []],
  ['Pulizia', ['Orfani', 'Duplicati', 'Quarantena']],
  ['Ritrova file', ['Per nome file', 'Per impronta']],
  ['Arricchisci', ['Cue', 'Tag', 'Stems']],
  ['Set', ['Costruisci', 'Analizza']],
  ['Nuovi acquisti', []],
  ['Converti', []],
  ['Report', ['Excel', 'SIAE']],
  ['Attività', []],
  ['Impostazioni', ['Generale', 'Sicurezza', 'Motore', 'Informazioni']]
];

const INSPECT = `(() => {
  const main = document.querySelector('main');
  if (!main) return { ok: false, why: 'nessun <main>' };
  const text = main.innerText || '';
  // chiavi i18n grezze: o un identificatore camelCase noto, o un "namespace.chiave"
  // di uno dei namespace dell'app (i nomi di operazione dell'oplog, tipo
  // backup.execute, sono dati veri e non vanno segnalati)
  const rawKey = /(^|\\n)\\s*(step1|step2|subtitle|warnTitle|warnBody|outDone|emptyTitle|emptyBody|(nav|common|tab|target|notif|job|phase|status|palette|action|shortcut|filter|badge|density|safety|danger|app|mode|theme|group)\\.[a-zA-Z]+)\\s*(\\n|$)/;
  const suspicious = [];
  if (text.trim().length < 20) suspicious.push('contenuto quasi vuoto');
  if (rawKey.test(text)) suspicious.push('chiave i18n grezza a video');
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
  const bad = nodes.filter(
    (n) => interactive.has(n.role?.value) && !n.ignored && !(n.name?.value || '').trim()
  );
  const byRole = {};
  for (const n of bad) byRole[n.role.value] = (byRole[n.role.value] || 0) + 1;
  return { count: bad.length, byRole };
}

/**
 * ⚠ Rete di sicurezza sull'intera esecuzione.
 *
 * Senza, qualunque sonda che lanci fa terminare la funzione principale senza
 * stampare il riepilogo e senza chiamare `app.exit`: il processo resta appeso e
 * chi lo guarda vede solo un rifiuto non gestito. Un test che muore in silenzio
 * non dice che cosa e' rotto, e in piu' non dice nemmeno di essere rotto lui.
 */
app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false }
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

  /**
   * Radix attiva tab e switch su pointerdown, non sul click sintetico: per
   * pilotarli serve la sequenza completa di eventi puntatore.
   */
  const click = (sel, text) =>
    win.webContents.executeJavaScript(
      `(() => {
         const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
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

  /* ---- giro completo delle destinazioni ---- */
  for (const [route, tabs] of ROUTES) {
    const found = await click('nav button', route);
    if (!found) {
      problems.push(`rotta non trovata nella sidebar: ${route}`);
      continue;
    }
    await wait(650);
    const r = await win.webContents.executeJavaScript(INSPECT);
    const ax = await unnamedControls(dbg);
    if (!r.ok) problems.push(`${route}: ${r.why}`);
    else {
      for (const s of r.suspicious) problems.push(`${route}: ${s}`);
      if (ax.count > 0)
        problems.push(`${route}: ${ax.count} controlli senza nome accessibile ${JSON.stringify(ax.byRole)}`);
      console.log(`OK  ${route.padEnd(16)} ${String(r.len).padStart(5)} char · ${r.head}`);
    }

    for (const tab of tabs) {
      const t = await click('[role="tab"]', tab);
      if (!t) {
        problems.push(`${route}: tab non trovata "${tab}"`);
        continue;
      }
      await wait(500);
      // la tab cliccata deve essere davvero quella attiva
      const active = await win.webContents.executeJavaScript(
        `(() => {
           const a = [...document.querySelectorAll('[role="tab"]')].find(e => e.dataset.state === 'active');
           return a ? a.textContent.trim() : '';
         })()`
      );
      if (!active.toLowerCase().startsWith(tab.toLowerCase()))
        problems.push(`${route}: cliccata la tab "${tab}" ma attiva è "${active}"`);
      const rt = await win.webContents.executeJavaScript(INSPECT);
      const axt = await unnamedControls(dbg);
      if (!rt.ok) problems.push(`${route} › ${tab}: ${rt.why}`);
      else {
        for (const s of rt.suspicious) problems.push(`${route} › ${tab}: ${s}`);
        if (axt.count > 0)
          problems.push(
            `${route} › ${tab}: ${axt.count} controlli senza nome ${JSON.stringify(axt.byRole)}`
          );
        console.log(`OK  ${(route + ' › ' + tab).padEnd(16)} ${String(rt.len).padStart(5)} char · ${rt.head}`);
      }
    }
  }

  /* ---- interazioni globali ---- */
  // palette comandi
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control'] });
  await wait(600);
  const paletteOpen = await win.webContents.executeJavaScript(
    `!!document.querySelector('[cmdk-root]') || !!document.querySelector('[role="dialog"]')`
  );
  if (!paletteOpen) problems.push('palette comandi: non si apre con Ctrl+K');
  else {
    const guarded = await win.webContents.executeJavaScript(
      `(() => {
         const items = [...document.querySelectorAll('[cmdk-item]')].map(i => (i.textContent||'').trim());
         return { total: items.length, guarded: items.filter(t => /apre la pagina/i.test(t)).length };
       })()`
    );
    if (guarded.total === 0) problems.push('palette comandi: nessuna voce elencata');
    if (guarded.guarded === 0) problems.push('palette comandi: le voci distruttive non sono marcate');
    console.log(`OK  palette         ${guarded.total} voci · ${guarded.guarded} distruttive marcate`);
    const img = await win.webContents.capturePage();
    writeFileSync(join(outDir, 'palette.png'), img.toPNG());
  }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await wait(400);

  // scorciatoie con "?" (evento vero: sendInputEvent 'char' non genera keydown)
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })), true`
  );
  await wait(500);
  const shortcuts = await win.webContents.executeJavaScript(
    `(() => { const d = document.querySelector('[role="dialog"]'); return d ? (d.innerText||'').slice(0,40) : ''; })()`
  );
  if (!shortcuts) problems.push('scorciatoie: "?" non apre la cheatsheet');
  else console.log(`OK  scorciatoie     ${shortcuts.replace(/\n/g, ' ')}`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await wait(400);

  // centro notifiche
  const bell = await win.webContents.executeJavaScript(
    `(() => { const b = document.querySelector('header button[aria-label]'); if (!b) return false; b.click(); return true; })()`
  );
  await wait(600);
  const notif = await win.webContents.executeJavaScript(
    `(() => { const p = document.querySelector('[data-radix-popper-content-wrapper]'); return p ? (p.innerText||'').slice(0,60) : ''; })()`
  );
  if (!bell || !notif) problems.push('centro notifiche: non si apre dalla campanella');
  else console.log(`OK  notifiche      ${notif.replace(/\n/g, ' ')}`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await wait(400);

  // temi: le quattro palette devono cambiare davvero il canvas.
  // La lettura va fatta DOPO il cross-fade di 240ms, altrimenti
  // getComputedStyle restituisce il colore ancora in transizione.
  const palettes = [];
  for (const [style, dark] of [['studio', true], ['studio', false], ['neutral', true], ['neutral', false]]) {
    await win.webContents.executeJavaScript(
      `(() => {
         document.documentElement.dataset.style = '${style}';
         document.documentElement.classList.toggle('dark', ${dark});
         return true;
       })()`
    );
    await wait(400);
    const bg = await win.webContents.executeJavaScript(
      `getComputedStyle(document.body).backgroundColor`
    );
    palettes.push(`${style}/${dark ? 'dark' : 'light'}=${bg}`);
  }
  if (new Set(palettes.map((p) => p.split('=')[1])).size !== 4)
    problems.push(`le quattro palette non danno quattro canvas distinti: ${palettes.join(' ')}`);
  else console.log(`OK  palette tema   ${palettes.join(' · ')}`);
  await win.webContents.executeJavaScript(
    `document.documentElement.dataset.style='studio'; document.documentElement.classList.add('dark'); true`
  );

  // densità delle liste
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
  else console.log(`OK  densità        ${dens}`);

  // reduced motion
  /* ⚠ La sonda restituisce un messaggio invece di lanciare quando l'elemento
     non c'e'. Prima lanciava: `getComputedStyle(null)` diventava un
     TypeError dentro la pagina, `executeJavaScript` rifiutava, e la funzione
     principale moriva PRIMA di stampare il riepilogo. Il risultato era un test
     che non diceva ne' quali controlli erano passati ne' quale era fallito —
     solo un rifiuto non gestito e nessuna riga finale. Un test che muore in
     silenzio e' peggio di un test che fallisce. */
  const rm = await win.webContents.executeJavaScript(
    `(() => {
       document.documentElement.dataset.motion = 'reduce';
       const el = document.querySelector('nav button');
       if (!el) {
         delete document.documentElement.dataset.motion;
         return 'NESSUN ELEMENTO: nav button non trovato';
       }
       const d = getComputedStyle(el).transitionDuration;
       delete document.documentElement.dataset.motion;
       return d;
     })()`
  );
  // 0.01ms viene serializzato come "1e-05s": è il valore atteso, non un errore
  if (!/^(1e-05s|0\.00001s|0s)$/.test(rm.trim()))
    problems.push(`reduced motion non azzera le transizioni: ${rm}`);
  else console.log(`OK  reduced motion  transition=${rm}`);

  /* ---- modalità Semplice: le destinazioni Esperto spariscono ---- */
  const simple = await win.webContents.executeJavaScript(
    `(() => {
       const before = document.querySelectorAll('nav button').length;
       return before;
     })()`
  );
  await click('nav button', 'Impostazioni');
  await wait(600);
  await click('[role="tab"]', 'Sicurezza');
  await wait(500);
  const flipped = await win.webContents.executeJavaScript(
    `(() => {
       const sw = document.querySelector('button[role="switch"][data-state="checked"]');
       if (!sw) return false;
       for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
         sw.dispatchEvent(type.startsWith('pointer')
           ? new PointerEvent(type, { bubbles: true, cancelable: true })
           : new MouseEvent(type, { bubbles: true, cancelable: true }));
       }
       return true;
     })()`
  );
  if (!flipped) problems.push('modalità: nessuno switch attivo trovato in Impostazioni › Sicurezza');
  await wait(900);
  const after = await win.webContents.executeJavaScript(`document.querySelectorAll('nav button').length`);
  if (!(after < simple)) problems.push(`modalità Semplice: le voci Esperto non spariscono (${simple} → ${after})`);
  else console.log(`OK  modalità       Esperto ${simple} voci → Semplice ${after} voci`);

  /* ---- errori raccolti ---- */
  /* ⚠ Anche questa lettura puo' fallire, e se fallisce non deve portarsi via
     il riepilogo di tutto cio' che e' stato verificato prima. */
  try {
    const winErrors = await win.webContents.executeJavaScript(`window.__cfErr || []`);
    for (const e of winErrors) problems.push(`eccezione renderer: ${e}`);
  } catch (err) {
    problems.push(`impossibile leggere gli errori del renderer: ${err && err.message}`);
  }
  for (const e of consoleErrors) problems.push(`console: ${e}`);

  console.log('\n=========================================');
  if (problems.length === 0) {
    console.log('SMOKE TEST: nessun problema trovato.');
  } else {
    console.log(`SMOKE TEST: ${problems.length} problemi`);
    for (const p of problems) console.log(' - ' + p);
  }
  console.log('=========================================');

  app.exit(problems.length ? 1 : 0);
}).catch((err) => {
  console.log('');
  console.log('=========================================');
  console.log('SMOKE TEST: interrotto da un errore');
  console.log(' - ' + (err && err.stack ? err.stack : String(err)));
  console.log('=========================================');
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
