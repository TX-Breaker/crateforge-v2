import { XMLParser } from 'fast-xml-parser';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import type { ForeignLibrary, NormCue, NormPlaylist, NormTrack } from '@core/foreignImport';

/**
 * Reader VirtualDJ database.xml → modello normalizzato.
 * Inverso di adapters/virtualdj/vdjWriter.ts, gestisce i file reali di
 * VirtualDJ. Le playlist di VirtualDJ vivono in file .vdjfolder separati, non
 * in database.xml: qui importiamo brani + cue/loop. Solo lettura.
 */

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * VirtualDJ salva il BPM come secondi-per-beat (es. 0.5 = 120 BPM). Alcuni
 * campi però contengono già i BPM. Euristica: un valore piccolo (<10) è
 * secondi-per-beat, altrimenti è già in BPM.
 */
export function vdjBpm(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = Number(raw);
  if (!v || Number.isNaN(v) || v <= 0) return null;
  return v < 10 ? 60 / v : v;
}

/** Colore VirtualDJ ("#RRGGBB", "0xRRGGBB" o intero) → "#RRGGBB", o null. */
function vdjColor(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
  const n = s.startsWith('0x') ? parseInt(s.slice(2), 16) : Number(s);
  if (!Number.isFinite(n)) return null;
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0').toUpperCase();
}

function mapPoi(p: Record<string, string>): NormCue | null {
  const pos = Number(p['@_Pos']);
  if (Number.isNaN(pos)) return null;
  const type = (p['@_Type'] || 'cue').toLowerCase();
  const size = p['@_Size'] !== undefined ? Number(p['@_Size']) : 0;
  const num = p['@_Num'] !== undefined ? Number(p['@_Num']) : NaN;
  const color = vdjColor(p['@_Color']);
  if (type === 'cue' || type === 'hotcue' || type === 'loop') {
    const isLoop = type === 'loop' || size > 0;
    return {
      type: isLoop ? 'loop' : 'hot',
      index: !isLoop && !Number.isNaN(num) ? Math.max(0, num - 1) : null,
      positionMs: pos * 1000,
      lengthMs: isLoop && size > 0 ? size * 1000 : null,
      color,
      label: p['@_Name'] || null
    };
  }
  // POI automix/remix (roadmap §7.6): prima scartati del tutto. Portiamo i
  // marcatori utili come memory cue — l'inizio reale del brano (automix
  // realStart) e i punti remix — saltando i punti interni al mixer
  // (fade/cut/tempo/realEnd) e la beatgrid.
  const point = (p['@_Point'] || '').toLowerCase();
  if (type === 'automix' && point === 'realstart') {
    return { type: 'memory', index: null, positionMs: pos * 1000, lengthMs: null, color, label: 'Inizio' };
  }
  if (type === 'remix') {
    return { type: 'memory', index: null, positionMs: pos * 1000, lengthMs: null, color, label: p['@_Name'] || 'Remix' };
  }
  return null;
}

/**
 * Playlist VirtualDJ: NON stanno in database.xml ma in file .vdjfolder nella
 * cartella "Folders" accanto al database (roadmap §7.6: prima ignorate → 0
 * playlist importate). I VirtualFolder statici hanno `<song path>`; i
 * FilterFolder sono query dinamiche non materializzabili (le segnaliamo).
 */
