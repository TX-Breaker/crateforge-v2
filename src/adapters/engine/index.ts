/**
 * Engine DJ: stato del canale.
 *
 * La scrittura ESISTE dalla versione 2 e non tocca la libreria dell'utente: ne
 * genera una nuova nella cartella scelta, copiando lo schema da un m.db
 * indicato da lui. Restano fuori, dichiarati, forma d'onda e griglia dei beat:
 * si sanno leggere ma non ricreare byte per byte, ed Engine le rigenera alla
 * prima analisi.
 */
export const ENGINE_STATUS = {
  available: true,
  reason:
    'Export verso Engine DJ: viene generata una libreria NUOVA nella cartella scelta, ' +
    "la tua non viene toccata. Forma d'onda e griglia le ricalcola Engine alla prima analisi."
} as const;
