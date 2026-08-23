import type { DjSoftware } from './djVersions';

/**
 * Registro UNICO delle sorgenti da cui CrateForge sa importare.
 *
 * ⚠ Perché esiste. L'elenco dei software vive in `djVersions.ts` e risponde a
 * «di quale libreria conosco il formato, e fino a quale versione». Questo file
 * risponde a una domanda diversa: «cosa può scegliere l'utente nel selettore
 * d'import». Non coincidono, e confonderli è il motivo per cui prima esistevano
 * liste duplicate:
 *
 *  - un software può avere PIÙ sorgenti — Rekordbox si legge dal database
 *    desktop, dal collection XML e da una chiavetta, e sono tre strade con
 *    prerequisiti diversi;
 *  - una sorgente può non avere un software nel registro delle versioni — M3U
 *    non è un'applicazione, e djay non ha ancora un marcatore.
 *
 * La regola che questo file impone: **nessuna voce senza `available`**. Una
 * sorgente elencata e non implementata è una promessa che l'interfaccia fa e il
 * programma non mantiene; qui la si dichiara e la si mostra spenta, con il
 * motivo, invece di scoprirlo cliccando.
 *
 * Aggiungere un adapter significa aggiungere UNA riga qui: selettore d'import,
 * griglia delle app e conteggi la leggono da questo elenco.
 */

export type ImportSourceId =
  | 'rekordbox-db'
  | 'rekordbox-xml'
  | 'rekordbox5'
  | 'pioneer-usb'
  | 'serato4'
  | 'serato3'
  | 'traktor'
  | 'virtualdj'
  | 'engine'
  | 'djay'
  | 'itunes'
  | 'm3u';

/** Come si arriva ai dati: decide quale IPC chiamare e cosa chiedere all'utente. */
export type ImportChannel =
  /** database cifrato, letto dal sidecar */
  | 'masterdb'
  /** file XML esportato a mano dall'utente */
  | 'xml'
  /** radice di una chiavetta Pioneer */
  | 'usbRoot'
  /** cartella `_Serato_` */
  | 'seratoDir'
  /** database SQLite trovato dal programma, senza chiedere nulla */
  | 'autoDb'
  /** file singolo scelto dall'utente */
  | 'file';

export interface ImportSource {
  id: ImportSourceId;
  /**
   * Software del registro delle versioni a cui questa sorgente appartiene.
   * `null` quando non è un'applicazione (M3U) o quando manca ancora un
   * marcatore di versione (djay): senza, il gate di scrittura non può
   * pronunciarsi, e la sorgente resta di sola lettura.
   */
  software: DjSoftware | null;
  /** Chiave i18n dell'etichetta, in `onboarding`. */
  labelKey: string;
  channel: ImportChannel;
  /**
   * false quando la voce compare ma non funziona ancora. L'interfaccia la mostra
   * spenta con il motivo: nasconderla del tutto lascerebbe l'utente a chiedersi
   * se ha guardato male.
   */
  available: boolean;
  /** Chiave i18n del motivo, obbligatoria quando `available` è false. */
  unavailableKey?: string;
  /** Opzioni proprie di questa sorgente, mostrate sotto al selettore. */
  options?: ImportOptionId[];
}

/** Opzioni per sorgente. Ognuna ha etichetta e tooltip in i18n. */
export type ImportOptionId =
  /** quali cue importare: hot, memory, o entrambi uniti */
  | 'cueKind'
  /** conservare i cue che cadono sulla stessa posizione */
  | 'duplicateCues'
  /** conservare i percorsi originali invece di riscriverli con quelli locali */
  | 'originalLocations';

/**
 * L'elenco, in ordine di comparsa nel selettore.
 *
 * ⚠ Le VARIANTI DI VERSIONE sono voci separate, non un menu a tendina dentro
 * una voce sola: Rekordbox 5 e 6/7 hanno formati diversi, Serato 3 e 4 sono
 * formati diversi che convivono sulla stessa macchina. Fonderli costringerebbe
 * l'utente a sapere quale ha, che è esattamente ciò che non sa.
 */
