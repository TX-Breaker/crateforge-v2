# Compatibilità con le versioni dei software DJ

## Il problema

Nessuno dei formati che CrateForge legge e scrive è documentato. Il blob dei cue
di Engine, i tag GEOB di Serato, i crate, lo schema del `master.db`: tutto è
stato ricavato aprendo file veri e guardando i byte, con **una versione precisa**
di quel software davanti.

Quando esce una versione nuova, quel sapere può diventare falso da un giorno
all'altro. E il modo in cui diventa falso è il peggiore possibile: la scrittura
**non fallisce con un errore**. Produce una libreria che si apre, sembra a posto,
e ha i cue nel punto sbagliato o una tabella che il software nuovo interpreta in
un altro modo. Il DJ se ne accorge in console.

## La regola

> Si scrive solo verso versioni che l'autore ha collaudato.
> Una versione più recente non è "probabilmente compatibile": è **non
> verificata**, e CrateForge si ferma.

Il criterio non è *funzionerà?* ma *l'ho verificato?*. Il primo è una previsione,
il secondo è un fatto.

## Che cosa viene misurato

Non la versione dell'applicazione — quella dice poco — ma il **marcatore del
formato** che sta dentro il file dell'utente:

| Software | Marcatore letto | Dove |
|---|---|---|
| Engine DJ | `Information.schemaVersionMajor/Minor/Patch` | `Engine Library/Database2/m.db` |
| Serato | campo `vrsn` in testa a `database V2` | cartella `_Serato_` |
| Traktor | attributo `VERSION` di `<NML>` | `collection.nml` |
| VirtualDJ | attributo `Version` di `<VirtualDJ_Database>` | `database.xml` |
| Rekordbox (XML) | attributo `Version` di `<DJ_PLAYLISTS>` | collection XML |
| Rekordbox (master.db) | **versione dell'app installata** | nome della cartella di installazione |

Il `master.db` è l'eccezione dichiarata: è cifrato, lo schema non è ispezionabile
dall'esterno, quindi l'unico dato disponibile è quale Rekordbox è installato su
questa macchina. È un'approssimazione, ed è scritta come tale nel codice: se il
`master.db` arriva da un altro computer, quel dato non lo descrive.

Le sonde leggono il minimo indispensabile — i primi kilobyte di un XML, una riga
di SQLite, il primo campo di un file binario — e sempre in sola lettura.

## Versioni collaudate (registro)

Il registro vive in [`src/core/djVersions.ts`](../src/core/djVersions.ts): è
**codice, non configurazione**. Si aggiorna quando l'autore prova la versione
nuova e pubblica un aggiornamento dell'app.

| Software | Formato collaudato | Provato con | Data |
|---|---|---|---|
| Rekordbox | collection XML 1.0.0 | rekordbox 7.2.16 | 2026-07-29 |
| Engine DJ | schema 3.0.2 | Engine DJ 5.0.0 | 2026-07-29 |
| Serato | database V2 vrsn 2.0 | Serato DJ Pro 4.0.9 | 2026-07-29 |
| Traktor | NML 20 | file di riferimento (Traktor non installato) | 2026-07-29 |
| VirtualDJ | database.xml 2024 | VirtualDJ 8.5 | 2026-07-29 |

> Non aggiungere una riga senza aver aperto il file vero. Ogni riga è una
> promessa: «su questo, i byte li ho guardati io».

## Che cosa succede in pratica

| Situazione | Lettura | Scrittura |
|---|---|---|
| versione ≤ collaudata | sì | sì |
| versione più recente | sì, con avviso in cima ai warning dell'import | **rifiutata**, con il motivo per esteso |
| marcatore illeggibile o software non installato | sì, con avviso | **rifiutata** |
| versione sbloccata a mano | sì | sì, e resta scritto nel registro operazioni |

Leggere non può rovinare niente, quindi la lettura resta aperta: serve proprio
nei casi difficili, per esempio per portare via i dati da una versione nuova che
non si vuole più usare. Chi preferisce la massima prudenza può passare il
controllo a **severo** (Impostazioni → Sicurezza), che rifiuta anche gli import.

I punti in cui il controllo scatta:

- `library:importForeign`, `library:ingestXml`, `library:importSerato` → verdetto
  in lettura, l'avviso finisce nei `warnings` mostrati in pagina;
- `export:engineLibrary` → sul `m.db` usato come modello dello schema;
- `export:seratoCues`, `export:seratoCrates` → sulla libreria Serato installata;
- `masterdb:createPlaylist` → sulla versione di Rekordbox installata (unico punto
  in cui si scrive dentro il database dell'utente).

Gli export che producono **file nuovi** (Rekordbox XML, Traktor NML, VirtualDJ
XML) non sono soggetti al blocco: non toccano niente dell'utente, e un file che
il software di destinazione rifiuta si butta senza danni.

## Lo sblocco

Chi ha provato di persona che una versione nuova va bene deve poter procedere —
altrimenti la protezione diventa una gabbia. Lo sblocco:

- è **per singolo software e singola versione** (sbloccare Engine 3.1.0 non
  sblocca la 3.2.0);
- richiede la **modalità Esperto**;
- passa da una **conferma di sistema** disegnata dal processo main, che il
  renderer non può falsificare;
- viene **registrato** nel registro operazioni (`version.unlock`), e ogni
  operazione compiuta grazie a esso è marcata `version.acknowledged`;
- si revoca con un clic.

Il testo della conferma non dice «sei sicuro?». Dice che cosa può succedere:
*se il formato è cambiato, la scrittura può danneggiare la libreria senza
segnalare nulla; sbloccalo solo se hai verificato tu stesso che i dati tornano
indietro identici.*

## Come si aggiorna dopo un collaudo

1. Installare la versione nuova del software DJ.
2. Rifare il giro di verifica: import → export → riapertura nel software, e per i
   writer binari il round-trip byte-identico (i test `engineCodec`,
   `writeSerato.e2e` e `realCueReaders` esistono per questo).
3. Aggiornare la riga in `TESTED` con marcatore, versione dell'app, data e una
   riga di `evidence` che dica su cosa è stato fatto il collaudo.
4. Aggiornare la tabella qui sopra e pubblicare.
