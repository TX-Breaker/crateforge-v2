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

/**
 * Software che la guardia sui processi sa riconoscere.
 *
 * È `DjSoftware` più djay, e la differenza non è una svista. `DjSoftware` è
 * l'elenco dei software verso cui CrateForge SCRIVE, e ogni voce lì dentro
 * porta con sé un marcatore di versione collaudato (vedi `TESTED`): è il gate
 * delle scritture. Di djay oggi esiste solo il lettore, quindi non ha nulla da
 * presidiare e non appartiene a quell'elenco.
 *
 * Ma leggere un database SQLite mentre l'applicazione lo tiene aperto in
 * modalità WAL può restituire uno stato a metà, quindi la guardia serve anche
 * alla sola lettura. Da qui il tipo separato: più largo dove il rischio è più
 * largo, senza promettere una scrittura che non esiste.
 *
 * Sta qui e non in `main/processGuard` perché è solo un tipo, e il nucleo non
 * può dipendere dal processo principale.
 */
export type GuardedSoftware = DjSoftware | 'djay';

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
  /** Lingua del messaggio. Il verdetto è lo stesso in ogni lingua. */
  locale?: VerdictLocale;
}

export type VerdictLocale = 'it' | 'en' | 'fr' | 'de';

/**
 * I messaggi dei verdetti, in quattro lingue: sono quelli che l'utente legge
 * quando una scrittura viene fermata, ed è il momento in cui deve capire.
 */
const VERDICT_TEXT = {
  unreadable: {
    it: 'Non è stato possibile leggere la versione di {app} ({marker}). CrateForge ha collaudato fino alla {tested}: senza quel dato non può garantire che la scrittura sia sicura, quindi si ferma prima di toccare i tuoi file.',
    en: 'Could not read the {app} version ({marker}). CrateForge has tested up to {tested}: without that information it cannot guarantee a safe write, so it stops before touching your files.',
    fr: 'Impossible de lire la version de {app} ({marker}). CrateForge a testé jusqu’à la {tested} : sans cette donnée, il ne peut pas garantir une écriture sûre et s’arrête avant de toucher vos fichiers.',
    de: 'Die Version von {app} ({marker}) ließ sich nicht lesen. CrateForge ist bis {tested} getestet: Ohne diese Angabe ist ein sicheres Schreiben nicht garantiert, daher stoppt es, bevor deine Dateien berührt werden.'
  },
  ok: {
    it: '{app}: versione {detected}, collaudata.',
    en: '{app}: version {detected}, tested.',
    fr: '{app} : version {detected}, testée.',
    de: '{app}: Version {detected}, getestet.'
  },
  acknowledged: {
    it: '{app} {detected} è più recente dell’ultima versione collaudata ({tested}), ma è stata sbloccata a mano: procedi sapendo che questo formato non è stato verificato dall’autore.',
    en: '{app} {detected} is newer than the last tested version ({tested}), but it was unlocked by hand: proceed knowing this format has not been verified by the author.',
    fr: '{app} {detected} est plus récente que la dernière version testée ({tested}), mais elle a été débloquée à la main : sachez que ce format n’a pas été vérifié par l’auteur.',
    de: '{app} {detected} ist neuer als die zuletzt getestete Version ({tested}), wurde aber manuell freigegeben: Dieses Format wurde vom Autor nicht geprüft.'
  },
  newer: {
    it: '{app} {detected} è più recente dell’ultima versione collaudata ({tested}, provata il {testedOn} con {testedWith}). I formati di libreria non sono documentati: quello che CrateForge sa scrivere è stato ricavato guardando i byte di quella versione. Su una più recente la scrittura non fallirebbe con un errore, danneggerebbe la libreria in silenzio. La lettura resta possibile; la scrittura no, finché l’autore non avrà collaudato questa versione.',
    en: '{app} {detected} is newer than the last tested version ({tested}, tested on {testedOn} with {testedWith}). Library formats are undocumented: what CrateForge can write was worked out from the bytes of that version. On a newer one, writing would not fail with an error, it would silently damage the library. Reading still works; writing does not, until the author has tested this version.',
    fr: '{app} {detected} est plus récente que la dernière version testée ({tested}, testée le {testedOn} avec {testedWith}). Les formats de bibliothèque ne sont pas documentés : ce que CrateForge sait écrire vient de l’étude des octets de cette version. Sur une plus récente, l’écriture n’échouerait pas avec une erreur, elle abîmerait la bibliothèque sans rien dire. La lecture reste possible ; l’écriture non, tant que l’auteur n’a pas testé cette version.',
    de: '{app} {detected} ist neuer als die zuletzt getestete Version ({tested}, getestet am {testedOn} mit {testedWith}). Bibliotheksformate sind nicht dokumentiert: Was CrateForge schreiben kann, wurde aus den Bytes dieser Version abgeleitet. Bei einer neueren würde das Schreiben nicht mit einem Fehler abbrechen, sondern die Bibliothek still beschädigen. Lesen bleibt möglich; Schreiben nicht, bis der Autor diese Version getestet hat.'
  },
  refFile: { it: 'un file di riferimento', en: 'a reference file', fr: 'un fichier de référence', de: 'einer Referenzdatei' },
  appNone: {
    it: 'Nessuna versione di {app} è stata collaudata per la scrittura diretta.',
    en: 'No version of {app} has been tested for direct writing.',
    fr: 'Aucune version de {app} n’a été testée pour l’écriture directe.',
    de: 'Keine Version von {app} wurde für direktes Schreiben getestet.'
  },
  appUnknown: {
    it: 'Non è stato possibile determinare quale versione di {app} è installata. La scrittura diretta nel suo database è permessa solo fino alla {tested}, che è quella collaudata: senza sapere cosa c’è davanti, CrateForge non scrive.',
    en: 'Could not determine which version of {app} is installed. Direct writing into its database is allowed only up to {tested}, the tested one: without knowing what is there, CrateForge does not write.',
    fr: 'Impossible de déterminer quelle version de {app} est installée. L’écriture directe dans sa base n’est permise que jusqu’à la {tested}, celle testée : sans savoir ce qu’il y a, CrateForge n’écrit pas.',
    de: 'Es ließ sich nicht feststellen, welche Version von {app} installiert ist. Direktes Schreiben in die Datenbank ist nur bis {tested} erlaubt, der getesteten: Ohne zu wissen, was vorliegt, schreibt CrateForge nicht.'
  },
  appOk: {
    it: '{app} {detected}: collaudato per la scrittura diretta.',
    en: '{app} {detected}: tested for direct writing.',
    fr: '{app} {detected} : testé pour l’écriture directe.',
    de: '{app} {detected}: für direktes Schreiben getestet.'
  },
  appAcknowledged: {
    it: '{app} {detected}: sbloccato a mano, formato non verificato dall’autore.',
    en: '{app} {detected}: unlocked by hand, format not verified by the author.',
    fr: '{app} {detected} : débloqué à la main, format non vérifié par l’auteur.',
    de: '{app} {detected}: manuell freigegeben, Format vom Autor nicht geprüft.'
  },
  appNewer: {
    it: '{app} {detected} è più recente della versione collaudata ({tested}). Il database di {app} è cifrato e il suo schema cambia tra le versioni: scriverci dentro senza aver verificato il formato è il modo più diretto per perdere una libreria. L’operazione è stata annullata; la lettura continua a funzionare.',
    en: '{app} {detected} is newer than the tested version ({tested}). The {app} database is encrypted and its schema changes between versions: writing into it without checking the format is the quickest way to lose a library. The operation was cancelled; reading still works.',
    fr: '{app} {detected} est plus récente que la version testée ({tested}). La base de {app} est chiffrée et son schéma change entre les versions : y écrire sans avoir vérifié le format est le moyen le plus sûr de perdre une bibliothèque. L’opération a été annulée ; la lecture fonctionne toujours.',
    de: '{app} {detected} ist neuer als die getestete Version ({tested}). Die Datenbank von {app} ist verschlüsselt und ihr Schema ändert sich zwischen Versionen: Ohne geprüftes Format hineinzuschreiben ist der schnellste Weg, eine Bibliothek zu verlieren. Der Vorgang wurde abgebrochen; Lesen funktioniert weiterhin.'
  }
} satisfies Record<string, Record<VerdictLocale, string>>;

