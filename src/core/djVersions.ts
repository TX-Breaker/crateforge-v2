/**
 * Registro delle versioni COLLAUDATE dei software DJ, e regola di ammissione.
 *
 * Perché esiste: i formati di libreria non sono documentati da nessuno. Tutto
 * ciò che CrateForge sa leggere e scrivere è stato ricavato guardando i byte di
 * file veri, con una versione precisa di quel software davanti. Quando esce una
 * versione nuova, quel sapere può diventare falso da un giorno all'altro: un
 * campo in più nel blob dei cue, una tabella con una colonna diversa, un
 * contatore che cambia significato. Scrivere in quel caso non produce un errore
 * — produce una libreria dell'utente danneggiata, e se ne accorge sul palco.
 *
 * Quindi: la scrittura è permessa solo verso versioni che l'autore ha
 * effettivamente collaudato. Una versione più recente non è "probabilmente
 * compatibile": è NON COLLAUDATA, e il software lo dice e si ferma.
 *
 * Il registro è codice, non configurazione dell'utente: si aggiorna quando
 * l'autore prova la versione nuova e pubblica un aggiornamento. Chi vuole
 * procedere lo stesso deve sbloccare esplicitamente quella singola versione di
 * quel singolo software (vedi `versions:acknowledge`), e resta scritto nel
 * registro operazioni.
 */

export type DjSoftware =
  | 'rekordbox'
  | 'traktor'
  | 'virtualdj'
  /** Serato DJ Pro <= 3: cartella `_Serato_`, file binari TLV. */
  | 'serato'
  /** Serato DJ Pro 4: database SQLite a grafo. Formato DIVERSO, non una variante. */
  | 'serato4'
  | 'engine';

export interface TestedEntry {
  /** Nome leggibile del software. */
  label: string;
  /** Che cosa misuriamo davvero: non la versione dell'app, ma il FORMATO. */
  marker: string;
  /** Ultimo valore del marcatore collaudato dall'autore. */
  maxTested: string;
  /** Versione dell'applicazione con cui il collaudo è stato fatto. */
  testedWithApp: string | null;
  /** Data del collaudo, per sapere quanto è vecchia questa certezza. */
  testedOn: string;
  /** Come lo sappiamo: libreria reale sulla macchina dell'autore, o file di prova. */
  evidence: string;
}

/**
 * Versioni collaudate. Ogni riga è una promessa: "su questo, i byte li ho
 * guardati io". Non aggiungere una riga senza aver aperto il file vero.
 */
export const TESTED: Record<DjSoftware, TestedEntry> = {
  rekordbox: {
    label: 'Rekordbox',
    marker: 'collection XML (DJ_PLAYLISTS@Version)',
    maxTested: '1.0.0',
    testedWithApp: '7.2.16',
    testedOn: '2026-07-29',
    evidence: 'master.db e collection XML della libreria reale su Windows, Rekordbox 7.2.16'
  },
  engine: {
    label: 'Engine DJ',
    marker: 'schema del database (Information.schemaVersion)',
    maxTested: '3.0.2',
    testedWithApp: '5.0.0',
    testedOn: '2026-07-29',
    evidence:
      'Engine Library reale (114 tracce): round-trip byte-identico dei blob PerformanceData e libreria generata aperta in Engine DJ 5.0'
  },
  serato: {
    label: 'Serato DJ Pro',
    marker: 'versione del database ("database V2", campo vrsn)',
    maxTested: '2.0',
    testedWithApp: '4.0.9',
    testedOn: '2026-07-29',
    evidence: 'cartella _Serato_ reale, vrsn "2.0/Serato Scratch LIVE Database" + tag GEOB su file veri'
  },
  serato4: {
    label: 'Serato DJ Pro 4',
    marker: 'versione dello schema (PRAGMA user_version di master.sqlite)',
    maxTested: '202',
    testedWithApp: null,
    testedOn: '2026-08-23',
    evidence:
      'master.sqlite reale (114 asset, 3 contenitori): 50 tabelle, catena container -> ' +
      "space_asset -> asset verificata, user_version 202 letta dall'intestazione del file"
  },
  traktor: {
    label: 'Traktor',
    marker: 'versione del NML (NML@VERSION)',
    maxTested: '20',
    testedWithApp: null,
    testedOn: '2026-07-29',
    evidence:
      'file collection.nml di riferimento (NML 20); nessuna installazione di Traktor sulla macchina di collaudo'
  },
  virtualdj: {
    label: 'VirtualDJ',
    marker: 'versione del database.xml (VirtualDJ_Database@Version)',
    maxTested: '2024',
    testedWithApp: '8.5',
    testedOn: '2026-07-29',
    evidence:
      'database.xml di riferimento; sulla macchina di collaudo VirtualDJ 8.5 non aveva ancora generato un database'
  }
};

