# CrateForge V2 — stato di avanzamento

> **Questo file dice dove siamo davvero.** Ogni cifra qui sotto è stata contata
> il giorno indicato, non ricordata. Se una riga non è verificabile con un
> comando, non deve stare qui.
>
> La storia precedente al fork (fasi 1–3 della V1) vive nel repository della V1,
> in `TrackList-Tool/crateforge/PROGRESS.md`. Quel documento descrive la V1 e non
> vale per questa versione: il file che stai leggendo è stato riscritto da zero
> il 29/07/2026 perché quello ereditato dichiarava cose non più vere — «10
> pagine», «it/en», «176 test», «export Engine/Serato rimandato» — su un
> programma che nel frattempo era cambiato.

Ultimo aggiornamento: **29/07/2026**

---

## Come verificare tutto ciò che segue

```bash
npm run typecheck                 # compilazione pulita
node scripts/run-vitest.cjs run   # suite (dentro Electron: npx vitest NON funziona)
node tests/ui/ipccheck.cjs        # allineamento preload ↔ main
npm run build                     # bundle main/preload/renderer
npm run dist                      # icone + bundle + pacchetto installabile
```

## Numeri verificati (29/07/2026)

| Cosa | Valore | Come è stato contato |
|---|---|---|
| Destinazioni nell'interfaccia | 13 | file in `src/renderer/src/pages/` |
| Lingue | 4 (it · en · fr · de) | `LOCALES` in `src/renderer/src/lib/i18n.ts` |
| Test | 248 passati, 2 file auto-saltati | `node scripts/run-vitest.cjs run` |
| File di test | 37 | `ls tests/*.test.ts` |
| Canali IPC | 71 invoke ↔ 71 handle, 0 disallineamenti | `node tests/ui/ipccheck.cjs` |
| Icona dell'applicazione | presente | `build/icon.ico` + `build/icon.png`, da `npm run icons` |

---

## Fatto in questa versione

### Interfaccia (fork e redesign)
- [x] 13 destinazioni in 6 gruppi; le fusioni rispetto alla V1 sono tab, mai
      rimozioni di funzioni
- [x] Due assi di tema indipendenti (stile × luminosità) e **cinque palette**:
      Studio chiaro/scuro, Neutro chiaro/scuro, OLED (sempre scuro)
- [x] Elenco brani virtualizzato con paginazione dal processo principale
- [x] Densità comfortable/compact, movimento ridotto, scorciatoie, palette comandi
- [x] i18n a parità imposta dal compilatore (il tipo deriva dall'italiano) più
      un test che fallisce se una chiave manca in una delle quattro lingue

### Identità
- [x] Marchio «The Crate» in quattro disegni (48+, 32, 20–24, 16–18): sotto i
      32px il tratto si ingrossa e i dorsi si riducono, non si scala un disegno
      solo — `src/renderer/src/components/Brand.tsx`
- [x] Cinque rese permesse: primaria (segue i token del tema), negativo su
      accento, un solo inchiostro, filigrana spenta
- [x] Carattere: JetBrains Mono 500 per tutta l'interfaccia
- [x] Icona dell'app generata dai quattro disegni (`npm run icons`): `.ico`
      multi-misura per Windows, squircle 1024 per macOS

### Interoperabilità (portata dalla V1 e completata)
- [x] Lettura: Rekordbox (master.db cifrato via sidecar + collection XML),
      Traktor, VirtualDJ, Engine DJ, Serato
- [x] Scrittura: Rekordbox XML, Traktor NML, VirtualDJ XML + playlist
      `.vdjfolder`, **libreria Engine DJ nuova**, **cue e loop Serato nei tag
      dei file audio**, **crate Serato**
- [x] Nessuna perdita silenziosa: ogni dato non rappresentabile finisce nei
      `warnings` mostrati in pagina — memory cue verso VirtualDJ, cue oltre
      l'ottavo pad verso Rekordbox, colori verso Traktor
- [x] Codec Engine verificato per round-trip byte-identico sui blob reali
- [x] Writer Serato che preserva le entry non interpretate e **annulla** la
      scrittura se restano byte sconosciuti

### Sicurezza dei dati
- [x] Gate delle scritture nel processo principale, con conferma di sistema non
      falsificabile dal renderer
- [x] Conferma con parola digitata e pannello dei numeri prima di ogni
      operazione che tocca i file dell'utente (quarantena, eliminazione,
      scrittura tag, cue Serato)
