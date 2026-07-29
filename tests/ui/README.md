# Test della UI

Quattro controlli che il compilatore e Vitest non possono fare, perché riguardano
l'app in esecuzione.

| Comando | Cosa verifica |
|---|---|
| `npm run test:ipc` | ogni `ipcRenderer.invoke` del preload ha il suo `ipcMain.handle` nel main, e ogni evento ascoltato viene davvero emesso |
| `npm run test:ui` | giro completo di tutte le destinazioni e tab sul bundle reale: niente pagine bianche, niente chiavi i18n grezze, niente `undefined`/`NaN`, nomi accessibili su tutti i controlli, quattro palette distinte, densità, reduced-motion, palette comandi, scorciatoie, notifiche, rientro da Esperto a Semplice |
| `npm run test:flows` | primo avvio (cinque passi, card di rilevamento nei tre stati, import → diagnosi) e barra job → toast → centro notifiche, con un job che emette progresso vero |
| `node tests/ui/drive-real.mjs` | pilota l'app **reale** via CDP: richiede `electron . --remote-debugging-port=9222` già avviato. Controlla che i canali IPC rispondano davvero, cosa rileva il rilevamento sui percorsi di questa macchina, e che il gate `directWrites` resti rifiutato dal canale settings generico |

`test:ui` e `test:flows` girano contro `out/renderer`, quindi va fatto prima
`npm run build`. Usano un bridge IPC finto (`preload.cjs`, `preload-job.cjs`): non
toccano il database né i file su disco.

I due harness escono con codice 1 se trovano qualcosa, così si possono mettere in CI.