export type VersionStatus =
  /** collaudato: si può fare tutto */
  | 'ok'
  /** più recente di quanto collaudato: lettura sì, scrittura no */
  | 'newer'
  /** marcatore assente o illeggibile: non sappiamo con cosa abbiamo a che fare */
  | 'unknown'
  /** sbloccato a mano per questa esatta versione */
  | 'acknowledged';

export interface VersionVerdict {
  software: DjSoftware;
  status: VersionStatus;
  /** Valore letto dal file dell'utente, se c'era. */
  detected: string | null;
  maxTested: string;
  /** Frase pronta da mostrare: dice cosa succede e cosa può fare l'utente. */
  message: string;
  /** true quando l'operazione di SCRITTURA va rifiutata. */
  blocksWrite: boolean;
  /** true quando anche la LETTURA va rifiutata (solo in modalità severa). */
  blocksRead: boolean;
}

/**
 * Confronto per segmenti numerici: "3.0.10" > "3.0.9", "2024" > "19".
 * I segmenti non numerici (build, suffissi) vengono ignorati: contano solo i
 * numeri, perché è lì che i formati cambiano.
 */
export function compareVersions(a: string, b: string): number {
  const seg = (v: string) =>
    (v.match(/\d+/g) ?? []).map((n) => Number(n));
  const x = seg(a);
  const y = seg(b);
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Estrae la parte numerica utile da un marcatore grezzo. Serve perché i
 * marcatori reali non sono numeri puliti: Serato scrive
 * "2.0/Serato Scratch LIVE Database", Engine dà tre interi separati.
 */
export function normalizeMarker(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/\d+(?:\.\d+)*/);
  return m ? m[0] : null;
}

export interface EvaluateOptions {
  /** Versione sbloccata a mano dall'utente per questo software, se c'è. */
  acknowledged?: string | null;
  /** 'standard': blocca solo le scritture. 'strict': blocca anche le letture. */
  gate?: 'standard' | 'strict';
}

/**
 * Regola di ammissione. Il criterio non è "funzionerà?" ma "l'ho verificato?":
 * il primo è una previsione, il secondo è un fatto.
 */
export function evaluateVersion(
  software: DjSoftware,
  detectedRaw: string | null,
  opts: EvaluateOptions = {}
): VersionVerdict {
  const entry = TESTED[software];
  const gate = opts.gate ?? 'standard';
  const detected = normalizeMarker(detectedRaw);
  const base = { software, detected: detectedRaw, maxTested: entry.maxTested };

  if (!detected) {
    return {
      ...base,
      status: 'unknown',
      message:
        `Non è stato possibile leggere la versione di ${entry.label} (${entry.marker}). ` +
        `CrateForge ha collaudato fino alla ${entry.maxTested}: senza quel dato non può ` +
        `garantire che la scrittura sia sicura, quindi si ferma prima di toccare i tuoi file.`,
      blocksWrite: true,
      blocksRead: gate === 'strict'
    };
  }

  if (compareVersions(detected, entry.maxTested) <= 0) {
    return {
      ...base,
      status: 'ok',
      message: `${entry.label}: versione ${detected}, collaudata.`,
      blocksWrite: false,
      blocksRead: false
    };
  }

  if (opts.acknowledged && compareVersions(detected, opts.acknowledged) <= 0) {
    return {
      ...base,
      status: 'acknowledged',
      message:
        `${entry.label} ${detected} è più recente dell'ultima versione collaudata ` +
        `(${entry.maxTested}), ma è stata sbloccata a mano: procedi sapendo che questo ` +
        `formato non è stato verificato dall'autore.`,
      blocksWrite: false,
      blocksRead: false
    };
  }

  return {
    ...base,
    status: 'newer',
    message:
      `${entry.label} ${detected} è più recente dell'ultima versione collaudata ` +
      `(${entry.maxTested}, provata il ${entry.testedOn} con ${entry.testedWithApp ?? 'un file di riferimento'}). ` +
      `I formati di libreria non sono documentati: quello che CrateForge sa scrivere è stato ` +
      `ricavato guardando i byte di quella versione. Su una più recente la scrittura non ` +
      `fallirebbe con un errore, danneggerebbe la libreria in silenzio. La lettura resta ` +
      `possibile; la scrittura no, finché l'autore non avrà collaudato questa versione.`,
    blocksWrite: true,
    blocksRead: gate === 'strict'
  };
}

