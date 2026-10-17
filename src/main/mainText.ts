/**
 * Testi che nascono nel processo principale: finestre di sistema, errori delle
 * guardie, motivi per cui un programma resta fuori da una sincronizzazione.
 *
 * L'interfaccia ha il suo dizionario (`renderer/src/lib/strings.ts`); questi
 * testi però non passano da lì — una finestra di conferma nativa la disegna il
 * sistema operativo, un errore arriva già scritto. Senza questo modulo
 * comparivano in italiano a chi aveva scelto un'altra lingua, proprio nei
 * momenti in cui conta capire che cosa si sta per autorizzare.
 *
 * La lingua è quella scelta nelle impostazioni (`locale`), letta a ogni uso:
 * cambiarla nell'interfaccia vale subito anche qui.
 */

export type MainLocale = 'it' | 'en' | 'fr' | 'de';
type Entry = Record<MainLocale, string>;

const T = {
  'btn.cancel': { it: 'Annulla', en: 'Cancel', fr: 'Annuler', de: 'Abbrechen' },
  'btn.enable': { it: 'Attiva', en: 'Turn on', fr: 'Activer', de: 'Aktivieren' },
  'btn.unlock': { it: 'Sblocca', en: 'Unlock', fr: 'Débloquer', de: 'Freigeben' },
  'btn.wait': { it: 'Aspetta', en: 'Wait', fr: 'Attendre', de: 'Warten' },

  'gate.title': {
    it: 'Conferma attivazione',
    en: 'Confirm',
    fr: 'Confirmer l’activation',
    de: 'Aktivierung bestätigen'
  },
  'gate.masterdb': {
    it: 'Attivare la scrittura DIRETTA nel database di Rekordbox? Chiudi Rekordbox prima di usarla.',
    en: 'Turn on DIRECT writing into the Rekordbox database? Close Rekordbox before using it.',
    fr: 'Activer l’écriture DIRECTE dans la base Rekordbox ? Fermez Rekordbox avant de l’utiliser.',
    de: 'DIREKTES Schreiben in die Rekordbox-Datenbank aktivieren? Schließe Rekordbox vor der Nutzung.'
  },
  'gate.direct': {
    it: 'Attivare le scritture dirette sui file originali (tag, hot cue Serato, eliminazione di file, librerie degli altri programmi)?',
    en: 'Turn on direct writes to your original files (tags, Serato hot cues, deleting files, other programs’ libraries)?',
    fr: 'Activer les écritures directes sur les fichiers originaux (tags, hot cues Serato, suppression de fichiers, bibliothèques des autres logiciels) ?',
    de: 'Direkte Schreibzugriffe auf die Originaldateien aktivieren (Tags, Serato-Hot-Cues, Löschen von Dateien, Bibliotheken anderer Programme)?'
  },

  'version.title': {
    it: 'Versione non collaudata',
    en: 'Untested version',
    fr: 'Version non testée',
    de: 'Ungetestete Version'
  },
  'version.message': {
    it: 'Sbloccare la scrittura verso {app} {version}?\n\nL’ultima versione collaudata è la {tested}. Il formato di questa versione non è stato verificato: se è cambiato, la scrittura può danneggiare la libreria senza segnalare nulla. Sbloccalo solo se hai provato tu stesso che i dati tornano indietro identici.',
    en: 'Unlock writing to {app} {version}?\n\nThe last tested version is {tested}. This version’s format has not been verified: if it changed, writing can damage the library without any warning. Unlock it only if you have checked yourself that data comes back identical.',
    fr: 'Débloquer l’écriture vers {app} {version} ?\n\nLa dernière version testée est la {tested}. Le format de cette version n’a pas été vérifié : s’il a changé, l’écriture peut abîmer la bibliothèque sans rien signaler. Ne la débloquez que si vous avez vérifié vous-même que les données reviennent identiques.',
    de: 'Schreiben nach {app} {version} freigeben?\n\nDie zuletzt getestete Version ist {tested}. Das Format dieser Version wurde nicht geprüft: Hat es sich geändert, kann das Schreiben die Bibliothek ohne Warnung beschädigen. Gib sie nur frei, wenn du selbst geprüft hast, dass die Daten identisch zurückkommen.'
  },

  'autosync.title': {
    it: 'Sincronizzazione automatica',
    en: 'Automatic sync',
    fr: 'Synchronisation automatique',
    de: 'Automatische Synchronisierung'
  },
  'autosync.message': {
    it: 'Attivare la sincronizzazione automatica fra {list}?\n\nQuando chiudi un programma, CrateForge rilegge le librerie e aggiorna le altre sul posto, con una copia di sicurezza prima di ogni scrittura. Servono le scritture dirette attive; i programmi di sola lettura non ricevono modifiche.',
    en: 'Turn on automatic sync between {list}?\n\nWhen you close a program, CrateForge re-reads the libraries and updates the others in place, with a safety copy before every write. Direct writes must be on; read-only programs receive no changes.',
    fr: 'Activer la synchronisation automatique entre {list} ?\n\nQuand vous fermez un logiciel, CrateForge relit les bibliothèques et met à jour les autres sur place, avec une copie de sécurité avant chaque écriture. Les écritures directes doivent être activées ; les logiciels en lecture seule ne reçoivent rien.',
    de: 'Automatische Synchronisierung zwischen {list} aktivieren?\n\nWenn du ein Programm schließt, liest CrateForge die Bibliotheken neu und aktualisiert die anderen direkt, mit einer Sicherung vor jedem Schreiben. Direkte Schreibzugriffe müssen aktiv sein; schreibgeschützte Programme erhalten keine Änderungen.'
  },

  'quit.title': { it: 'Scrittura in corso', en: 'Writing in progress', fr: 'Écriture en cours', de: 'Schreibvorgang läuft' },
  'quit.message': {
    it: 'CrateForge sta scrivendo dentro i tuoi file e non può essere chiuso adesso: interrompere a metà lascerebbe un file scritto solo in parte, e il ripristino automatico non farebbe in tempo a partire. La chiusura avverrà appena la scrittura è finita.',
    en: 'CrateForge is writing into your files and cannot close right now: stopping halfway would leave a half-written file, with no time for the automatic restore. It will close as soon as the write is done.',
    fr: 'CrateForge écrit dans vos fichiers et ne peut pas se fermer maintenant : s’arrêter à mi-chemin laisserait un fichier à moitié écrit, sans temps pour la restauration automatique. La fermeture aura lieu dès la fin de l’écriture.',
    de: 'CrateForge schreibt gerade in deine Dateien und kann jetzt nicht geschlossen werden: Ein Abbruch würde eine halb geschriebene Datei hinterlassen, ohne Zeit für die automatische Wiederherstellung. Es schließt, sobald der Schreibvorgang fertig ist.'
  },

  busy: {
    it: 'Un altro lavoro è già in corso.',
    en: 'Another task is already running.',
    fr: 'Une autre tâche est déjà en cours.',
    de: 'Eine andere Aufgabe läuft bereits.'
  },
  'needDirect': {
    it: '{what}: serve attivare le scritture dirette in Impostazioni › Sicurezza.',
    en: '{what}: turn on direct writes in Settings › Safety.',
    fr: '{what} : activez les écritures directes dans Réglages › Sécurité.',
    de: '{what}: Aktiviere direkte Schreibzugriffe unter Einstellungen › Sicherheit.'
  },
  'needMasterDb': {
    it: 'La scrittura nel database di Rekordbox è disattivata: attivala in Impostazioni › Sicurezza.',
    en: 'Writing into the Rekordbox database is off: turn it on in Settings › Safety.',
    fr: 'L’écriture dans la base Rekordbox est désactivée : activez-la dans Réglages › Sécurité.',
    de: 'Schreiben in die Rekordbox-Datenbank ist aus: Aktiviere es unter Einstellungen › Sicherheit.'
  },
  'what.tags': { it: 'Scrivere i tag nei file', en: 'Writing tags to files', fr: 'Écrire les tags dans les fichiers', de: 'Tags in Dateien schreiben' },
  'what.seratoCues': {
    it: 'Serato salva gli hot cue dentro i file audio',
    en: 'Serato stores hot cues inside the audio files',
    fr: 'Serato enregistre les hot cues dans les fichiers audio',
    de: 'Serato speichert Hot Cues in den Audiodateien'
  },
  'what.seratoDb': {
    it: 'Aggiornare il database di Serato tocca un file della tua libreria',
    en: 'Updating the Serato database touches a file in your library',
    fr: 'Mettre à jour la base Serato touche un fichier de votre bibliothèque',
    de: 'Das Aktualisieren der Serato-Datenbank ändert eine Datei deiner Bibliothek'
  },
  'what.serato4': {
    it: 'Creare crate in Serato 4 scrive nel database della tua libreria',
    en: 'Creating crates in Serato 4 writes into your library database',
    fr: 'Créer des crates dans Serato 4 écrit dans la base de votre bibliothèque',
    de: 'Crates in Serato 4 anzulegen schreibt in deine Bibliotheksdatenbank'
  },
  'what.delete': { it: 'Eliminare file dal disco', en: 'Deleting files from disk', fr: 'Supprimer des fichiers du disque', de: 'Dateien von der Platte löschen' },
  'masterdbReadHint': {
    it: ' Puoi usare la modalità solo-XML (esporta la collection da Rekordbox e importala qui) oppure scaricare la chiave in Impostazioni › Informazioni e riprovare.',
    en: ' You can use XML-only mode (export the collection from Rekordbox and import it here) or download the key in Settings › About and try again.',
    fr: ' Vous pouvez utiliser le mode XML seul (exportez la collection depuis Rekordbox et importez-la ici) ou télécharger la clé dans Réglages › À propos et réessayer.',
    de: ' Du kannst den reinen XML-Modus nutzen (Collection aus Rekordbox exportieren und hier importieren) oder den Schlüssel unter Einstellungen › Info laden und erneut versuchen.'
  },

  'running.unknown': {
    it: 'Non è stato possibile verificare se {app} è in esecuzione, e senza quella verifica la scrittura non parte: se il programma fosse aperto, le modifiche verrebbero sovrascritte o il file danneggiato. Chiudi {app} e riprova.',
    en: 'Could not check whether {app} is running, and without that check nothing is written: if the program were open, changes would be overwritten or the file damaged. Close {app} and try again.',
    fr: 'Impossible de vérifier si {app} est en cours d’exécution, et sans cette vérification rien n’est écrit : si le logiciel était ouvert, les modifications seraient écrasées ou le fichier abîmé. Fermez {app} et réessayez.',
    de: 'Es ließ sich nicht prüfen, ob {app} läuft, und ohne diese Prüfung wird nichts geschrieben: Wäre das Programm offen, würden Änderungen überschrieben oder die Datei beschädigt. Schließe {app} und versuche es erneut.'
  },
  'running.open': {
    it: '{app} è in esecuzione. Chiudilo prima di continuare: scrivere adesso significa perdere le modifiche quando il programma si chiude, o danneggiare la libreria.',
    en: '{app} is running. Close it before continuing: writing now means losing the changes when the program closes, or damaging the library.',
    fr: '{app} est en cours d’exécution. Fermez-le avant de continuer : écrire maintenant ferait perdre les modifications à sa fermeture, ou abîmerait la bibliothèque.',
    de: '{app} läuft. Schließe es, bevor du fortfährst: Jetzt zu schreiben bedeutet, Änderungen beim Schließen zu verlieren oder die Bibliothek zu beschädigen.'
  },

  'live.message': {
    it: 'Questo è il file della libreria di {app}: l’export non lo sovrascrive. CrateForge scrive un file nuovo, che importi da {app}. Scegli un altro nome.',
    en: 'This is {app}’s library file: the export does not overwrite it. CrateForge writes a new file that you import from {app}. Choose another name.',
    fr: 'C’est le fichier de bibliothèque de {app} : l’export ne l’écrase pas. CrateForge écrit un nouveau fichier, à importer depuis {app}. Choisissez un autre nom.',
    de: 'Das ist die Bibliotheksdatei von {app}: Der Export überschreibt sie nicht. CrateForge schreibt eine neue Datei, die du in {app} importierst. Wähle einen anderen Namen.'
  },

  'ex.readOnly': {
    it: 'sola lettura: CrateForge non sa ancora aggiornare questa libreria sul posto',
    en: 'read-only: CrateForge cannot update this library in place yet',
    fr: 'lecture seule : CrateForge ne sait pas encore mettre à jour cette bibliothèque sur place',
    de: 'schreibgeschützt: CrateForge kann diese Bibliothek noch nicht direkt aktualisieren'
  },
  'ex.gateOff': {
    it: 'scritture dirette spente (Impostazioni › Sicurezza)',
    en: 'direct writes off (Settings › Safety)',
    fr: 'écritures directes désactivées (Réglages › Sécurité)',
    de: 'direkte Schreibzugriffe aus (Einstellungen › Sicherheit)'
  },
  'ex.notFound': {
    it: 'libreria non trovata su questa macchina',
    en: 'library not found on this computer',
    fr: 'bibliothèque introuvable sur cet ordinateur',
    de: 'Bibliothek auf diesem Computer nicht gefunden'
  },
  'ex.noEngine': {
    it: 'modulo di lettura e scrittura non disponibile',
    en: 'read/write module not available',
    fr: 'module de lecture et d’écriture indisponible',
    de: 'Lese-/Schreibmodul nicht verfügbar'
  },
  'ex.unknownRunning': {
    it: 'impossibile verificare se il programma è chiuso',
    en: 'cannot check whether the program is closed',
    fr: 'impossible de vérifier si le logiciel est fermé',
    de: 'nicht prüfbar, ob das Programm geschlossen ist'
  },
  'ex.open': { it: 'il programma è aperto', en: 'the program is open', fr: 'le logiciel est ouvert', de: 'das Programm ist geöffnet' },
  'ex.reread': {
    it: 'rilettura non riuscita: {msg}',
    en: 're-reading failed: {msg}',
    fr: 'relecture échouée : {msg}',
    de: 'Neulesen fehlgeschlagen: {msg}'
  },

  'run.pickTwo': { it: 'Scegli almeno due programmi.', en: 'Pick at least two programs.', fr: 'Choisissez au moins deux logiciels.', de: 'Wähle mindestens zwei Programme.' },
  'run.pickMaster': { it: 'Scegli il programma master.', en: 'Pick the master program.', fr: 'Choisissez le logiciel maître.', de: 'Wähle das Master-Programm.' },
  'run.unknown': {
    it: 'Non è stato possibile verificare quali programmi sono aperti.',
    en: 'Could not check which programs are open.',
    fr: 'Impossible de vérifier quels logiciels sont ouverts.',
    de: 'Es ließ sich nicht prüfen, welche Programme offen sind.'
  },
  'run.sourceReread': {
    it: 'Rilettura di {app} non riuscita: {msg}',
    en: 'Re-reading {app} failed: {msg}',
    fr: 'Relecture de {app} échouée : {msg}',
    de: 'Neulesen von {app} fehlgeschlagen: {msg}'
  },
  'run.needManual': {
    it: 'Prima fai un «Allinea ora» con questa configurazione: vedi l’anteprima, poi confermi. Solo dopo si può accendere l’automatico.',
    en: 'First run “Sync now” with this setup: see the preview, then confirm. Only then can the automatic mode be turned on.',
    fr: 'Faites d’abord « Synchroniser » avec cette configuration : voyez l’aperçu, puis confirmez. Ensuite seulement le mode automatique peut être activé.',
    de: 'Führe zuerst „Jetzt synchronisieren“ mit dieser Einstellung aus: Vorschau ansehen, dann bestätigen. Erst danach lässt sich der Automatikmodus einschalten.'
  },
  'run.closeFirst': { it: 'Chiudi prima: {list}.', en: 'Close first: {list}.', fr: 'Fermez d’abord : {list}.', de: 'Zuerst schließen: {list}.' }
} satisfies Record<string, Entry>;

export type MainKey = keyof typeof T;

let localeOf: () => string | null = () => null;

/** Da chiamare all'avvio con la lettura della lingua dalle impostazioni. */
export function setMainLocaleSource(fn: () => string | null): void {
  localeOf = fn;
}

export function mainLocale(): MainLocale {
  const l = localeOf();
  return l === 'en' || l === 'fr' || l === 'de' ? l : 'it';
}

/** Il testo nella lingua scelta, con i segnaposto `{nome}` sostituiti. */
export function mt(key: MainKey, params: Record<string, string | number> = {}): string {
  const text = (T[key] as Entry)[mainLocale()];
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Tutte le voci, per il test di parità. */
export const MAIN_TEXT: Record<string, Entry> = T;
