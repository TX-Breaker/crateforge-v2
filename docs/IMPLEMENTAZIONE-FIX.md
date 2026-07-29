# Implementazione dei fix di interoperabilità DJ

Stato di implementazione della roadmap di [INTEROPERABILITA-DJ.md](INTEROPERABILITA-DJ.md),
più il selettore di conversione X→Y nella GUI.

Legenda: ✅ fatto e validato su dati reali · 🧪 implementato, validato su dati sintetici (manca libreria reale) · ⏸️ rinviato con motivazione.

## Fix della roadmap

| # | Item | Stato | File | Validazione |
|---|---|---|---|---|
| — | **Bug key Engine (cromatica → Camelot)** | ✅ | `adapters/engine/engineReader.ts` (`ENGINE_KEY`) | mappa Camelot verificata; test aggiornati |
| 1 | **Lettura hot cue Rekordbox da `DjmdCue`** | ✅ | `python-sidecar/sidecar.py` (`_rb_cue_row`, ingest) | 3368 cue letti dal master.db reale (2221 hot, 1140 memory, 7 loop) |
| 2 | **Loop nel writer Rekordbox XML** | ✅ | `adapters/rekordbox/xmlWriter.ts` | test: POSITION_MARK Type=4 con End |
| 3 | **Mappa `Kind` non contigua + slot** | ✅ | `sidecar.py` (`_rb_pad_index`) | pad 1-3=Kind 1-3, pad 4-8=Kind 5-9 |
| 4 | **Palette colore cue Rekordbox** | ✅ (best-effort) | `sidecar.py` (`_rb_cue_color`) | il 99% dei cue ha `Color=-1` (default); mappati gli indici noti |
| 5 | **Estensione UDM: gain, rating, track_color, beatgrid** | ✅ | `core/schema.ts` (v6), `core/foreignImport.ts`, `core/udm.ts` | RB: rating+track_color; Engine: rating |
| 6 | **VirtualDJ: POI automix/remix + parser `.vdjfolder`** | ✅ | `adapters/virtualdj/vdjReader.ts` | automix realStart/remix→memory; VirtualFolder→playlist; FilterFolder segnalati |
| 7 | **Traktor: loop-su-pad + SMARTLIST + volume (B1/B2/B3)** | ✅ | `adapters/traktor/nmlReader.ts`, `nmlWriter.ts` | boot vs `/Volumes/…` verificato; loop conserva il pad; smartlist segnalate |
| 8 | **Serato: reader GEOB (Markers2) + database V2 + crate + scan cartella** | ✅ | `sidecar.py` (`parse_serato_markers2`, `cmd_read_serato`) | **validato su dati reali**: 95/96 file, 709 hot cue; end-to-end 44 tracce/309 cue con colori e label corretti. Fix del base64 (troncatura all'ultimo gruppo di 4) scoperto sui file veri. Legge sia il `database V2` sia, in scan, i file con tag Serato non nel database |
| 9 | **Engine: decodifica cue `PerformanceData`** | ✅ | `adapters/engine/engineReader.ts` (`readEngineCues`) | 860 hot cue decodificati dal m.db reale; test sintetico |
| 10 | **Beatgrid reale via ANLZ / GRID** | ⏸️ | — | bloccato: pyrekordbox 0.4.3 dà `ConstError` sul chunk PQT2; richiede parser ANLZ custom |
| 11 | **Scrittura diretta nel master.db** | ✅ scrittura playlist (esistente) · ⏸️ scrittura cue | `sidecar.py` (`masterdb-create-playlist`) | **Sicurezza verificata in simulazione**: scritta una playlist+brani su una COPIA (ri-cifrata SQLCipher correttamente, riletta OK) con il master.db **reale intatto** (hash+mtime identici). pyrekordbox blocca la commit se Rekordbox è aperto (salvaguardia mantenuta). La scrittura dei CUE richiede l'inserimento low-level di righe `DjmdCue` (pyrekordbox non espone `add_cue`): fattibile, non ancora implementata |

## GUI — Conversione diretta X → Y

- Nuovo pannello in `renderer/src/pages/ConverterPage.tsx`: due selettori (software di partenza → di arrivo) e un pulsante **Converti** che importa la libreria X e la esporta verso Y in un unico flusso, mostrando prima i limiti del formato.
- Sorgenti: Rekordbox (master.db / XML), Traktor, VirtualDJ, Engine DJ, Serato (sperimentale).
- Destinazioni: Rekordbox XML, Traktor NML, VirtualDJ XML.
- L'export filtra sulla **sola** libreria importata: nuovo filtro `source` in `ExportSelection` (`adapters/common.ts`), inoltrato dagli handler IPC ai writer.

## Note trasversali

- Schema UDM portato a **v6** (migrazione `ALTER TABLE` additiva, retrocompatibile).
- `NormTrack` esteso con campi opzionali (`gainDb`, `rating`, `trackColor`, `beatgridBpm`, `beatgridAnchorMs`): gli adapter che non li hanno restano invariati.
- Tutte le letture restano **in sola lettura** sulle sorgenti; il reader Serato apre i file audio in sola lettura.
- Test: 176 passano (aggiornati i fixture per il nuovo comportamento loop/key; aggiunto test decoder cue Engine e validazione parser Serato).