/** Chiave dell'impostazione che registra uno sblocco manuale. */
export function acknowledgeKey(software: DjSoftware): string {
  return `versionAck.${software}`;
}

/** Chiave dello sblocco per la VERSIONE DELL'APPLICAZIONE (non del formato). */
export function appAcknowledgeKey(software: DjSoftware): string {
  return `versionAckApp.${software}`;
}

/**
 * Variante per i casi in cui il formato non è ispezionabile e l'unico dato
 * disponibile è la versione dell'APPLICAZIONE installata. È il caso del
 * `master.db` di Rekordbox: è cifrato, lo schema non si legge da fuori, e
 * l'unica cosa che sappiamo è quale rekordbox c'è su questa macchina.
 *
 * Vale solo per le scritture DIRETTE dentro il database dell'utente, dove un
 * cambio di schema è esattamente ciò che rovina la libreria.
 */
export function evaluateAppVersion(
  software: DjSoftware,
  detectedApp: string | null,
  opts: EvaluateOptions = {}
): VersionVerdict {
  const entry = TESTED[software];
  const tested = entry.testedWithApp;
  const detected = normalizeMarker(detectedApp);
  const base = { software, detected: detectedApp, maxTested: tested ?? '—' };

  if (!tested) {
    return {
      ...base,
      status: 'unknown',
      message: `Nessuna versione di ${entry.label} è stata collaudata per la scrittura diretta.`,
      blocksWrite: true,
      blocksRead: false
    };
  }
  if (!detected) {
    return {
      ...base,
      status: 'unknown',
      message:
        `Non è stato possibile determinare quale versione di ${entry.label} è installata. ` +
        `La scrittura diretta nel suo database è permessa solo fino alla ${tested}, ` +
        `che è quella collaudata: senza sapere cosa c'è davanti, CrateForge non scrive.`,
      blocksWrite: true,
      blocksRead: false
    };
  }
  if (compareVersions(detected, tested) <= 0) {
    return {
      ...base,
      status: 'ok',
      message: `${entry.label} ${detected}: collaudato per la scrittura diretta.`,
      blocksWrite: false,
      blocksRead: false
    };
  }
  if (opts.acknowledged && compareVersions(detected, opts.acknowledged) <= 0) {
    return {
      ...base,
      status: 'acknowledged',
      message: `${entry.label} ${detected}: sbloccato a mano, formato non verificato dall'autore.`,
      blocksWrite: false,
      blocksRead: false
    };
  }
  return {
    ...base,
    status: 'newer',
    message:
      `${entry.label} ${detected} è più recente della versione collaudata (${tested}). ` +
      `Il database di ${entry.label} è cifrato e il suo schema cambia tra le versioni: ` +
      `scriverci dentro senza aver verificato il formato è il modo più diretto per ` +
      `perdere una libreria. L'operazione è stata annullata; la lettura continua a funzionare.`,
    blocksWrite: true,
    blocksRead: false
  };
}
