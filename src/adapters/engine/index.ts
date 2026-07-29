/**
 * Engine DJ: scrittura diretta NON disponibile in Fase 1 (§6.4).
 * Il database Engine (SQLite) cambia schema tra versioni: scrivere
 * direttamente è rischio corruzione. Arriverà in una fase successiva,
 * con safeguard e lavoro esclusivamente su copie.
 */
export const ENGINE_STATUS = {
  available: false,
  reason:
    'Export diretto verso Engine DJ in arrivo in una versione futura. ' +
    'Per ora usa l\'export Rekordbox XML o Traktor NML.'
} as const;
