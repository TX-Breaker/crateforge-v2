import { app, BrowserWindow, Menu, Notification, Tray, nativeImage } from 'electron';
import { mt } from './mainText';

/**
 * CrateForge in background: icona nell'area di notifica, avvio con il sistema,
 * finestra che si nasconde invece di chiudersi.
 *
 * È la forma scelta per il «servizio» di sincronizzazione automatica. Un
 * servizio di sistema separato (servizio Windows, launchd) avrebbe voluto dire
 * un secondo processo che scrive nello stesso archivio dell'applicazione, con
 * una seconda copia di ogni guardia — gate, versioni, programmi chiusi, copie
 * di sicurezza — e un'installazione con privilegi. Qui gira lo stesso codice,
 * con la stessa coda dei lavori: cambia solo che la finestra può non esserci.
 *
 * Spento di serie. Lo accende l'utente, in Impostazioni.
 */

export interface BackgroundDeps {
  /** Lettura e scrittura delle impostazioni dell'archivio. */
  getSetting: (key: string) => string | null;
  setSetting: (key: string, value: string) => void;
  /** Icona del marchio (percorso). */
  icon: string;
  /** Stato dell'automatico per il menu: acceso, in pausa, spento. */
  autoState: () => 'on' | 'paused' | 'off';
  /** Mette in pausa o riprende l'automatico. */
  togglePause: () => void;
}

const KEY = 'background.enabled';
let deps: BackgroundDeps | null = null;
let tray: Tray | null = null;
let quitting = false;

export function initBackground(d: BackgroundDeps): void {
  deps = d;
  app.on('before-quit', () => {
    quitting = true;
  });
  if (isBackgroundEnabled()) ensureTray();
}

export function isBackgroundEnabled(): boolean {
  return deps?.getSetting(KEY) === '1';
}

/** Avviato dal sistema all'accesso, con la finestra da tenere nascosta. */
export function startedHidden(): boolean {
  return isBackgroundEnabled() && (process.argv.includes('--background') || app.getLoginItemSettings().wasOpenedAsHidden);
}

/** Accende o spegne il background: avvio con il sistema e icona nell'area di notifica. */
export function setBackgroundEnabled(enabled: boolean): { enabled: boolean } {
  if (!deps) return { enabled: false };
  deps.setSetting(KEY, enabled ? '1' : '0');
  /* L'avvio automatico si registra solo per l'app installata: in sviluppo
     registrerebbe l'eseguibile di Electron. */
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled, args: enabled ? ['--background'] : [] });
  }
  if (enabled) ensureTray();
  else {
    tray?.destroy();
    tray = null;
  }
  return { enabled };
}

/**
 * Da collegare all'evento `close` della finestra: con il background acceso la
 * finestra si nasconde, e l'applicazione resta viva per l'automatico.
 */
export function interceptClose(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (quitting || !isBackgroundEnabled()) return;
    e.preventDefault();
    win.hide();
  });
}

/** Una notifica di sistema, solo quando la finestra non è davanti all'utente. */
export function notifyIfHidden(title: string, body: string): void {
  const w = BrowserWindow.getAllWindows()[0];
  if (w && w.isVisible() && w.isFocused()) return;
  if (!Notification.isSupported()) return;
  new Notification({ title, body, icon: deps?.icon }).show();
}

function showWindow(): void {
  const w = BrowserWindow.getAllWindows()[0];
  if (!w) return;
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}

function ensureTray(): void {
  if (tray || !deps) return;
  const image = nativeImage.createFromPath(deps.icon).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('CrateForge');
  tray.on('click', showWindow);
  refreshMenu();
  // Il menu riporta lo stato dell'automatico: lo si ricostruisce a ogni apertura.
  tray.on('right-click', () => refreshMenu());
}

export function refreshMenu(): void {
  if (!tray || !deps) return;
  const state = deps.autoState();
  const label =
    state === 'on' ? mt('tray.autoOn') : state === 'paused' ? mt('tray.autoPaused') : mt('tray.autoOff');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: mt('tray.open'), click: showWindow },
      { type: 'separator' },
      { label, enabled: false },
      ...(state === 'off'
        ? []
        : [
            {
              label: state === 'paused' ? mt('tray.resume') : mt('tray.pause'),
              click: () => {
                deps?.togglePause();
                refreshMenu();
              }
            }
          ]),
      { type: 'separator' },
      {
        label: mt('tray.quit'),
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
}