export const IMPORT_SOURCES: ImportSource[] = [
  {
    id: 'rekordbox-db',
    software: 'rekordbox',
    labelKey: 'srcRekordboxDb',
    channel: 'masterdb',
    available: true,
    options: ['cueKind', 'duplicateCues', 'originalLocations']
  },
  {
    id: 'rekordbox-xml',
    software: 'rekordbox',
    labelKey: 'srcRekordboxXml',
    channel: 'xml',
    available: true,
    options: ['cueKind', 'duplicateCues', 'originalLocations']
  },
  {
    /* Rekordbox 5 non ha un percorso dedicato: si legge come collection XML
       generico. Resta una voce a sé perché è così che l'utente lo cerca. */
    id: 'rekordbox5',
    software: 'rekordbox',
    labelKey: 'srcRekordbox5',
    channel: 'xml',
    available: true,
    options: ['cueKind', 'duplicateCues']
  },
  {
    id: 'pioneer-usb',
    software: 'rekordbox',
    labelKey: 'srcPioneerUsb',
    channel: 'usbRoot',
    available: true
  },
  {
    id: 'serato4',
    software: 'serato4',
    labelKey: 'srcSerato4',
    channel: 'autoDb',
    available: true
  },
  {
    id: 'serato3',
    software: 'serato',
    labelKey: 'srcSerato3',
    channel: 'seratoDir',
    available: true
  },
  { id: 'traktor', software: 'traktor', labelKey: 'srcTraktor', channel: 'file', available: true },
  {
    id: 'virtualdj',
    software: 'virtualdj',
    labelKey: 'srcVirtualdj',
    channel: 'file',
    available: true
  },
  { id: 'engine', software: 'engine', labelKey: 'srcEngine', channel: 'file', available: true },
  {
    /* Sperimentale: il formato è implementato ma non è mai stato eseguito su una
       libreria djay vera. Resta disponibile — l'utente che ce l'ha è l'unico che
       può dirci se regge — ma l'interfaccia lo dichiara. */
    id: 'djay',
    software: null,
    labelKey: 'srcDjay',
    channel: 'autoDb',
    available: true
  },
  {
    id: 'itunes',
    software: null,
    labelKey: 'srcItunes',
    channel: 'file',
    available: false,
    unavailableKey: 'srcNotYet'
  },
  {
    id: 'm3u',
    software: null,
    labelKey: 'srcM3u',
    channel: 'file',
    available: false,
    unavailableKey: 'srcNotYet'
  }
];

/**
 * Le app della griglia «da quale app DJ stai importando?».
 *
 * È una vista sul registro, non un secondo elenco: raggruppa le sorgenti per
 * applicazione, così l'utente sceglie il programma che usa e non il formato di
 * file, che è un dettaglio che non deve conoscere.
 */
export interface DjApp {
  id: string;
  labelKey: string;
  /** sorgenti che questa app può offrire, in ordine di preferenza */
  sources: ImportSourceId[];
}

export const DJ_APPS: DjApp[] = [
  { id: 'rekordbox', labelKey: 'appRekordbox', sources: ['rekordbox-db', 'rekordbox-xml', 'rekordbox5', 'pioneer-usb'] },
  { id: 'serato', labelKey: 'appSerato', sources: ['serato4', 'serato3'] },
  { id: 'traktor', labelKey: 'appTraktor', sources: ['traktor'] },
  { id: 'virtualdj', labelKey: 'appVirtualdj', sources: ['virtualdj'] },
  { id: 'engine', labelKey: 'appEngine', sources: ['engine'] },
  { id: 'djay', labelKey: 'appDjay', sources: ['djay'] },
  { id: 'itunes', labelKey: 'appItunes', sources: ['itunes'] },
  /* «Nessuna app DJ» non è un ripiego: è il caso di chi ha una cartella di file
     e nient'altro, ed è la ragione per cui esiste il monitoraggio cartella. */
  { id: 'none', labelKey: 'appNone', sources: [] }
];

export function importSource(id: ImportSourceId): ImportSource {
  const s = IMPORT_SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`Sorgente d'import non nel registro: ${id}`);
  return s;
}

/** Sorgenti utilizzabili per un'app, senza quelle non ancora implementate. */
export function availableSourcesFor(app: DjApp): ImportSource[] {
  return app.sources.map(importSource).filter((s) => s.available);
}