- [x] Blocco per versione dei software DJ: si scrive solo verso versioni
      collaudate — [docs/COMPATIBILITA-VERSIONI.md](docs/COMPATIBILITA-VERSIONI.md)
- [x] Avviso sulle librerie su unità di rete (SQLite non regge i lock su SMB)
- [x] Rilevamento autonomo di Python e preparazione dell'ambiente del sidecar

---

## Aperto — con priorità onesta

Elenco tenuto corto di proposito: sono punti emersi da revisioni sul codice, non
una lista dei desideri.

### Prima di una distribuzione pubblica
- [ ] **Ripristino dai backup dentro l'app.** Le copie sono verificate e da oggi
      accompagnate da un manifest che dice da dove veniva ogni file, quindi il
      ripristino è possibile — ma va fatto a mano. Serve `backups:list` /
      `backups:restore`, simmetrico a quello della quarantena
- [ ] **Spazio e rotazione dei backup.** Scrivere i cue in 3.000 brani copia
      3.000 file audio interi in `%APPDATA%`, senza controllare lo spazio libero
      e senza cancellarli mai. Servono: somma dei byte mostrata nella conferma,
      rifiuto se il disco non basta, e una pulizia delle cartelle vecchie
- [ ] **Annullamento cooperativo del sidecar.** Le tre scritture sugli originali
      sono ora dichiarate non annullabili e la chiusura della finestra le
      aspetta, quindi il caso peggiore è chiuso. Resta da fare la versione
      cooperativa (SIGTERM gestito dal sidecar) per poter offrire di nuovo
      l'annullamento senza rischi
- [ ] **Licenze di terze parti.** Il pacchetto include mutagen (GPL-2.0+) e
      altre dipendenze: serve il file delle licenze e una revisione della
      posizione di `package.json` (`UNLICENSED`)
- [ ] **Aggiornamento dell'applicazione.** Nessun canale di rilascio: le
      correzioni non raggiungono chi ha già installato

### Qualità
- [ ] Contrasto: il testo terziario è sotto AA in tutte le palette; accento e
      avviso usati come TESTO falliscono AA in Studio chiaro
- [ ] Copertura CI: i test del sidecar non vengono eseguiti, e quelli dell'app
      girano solo su Linux
- [ ] Import XML ed export fuori dal processo principale (oggi la finestra
      resta bloccata su collection molto grandi)

---

## Limiti dichiarati (non sono difetti da chiudere)

- **Crate Serato**: nessun round-trip verificato contro un crate scritto da
  Serato → i crate esistenti non vengono mai sovrascritti
- **Forma d'onda e griglia di Engine**: si sanno leggere ma non ricreare byte
  per byte; Engine le rigenera alla prima analisi
- **Colori dei cue verso Traktor**: il formato NML non li prevede
- **Serato ha 8 pad**: arrivando da Engine o VirtualDJ, i cue oltre l'ottavo non
  hanno posto e finiscono nei warning
- **Import in Rekordbox**: resta manuale, per scelta

---

## Documenti

| File | Contenuto |
|---|---|
| [README.md](README.md) | cos'è, come si installa, come si costruisce |
| [docs/PORTING-V1-V2.md](docs/PORTING-V1-V2.md) | cosa è stato portato dalla V1, cosa no e perché |
| [docs/COMPATIBILITA-VERSIONI.md](docs/COMPATIBILITA-VERSIONI.md) | il blocco per versione dei software DJ |
| [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) | token, tipografia, componenti, temi |
| [docs/REDESIGN-NOTES.md](docs/REDESIGN-NOTES.md) | mappa della migrazione 19 → 13 destinazioni |
| [docs/REVERSE-ENGINEERING-LIBRERIE.md](docs/REVERSE-ENGINEERING-LIBRERIE.md) | i formati, misurati byte per byte |
| [docs/INTEROPERABILITA-DJ.md](docs/INTEROPERABILITA-DJ.md) | cosa passa e cosa no, canale per canale |