function readVdjFolders(foldersDir: string): { playlists: NormPlaylist[]; filters: string[] } {
  const playlists: NormPlaylist[] = [];
  const filters: string[] = [];
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false });
  const walk = (dir: string, prefix: string): void => {
    let entries: import('fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, prefix ? `${prefix} / ${e.name}` : e.name);
      } else if (e.isFile() && /\.vdjfolder$/i.test(e.name)) {
        const base = e.name.replace(/\.vdjfolder$/i, '');
        const name = prefix ? `${prefix} / ${base}` : base;
        let doc: Record<string, unknown>;
        try {
          doc = parser.parse(readFileSync(full, 'utf-8'));
        } catch {
          continue;
        }
        if (doc?.FilterFolder !== undefined && doc?.VirtualFolder === undefined) {
          filters.push(name);
          continue;
        }
        const vf = (doc?.VirtualFolder ?? doc?.MyLists) as Record<string, unknown> | undefined;
        if (vf === undefined) continue; // né VirtualFolder statico né FilterFolder
        const songs = asArray<Record<string, string>>(vf.song as never);
        const trackSourceIds = songs
          .map((s) => (s && s['@_path']) || null)
          .filter((p): p is string => !!p);
        // Una playlist statica valida va importata anche se VUOTA (come fanno i
        // reader Traktor/Engine): non perdiamo la struttura dell'utente.
        playlists.push({ sourceId: `vdjf:${full}`, name, isFolder: false, parentSourceId: null, trackSourceIds });
      }
    }
  };
  walk(foldersDir, '');
  return { playlists, filters };
}

export function readVirtualDjXml(dbPath: string): ForeignLibrary {
  const xml = readFileSync(dbPath, 'utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false
  });
  const doc = parser.parse(xml);
  const root = doc?.VirtualDJ_Database;
  if (!root) throw new Error('File non valido: manca VirtualDJ_Database.');

  const warnings: string[] = [];
  const tracks: NormTrack[] = [];
  for (const s of asArray<Record<string, unknown>>(root.Song)) {
    const path = (s['@_FilePath'] as string) || null;
    if (!path) continue;
    const tags = (s.Tags ?? {}) as Record<string, string>;
    const infos = (s.Infos ?? {}) as Record<string, string>;
    const scan = (s.Scan ?? {}) as Record<string, string>;

    const bpm = vdjBpm(tags['@_Bpm']) ?? vdjBpm(scan['@_Bpm']);
    const key = tags['@_Key'] || scan['@_Key'] || null;
    const year = tags['@_Year'] ? Number(tags['@_Year']) || null : null;
    const durationS = infos['@_SongLength'] ? Number(infos['@_SongLength']) || null : null;
    const filesize = (s['@_FileSize'] || infos['@_FileSize'])
      ? Number(s['@_FileSize'] ?? infos['@_FileSize']) || null
      : null;

    const cues = asArray<Record<string, string>>(s.Poi as never)
      .map(mapPoi)
      .filter((c): c is NormCue => c !== null);

    // Beatgrid VirtualDJ: Scan@Phase = offset del primo beat in SECONDI (downbeat),
    // Scan@Bpm dà il tempo. Prima ignorati → la fase si perdeva nella conversione.
    const phase = scan['@_Phase'] !== undefined ? Number(scan['@_Phase']) : NaN;
    const beatgridAnchorMs = Number.isFinite(phase) ? phase * 1000 : null;

    tracks.push({
      sourceId: path, // FilePath è l'identificatore stabile in VirtualDJ
      title: tags['@_Title'] || null,
      artist: tags['@_Author'] || null,
      album: tags['@_Album'] || null,
      genre: tags['@_Genre'] || null,
      year,
      bpm,
      musicalKey: key,
      durationS,
      path,
      filesize,
      cues,
      beatgridBpm: bpm,
      beatgridAnchorMs
    });
  }

  if (tracks.length === 0) warnings.push('Nessun brano trovato nel database VirtualDJ.');

  // Playlist dai .vdjfolder nella cartella "Folders" accanto al database.
  const { playlists, filters } = readVdjFolders(join(dirname(dbPath), 'Folders'));
  if (filters.length > 0) {
    warnings.push(
      `VirtualDJ: ${filters.length} cartelle-filtro dinamiche non importate (criteri non materializzabili): ${filters.slice(0, 5).join(', ')}${filters.length > 5 ? '…' : ''}.`
    );
  }
  if (playlists.length === 0 && filters.length === 0) {
    warnings.push('VirtualDJ: nessuna playlist statica (.vdjfolder) trovata accanto al database.');
  }
  return { source: 'virtualdj', tracks, playlists, warnings };
}
