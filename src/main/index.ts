import { app, BrowserWindow, dialog, shell } from 'electron';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { openUdm } from '@core/udm';
import { isWriteJobRunning, registerIpc } from './ipc';
import { runPreflight } from './preflight';

/**
 * Registro di avvio su FILE.
 *
 * Un'applicazione che non si apre non ha modo di dire perché: la finestra è
 * l'unico canale verso l'utente, e se manca quella manca tutto. Questo file è
 * l'unica cosa che resta in mano a chi assiste — vive in
 * userData/logs/main.log e non viene mai mostrato all'utente.
 */
function logMain(line: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'main.log'), `${new Date().toISOString()} ${line}\n`, 'utf-8');
  } catch {
    /* se non si può scrivere il log, non è il log a dover far cadere l'app */
  }
}

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

  /* `show: false` evita il lampo bianco all'avvio, ma lega la comparsa della
     finestra a un evento del renderer: se quello non arriva — bundle rotto,
     errore prima del primo disegno, processo di rendering morto — la finestra
     resta nascosta per sempre e l'applicazione sembra non partita, pur essendo
     viva nel gestore attività. Dopo 5 secondi la mostriamo lo stesso: meglio
     una finestra vuota con un messaggio che nessuna finestra. */
  let shown = false;
  const reveal = (why: string) => {
    if (shown || !mainWindow) return;
    shown = true;
    mainWindow.show();
    if (why !== 'ready-to-show') logMain(`finestra mostrata per ripiego (${why})`);
  };
  mainWindow.on('ready-to-show', () => reveal('ready-to-show'));
  const revealTimer = setTimeout(() => reveal('timeout di 5s'), 5000);
  mainWindow.on('closed', () => clearTimeout(revealTimer));

  // Errori del renderer: registrati e, se la finestra non si è mai vista,
  // mostrati come dialogo — altrimenti non li leggerebbe nessuno.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logMain(`caricamento fallito (${code} ${desc}) su ${url}`);
    reveal('caricamento fallito');
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logMain(`processo di rendering terminato: ${details.reason} (exitCode ${details.exitCode})`);
    if (!shown) {
      dialog.showErrorBox(
        'CrateForge non è riuscito ad aprirsi',
        `L'interfaccia si è chiusa durante l'avvio (${details.reason}).\n\n` +
          `Dettagli in: ${join(app.getPath('userData'), 'logs', 'main.log')}`
      );
    }
  });
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
  /* Un'altra istanza è già viva: questa esce. È corretto — due processi sullo
     stesso database aumentano il rischio di lock — ma va detto, perché il
     sintomo che l'utente vede è "ho aperto il programma e non si apre niente",
     e senza una riga non c'è modo di distinguerlo da un avvio fallito. */
  logMain('istanza già in esecuzione: questa esce e passa il comando a quella');
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      if (!w.isVisible()) w.show();
      w.focus();
      return;
    }
    /* Prima istanza viva ma senza finestra (chiusa, o mai comparsa): invece di
       non fare nulla — che dall'esterno è indistinguibile da un programma
       morto — se ne apre una nuova. È il caso che lasciava l'utente a
       cliccare l'icona senza risultato. */
    logMain('seconda esecuzione senza finestra nella prima: ne apro una nuova');
    createWindow();
  });

  app.whenReady().then(() => {
    logMain(`avvio — versione ${app.getVersion()}, impacchettata=${app.isPackaged}`);
    const udmPath = join(app.getPath('userData'), 'udm.sqlite');
    let db;
    try {
      db = openUdm(udmPath);
    } catch (err) {
      // UDM corrotto/lockato o migrazione fallita: messaggio chiaro, non finestra muta.
      logMain(`UDM non apribile: ${String(err)}`);
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
