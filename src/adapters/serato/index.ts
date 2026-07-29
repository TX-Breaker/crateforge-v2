/**
 * Serato: scrittura diretta NON disponibile in Fase 1 (§6.4).
 * Lo schema dei crate/database Serato varia per versione e una scrittura
 * ingenua rischia di corrompere la libreria. Arriverà in Fase 2/3 con
 * librerie dedicate, lavorando SOLO su copie e con rollback verificato.
 */
export const SERATO_STATUS = {
  available: false,
  reason:
    'Export diretto verso Serato in arrivo in una versione futura. ' +
    'Per ora usa l\'export Rekordbox XML o il report Excel.'
} as const;
