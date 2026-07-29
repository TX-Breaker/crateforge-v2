/**
 * Variante del bridge finto con un job "vivo": il dialog restituisce un percorso,
 * l'import dura qualche secondo ed emette progresso reale. Serve a vedere la barra
 * job con fase, percentuale ed ETA, il toast di esito e la voce nel centro notifiche.
 */
process.env.CF_NO_EXPOSE = '1';
const { contextBridge } = require('electron');
const { api } = require('./preload.cjs');

const listeners = new Set();

api.jobs = {
  cancel: async () => {},
  onProgress: (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }
};

api.dialog = {
  ...api.dialog,
  openFile: async () => 'D:/Music/Rekordbox/collection.xml'
};

api.library = {
  ...api.library,
  ingestXml: async () => {
    const total = 12481;
    let done = 0;
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        done = Math.min(total, done + 900);
        for (const cb of listeners) cb({ jobId: 'j1', phase: 'ingest-xml', done, total });
        if (done >= total) {
          clearInterval(timer);
          resolve();
        }
      }, 220);
    });
    return { tracks: 12481, playlists: 184, cues: 41203 };
  }
};

contextBridge.exposeInMainWorld('crateforge', api);
