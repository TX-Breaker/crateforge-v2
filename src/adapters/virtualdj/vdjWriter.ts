import { create } from 'xmlbuilder2';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type BetterSqlite3 from 'better-sqlite3';
import {
  ExportSelection,
  getCuesForTrack,
  getPlaylists,
  getPlaylistTrackIds,
  iterateTracks
} from '../common';

/**
 * Colore pivot "#RRGGBB" → attributo Poi@Color.
 *
 * Formato riletto da vdjColor() in vdjReader.ts, quindi chiude il round-trip.
 * L'encoding colore NATIVO di VirtualDJ non è verificato su libreria reale
 * (§2.4: nessun hot cue colorato nei dati di riferimento): in assenza di
 * colore NON emettiamo l'attributo, invece di inventare un default.
 */
function vdjColorAttr(hex: string | null): Record<string, string> {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return {};
  return { Color: hex.toUpperCase() };
}

/**
 * Export VirtualDJ database XML (§6 Fase 1.4).
 * Genera un database.xml NUOVO (da importare/unire manualmente in VirtualDJ):
 * non tocca mai il database.xml esistente dell'utente.
 *
 * Onestà (§1): ciò che non è rappresentabile viene CONTATO e restituito in
 * `warnings`, mai scartato in silenzio. Prima di questa versione le memory cue
 * sparivano senza traccia — cioè il 100% dei cue su una rotta VirtualDJ→
 * VirtualDJ, dove i marker automix/remix vengono letti proprio come memory.
 */
export function writeVirtualDjXml(
  db: BetterSqlite3.Database,
  outPath: string,
  sel: ExportSelection = {},
  onProgress?: (done: number) => void
): { tracks: number; playlists: number; warnings: string[] } {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('VirtualDJ_Database', { Version: '2024' });

  let count = 0;
  // Le playlist referenziano i brani per PATH: teniamo la corrispondenza.
  const pathById = new Map<number, string>();
  let skippedNoPath = 0;
  let memoryCues = 0;
  let hotWithoutPad = 0;
  let loopWithoutLength = 0;
  for (const t of iterateTracks(db, sel)) {
    if (!t.path) {
      skippedNoPath++;
      continue;
    }
    pathById.set(t.id, t.path);
    const song = root.ele('Song', {
      FilePath: t.path,
      FileSize: t.filesize !== null ? String(t.filesize) : ''
    });
    song.ele('Tags', {
      Author: t.artist ?? '',
      Title: t.title ?? '',
      Album: t.album ?? '',
      Genre: t.genre ?? '',
      Year: t.year !== null ? String(t.year) : '',
      Remix: t.version_label ?? ''
    });
    // Infos@SongLength: il nostro reader legge la durata da qui, senza si
    // perde nel round-trip finché VDJ non ri-analizza.
    if (t.duration_s !== null) song.ele('Infos', { SongLength: t.duration_s.toFixed(3) });
    const scan: Record<string, string> = {};
    const scanBpm = t.beatgrid_bpm != null && t.beatgrid_bpm > 0 ? t.beatgrid_bpm : t.bpm;
    if (scanBpm !== null && scanBpm > 0) scan.Bpm = (60 / scanBpm).toFixed(6); // VDJ usa secondi-per-beat
    // Phase = downbeat in secondi: preserva la fase della beatgrid se nota.
    if (t.beatgrid_anchor_ms != null) scan.Phase = (t.beatgrid_anchor_ms / 1000).toFixed(6);
    if (t.musical_key) scan.Key = t.musical_key;
    if (Object.keys(scan).length) song.ele('Scan', scan);

    for (const c of getCuesForTrack(db, t.id)) {
      const pos = (c.position_ms / 1000).toFixed(4);
      const color = vdjColorAttr(c.color);
      if (c.cue_type === 'hot' && c.cue_index !== null) {
        song.ele('Poi', {
          Name: c.label ?? `Cue ${c.cue_index + 1}`,
          Pos: pos,
          Num: String(c.cue_index + 1),
          Type: 'cue',
          ...color
        });
      } else if (c.cue_type === 'loop' && c.length_ms !== null) {
        song.ele('Poi', {
          Name: c.label ?? 'Loop',
          Pos: pos,
          // Size in SECONDI: è la stessa unità che rilegge vdjReader.mapPoi
          // (size * 1000 → ms), quindi il round-trip CrateForge è coerente.
          Size: (c.length_ms / 1000).toFixed(4),
          Type: 'loop',
          ...color
        });
      } else if (c.cue_type === 'memory') {
        // Memory cue → Poi Type="remix": è il marker di sezione che VirtualDJ
        // produce davvero ed è esattamente ciò che vdjReader rilegge come
        // 'memory'. Prima cadeva fuori dalla catena if/else e spariva.
        memoryCues++;
        song.ele('Poi', {
          Name: c.label ?? 'Memory',
          Pos: pos,
          Type: 'remix',
          ...color
        });
      } else {
        // Rete di sicurezza: hot senza pad assegnato o loop senza lunghezza.
        // Meglio conservarne la POSIZIONE come marker che perderli del tutto;
        // il conteggio finisce nei warning, così l'utente lo sa.
        if (c.cue_type === 'hot') hotWithoutPad++;
        else loopWithoutLength++;
        song.ele('Poi', {
          Name: c.label ?? (c.cue_type === 'loop' ? 'Loop' : 'Cue'),
          Pos: pos,
          Type: 'remix',
          ...color
        });
      }
    }
    count++;
    if (count % 500 === 0) onProgress?.(count);
  }

  writeFileSync(outPath, doc.end({ prettyPrint: true }), 'utf-8');

  /* Playlist: in VirtualDJ NON stanno nel database.xml, ma come file separati
     `.vdjfolder` sotto una cartella "Folders". Ogni file è un
     <VirtualFolder> con un <song path="…"/> per brano, nell'ordine. */
  let playlistCount = 0;
  const lists = getPlaylists(db, sel).filter((p) => !p.is_folder);
  if (lists.length) {
    const foldersDir = join(dirname(outPath), 'Folders');
    mkdirSync(foldersDir, { recursive: true });
    for (const p of lists) {
      const paths = getPlaylistTrackIds(db, p.id)
        .map((id) => pathById.get(id))
        .filter((v): v is string => !!v);
      if (!paths.length) continue;
      const pl = create({ version: '1.0', encoding: 'UTF-8' }).ele('VirtualFolder', {
        noDuplicates: 'no'
      });
      for (const songPath of paths) pl.ele('song', { path: songPath });
      // Nome file ripulito dai caratteri che il filesystem non accetta.
      const safe = p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || `playlist-${p.id}`;
      writeFileSync(join(foldersDir, `${safe}.vdjfolder`), pl.end({ prettyPrint: true }), 'utf-8');
      playlistCount++;
    }
  }

  const warnings: string[] = [];
  if (skippedNoPath > 0) {
    warnings.push(`${skippedNoPath} brani senza percorso file non esportati.`);
  }
  if (memoryCues > 0) {
    warnings.push(
      `${memoryCues} memory cue esportate come marker "remix" di VirtualDJ (non esiste un tipo memory nativo).`
    );
  }
  if (hotWithoutPad > 0) {
    warnings.push(
      `${hotWithoutPad} hot cue senza pad assegnato: conservata la posizione come marker, ma non finiranno su un pad.`
    );
  }
  if (loopWithoutLength > 0) {
    warnings.push(
      `${loopWithoutLength} loop senza lunghezza: conservato solo il punto di inizio.`
    );
  }
  return { tracks: count, playlists: playlistCount, warnings };
}