/** Il messaggio di un verdetto nella lingua chiesta, con i segnaposto sostituiti. */
export function verdictText(
  key: keyof typeof VERDICT_TEXT,
  locale: VerdictLocale | undefined,
  params: Record<string, string> = {}
): string {
  return VERDICT_TEXT[key][locale ?? 'it'].replace(/\{(\w+)\}/g, (m, k: string) => params[k] ?? m);
}

/** Tutte le voci, per il test di parità. */
export const VERDICT_TEXTS: Record<string, Record<VerdictLocale, string>> = VERDICT_TEXT;

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
      message: verdictText('unreadable', opts.locale, {
        app: entry.label,
        marker: entry.marker,
        tested: entry.maxTested
      }),
      blocksWrite: true,
      blocksRead: gate === 'strict'
    };
  }

  if (compareVersions(detected, entry.maxTested) <= 0) {
    return {
      ...base,
      status: 'ok',
      message: verdictText('ok', opts.locale, { app: entry.label, detected }),
      blocksWrite: false,
      blocksRead: false
    };
  }

  if (opts.acknowledged && compareVersions(detected, opts.acknowledged) <= 0) {
    return {
      ...base,
      status: 'acknowledged',
      message: verdictText('acknowledged', opts.locale, { app: entry.label, detected, tested: entry.maxTested }),
      blocksWrite: false,
      blocksRead: false
    };
  }

  return {
    ...base,
    status: 'newer',
    message: verdictText('newer', opts.locale, {
      app: entry.label,
      detected,
      tested: entry.maxTested,
      testedOn: entry.testedOn,
      testedWith: entry.testedWithApp ?? verdictText('refFile', opts.locale)
    }),
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
      message: verdictText('appNone', opts.locale, { app: entry.label }),
      blocksWrite: true,
      blocksRead: false
    };
  }
  if (!detected) {
    return {
      ...base,
      status: 'unknown',
      message: verdictText('appUnknown', opts.locale, { app: entry.label, tested }),
      blocksWrite: true,
      blocksRead: false
    };
  }
  if (compareVersions(detected, tested) <= 0) {
    return {
      ...base,
      status: 'ok',
      message: verdictText('appOk', opts.locale, { app: entry.label, detected }),
      blocksWrite: false,
      blocksRead: false
    };
  }
  if (opts.acknowledged && compareVersions(detected, opts.acknowledged) <= 0) {
    return {
      ...base,
      status: 'acknowledged',
      message: verdictText('appAcknowledged', opts.locale, { app: entry.label, detected }),
      blocksWrite: false,
      blocksRead: false
    };
  }
  return {
    ...base,
    status: 'newer',
    message: verdictText('appNewer', opts.locale, { app: entry.label, detected, tested }),
    blocksWrite: true,
    blocksRead: false
  };
}
