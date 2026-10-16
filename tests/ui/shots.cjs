/**
 * Fotografa ogni destinazione dell'interfaccia (e le sue schede) con il bridge
 * finto, per guardare l'interfaccia com'è invece di immaginarla.
 *
 * Uso: electron tests/ui/shots.cjs <cartella-uscita>
 *      CF_ONBOARDED=0 electron tests/ui/shots.cjs <cartella>   → procedura iniziale
 *      CF_THEME=light ...                                        → tema chiaro
 *
 * Non verifica niente: produce PNG. I controlli stanno in smoke.cjs.
 */
const { app, BrowserWindow } = require('electron');
const { join } = require('path');
const { mkdirSync, writeFileSync } = require('fs');

const APP = join(__dirname, '..', '..');
const outDir = process.argv[2] || join(APP, 'out', 'shots');
const W = Number(process.env.CF_W || 1440);
const H = Number(process.env.CF_H || 900);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false }
  });
  await win.loadFile(join(APP, 'out/renderer/index.html'));
  await wait(2500);

  const shot = async (name) => {
    await wait(700);
    writeFileSync(join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    console.log('scattata', name);
  };
  const js = (code) => win.webContents.executeJavaScript(code);
  const press = (selector, index) =>
    js(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!el) return null;
      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
        el.dispatchEvent(type.startsWith('pointer')
          ? new PointerEvent(type, { bubbles: true, cancelable: true })
          : new MouseEvent(type, { bubbles: true, cancelable: true }));
      }
      return (el.textContent || '').trim();
    })()`);

  try {
    if (process.env.CF_ONBOARDED === '0') {
      // Procedura iniziale: si avanza col pulsante principale finché si può.
      for (let i = 0; i < 10; i++) {
        await shot(`wizard-${String(i).padStart(2, '0')}`);
        // prima scelta disponibile, se c'è, poi "avanti"
        await js(`(() => {
          const scelta = document.querySelector('[role=radio],[role=checkbox],[data-choice]');
          if (scelta && scelta.getAttribute('aria-checked') !== 'true') scelta.click();
          return true;
        })()`);
        await wait(300);
        const avanti = await js(`(() => {
          const b = [...document.querySelectorAll('footer button')].reverse().find(x => !x.disabled);
          if (!b) return null; b.click(); return b.textContent.trim();
        })()`);
        if (!avanti) break;
      }
    } else {
      const n = await js(`document.querySelectorAll('nav button').length`);
      for (let i = 0; i < n; i++) {
        const label = await press('nav button', i);
        if (!label) continue;
        const base = `${String(i).padStart(2, '0')}-${slug(label)}`;
        await shot(base);
        const tabs = await js(`document.querySelectorAll('main [role=radio]').length`);
        for (let t = 1; t < tabs; t++) {
          const tl = await press('main [role=radio]', t);
          if (tl) await shot(`${base}--${slug(tl)}`);
        }
      }
    }
  } catch (err) {
    console.log('errore', err && err.stack ? err.stack : String(err));
  }
  app.exit(0);
});

app.on('window-all-closed', () => app.quit());
