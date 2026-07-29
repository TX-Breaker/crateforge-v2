/**
 * Serato: stato del canale.
 *
 * La scrittura ESISTE dalla versione 2 e passa dal gate delle scritture dirette,
 * perché i cue di Serato vivono dentro i file audio: si riscrivono i tag dei
 * brani, con backup verificato e ripristino automatico. Le playlist diventano
 * crate, e un crate già esistente non viene mai sovrascritto — quel formato non
 * ha ancora un round-trip verificato contro un file scritto da Serato.
 */
export const SERATO_STATUS = {
  available: true,
  reason:
    'Export verso Serato: cue e loop vengono scritti nei tag dei file audio (serve il gate ' +
    'delle scritture dirette; backup verificato e ripristino automatico). Le playlist ' +
    'diventano crate, e i crate esistenti non vengono mai sovrascritti.'
} as const;
