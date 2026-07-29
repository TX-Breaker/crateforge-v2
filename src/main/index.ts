import { app, BrowserWindow, dialog, shell } from 'electron';
import { join } from 'path';
import { openUdm } from '@core/udm';
import { isWriteJobRunning, registerIpc } from './ipc';
import { runPreflight } from './preflight';

/**
 * Processo main di CrateForge.
 * Node è owner dell'UDM: crea il file in userData, applica lo schema e passa
 * il percorso al sidecar Python (via --udm-path) quando serve.
 */

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    // Chrome della finestra (§3.1 del design system): stessa gerarchia, buone
    // maniere native. macOS usa `hiddenInset` (semafori nella striscia di
    // trascinamento); Windows usa il Window Controls Overlay, così i pulsanti
    // restano quelli di sistema — nessun bottone finto, nessun IPC per chiudere.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: { color: '#101215', symbolColor: '#A2A8B0', height: 34 }
        }
      : {}),
    backgroundColor: '#0A0B0D',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Il preload usa solo contextBridge/ipcRenderer: compatibile col sandbox,
      // che riduce l'impatto di un'eventuale compromissione del renderer.
      sandbox: true
    }
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  // Apri all'esterno SOLO http/https: uno schema file:/custom da un renderer
  // compromesso diventerebbe apertura/esecuzione arbitraria lato OS.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(url);
    } catch {
      // URL malformato: ignora
    }
    return { action: 'deny' };
  });
  // Nessuna navigazione fuori dall'app (il renderer carica index.html locale).
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return;
    e.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Istanza singola: due processi sullo stesso udm.sqlite (più il sidecar)
// aumentano il rischio di lock/corruzione.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.whenReady().then(() => {
    const udmPath = join(app.getPath('userData'), 'udm.sqlite');
    let db;
    try {
      db = openUdm(udmPath);
    } catch (err) {
      // UDM corrotto/lockato o migrazione fallita: messaggio chiaro, non finestra muta.
      dialog.showErrorBox(
        'CrateForge non può avviarsi',
        `Il database interno non è apribile:\n${String(err)}\n\nPercorso: ${udmPath}`
      );
      app.quit();
      return;
    }
    const disposeIpc = registerIpc(db, udmPath);
    createWindow();

    // Preflight all'avvio, non bloccante: verifica che il sidecar sia
    // eseguibile e che la chiave di lettura del master.db sia pronta (la
    // scarica se manca). Così su un computer appena installato tutto funziona
    // senza passaggi manuali. L'esito viene inviato al renderer quando pronto
    // (che comunque lo rilegge con preflight:get al mount).
    runPreflight(db, udmPath, (state) =>
      BrowserWindow.getAllWindows()[0]?.webContents.send('preflight:update', state)
    )
      .then((state) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('preflight:update', state);
      })
      .catch((err) => {
        console.error('Preflight fallito:', err);
      });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    /* Chiudere la finestra mentre il sidecar sta scrivendo dentro un file
       audio o dentro il master.db equivale a premere Annulla: il processo
       viene terminato a forza e il ripristino, che vive in un blocco `except`
       del sidecar, non viene mai eseguito. Qui la chiusura viene rimandata e
       all'utente viene detto perché — non è un'attesa muta. */
    let quitting = false;
    app.on('before-quit', (event) => {
      if (!quitting && isWriteJobRunning()) {
        event.preventDefault();
        const win = BrowserWindow.getAllWindows()[0];
        const opts = {
          type: 'warning' as const,
          buttons: ['Aspetta'],
          defaultId: 0,
          title: 'Scrittura in corso',
          message:
            'CrateForge sta scrivendo dentro i tuoi file e non può essere chiuso adesso: ' +
            "interrompere a metà lascerebbe un file scritto solo in parte, e il ripristino " +
            'automatico non farebbe in tempo a partire. La chiusura avverrà appena la ' +
            'scrittura è finita.'
        };
        void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
        // Riprova appena il job finisce: nessun intervento richiesto all'utente.
        const timer = setInterval(() => {
          if (!isWriteJobRunning()) {
            clearInterval(timer);
            quitting = true;
            app.quit();
          }
        }, 500);
        return;
      }
      try {
        disposeIpc?.();
      } catch {
        /* best-effort */
      }
      try {
        db.close();
      } catch {
        /* best-effort */
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
