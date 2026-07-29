import { create } from 'xmlbuilder2';
import { readdirSync, realpathSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type BetterSqlite3 from 'better-sqlite3';
import {
  ExportSelection,
  getCuesForTrack,
  getPlaylists,
  getPlaylistTrackIds,
  iterateTracks
} from '../common';
import { CAMELOT_TO_TRAKTOR } from './traktorKeys';

/**
 * Export Traktor NML (§6 Fase 1.4): hot cue, beatgrid (BPM), playlist.
 * Solo scrittura di un file nuovo: nessun tocco al collection.nml esistente.
 */
export function writeTraktorNml(
  db: BetterSqlite3.Database,
  outPath: string,
  sel: ExportSelection = {},
  onProgress?: (done: number) => void
): { tracks: number; playlists: number } {
  const doc = create({ version: '1.0', encoding: 'UTF-8', standalone: false });
  const nml = doc.ele('NML', { VERSION: '19' });
  nml.ele('HEAD', { COMPANY: 'CrateForge', PROGRAM: 'CrateForge' });

  const collection = nml.ele('COLLECTION');
  let count = 0;
  const keyByTrackId = new Map<number, string>();
  for (const t of iterateTracks(db, sel)) {
    if (!t.path) continue;
    const dir = traktorDir(t.path);
    // Come traktorDir: normalizzo i separatori così un path Windows-style dal
    // DB (`\`) dà il nome file corretto anche esportando da macOS/Linux, dove
    // path.basename non splitta i backslash.
    const file = t.path.replace(/\\/g, '/').split('/').pop() || '';
    const volume = traktorVolume(t.path);
    keyByTrackId.set(t.id, `${volume}${dir}${file}`);

    const entry = collection.ele('ENTRY', {
      TITLE: t.title ?? '',
      ARTIST: t.artist ?? ''
    });
    // VOLUMEID = VOLUME: Traktor lo usa per identificare il drive (bug B1).
    entry.ele('LOCATION', { DIR: dir, FILE: file, VOLUME: volume, VOLUMEID: volume });
    entry.ele('ALBUM', { TITLE: t.album ?? '' });
    entry.ele('INFO', {
      GENRE: t.genre ?? '',
      PLAYTIME: t.duration_s !== null ? String(Math.round(t.duration_s)) : '',
      RELEASE_DATE: t.year !== null ? `${t.year}/1/1` : '',
      // KEY testuale per compatibilità/lettura umana.
      KEY: t.musical_key ?? '',
      // FILESIZE in KiB (come da formato NML): il reader la legge, quindi senza
      // riscriverla si perdeva a ogni export/round-trip verso Traktor.
      ...(t.filesize !== null ? { FILESIZE: String(Math.round(t.filesize / 1024)) } : {})
    });
    if (t.bpm !== null) {
      entry.ele('TEMPO', { BPM: t.bpm.toFixed(6), BPM_QUALITY: '100.000000' });
    }
    // MUSICAL_KEY@VALUE è un INTERO 0-23 in Traktor: scriverlo come testo lo
    // rendeva illeggibile perfino al nostro reader. Derivato dalla Camelot.
    const traktorKeyIdx = t.camelot ? CAMELOT_TO_TRAKTOR[t.camelot] : undefined;
    if (traktorKeyIdx !== undefined) {
      entry.ele('MUSICAL_KEY', { VALUE: String(traktorKeyIdx) });
    }
    // Grid marker (TYPE 4): Traktor lo vuole con il downbeat reale (START) e il
    // BPM nel figlio <GRID>. Prima emettevamo START=0 senza <GRID> → griglia
    // piatta e non sempre riconosciuta. Ora usiamo l'anchor reale se disponibile.
    const gridBpm = t.beatgrid_bpm != null && t.beatgrid_bpm > 0 ? t.beatgrid_bpm : t.bpm;
    if (gridBpm !== null && gridBpm > 0) {
      const anchorMs = t.beatgrid_anchor_ms != null ? t.beatgrid_anchor_ms : 0;
      const gridMarker = entry.ele('CUE_V2', {
        NAME: 'AutoGrid',
        DISPL_ORDER: '0',
        TYPE: '4',
        START: anchorMs.toFixed(6),
        LEN: '0.000000',
        REPEATS: '-1',
        HOTCUE: '-1'
      });
      gridMarker.ele('GRID', { BPM: gridBpm.toFixed(6) });
    }
    // Pad hot già occupati: un loop su un pad già usato da un hot cue viene
    // degradato a HOTCUE=-1 (in Traktor un pad tiene un solo elemento).
    const usedHot = new Set<number>();
    for (const c of getCuesForTrack(db, t.id)) {
      if (c.cue_type === 'hot' && c.cue_index !== null && c.cue_index < 8) {
        usedHot.add(c.cue_index);
        entry.ele('CUE_V2', {
          NAME: c.label ?? `Cue ${c.cue_index + 1}`,
          TYPE: '0',
          START: c.position_ms.toFixed(3),
          LEN: '0.000000',
          HOTCUE: String(c.cue_index)
        });
      } else if (c.cue_type === 'hot') {
        // Hot cue fuori dagli 8 pad Traktor (index >= 8, es. da VirtualDJ/Engine)
        // o senza pad (index null): degradato a cue non mappato (HOTCUE=-1) per
        // conservarne la posizione, invece di scartarlo in silenzio.
        entry.ele('CUE_V2', {
          NAME: c.label ?? 'Cue',
          TYPE: '0',
          START: c.position_ms.toFixed(3),
          LEN: '0.000000',
          HOTCUE: '-1'
        });
      } else if (c.cue_type === 'memory') {
        // Memory cue → cue non-hotcue (HOTCUE=-1): sopravvive al round-trip.
        entry.ele('CUE_V2', {
          NAME: c.label ?? 'Memory',
          TYPE: '0',
          START: c.position_ms.toFixed(3),
          LEN: '0.000000',
          HOTCUE: '-1'
        });
      } else if (c.cue_type === 'loop' && c.length_ms !== null) {
        // Loop-su-pad (roadmap §7.7): se il loop è su un pad hot LIBERO, conserva
        // lo slot (prima HOTCUE era sempre -1 → si perdeva il pad nel round-trip);
        // se il pad è già occupato da un hot cue, degrada a -1 per non collidere.
        const hot =
          c.cue_index !== null && c.cue_index >= 0 && c.cue_index < 8 && !usedHot.has(c.cue_index)
            ? String(c.cue_index)
            : '-1';
        entry.ele('CUE_V2', {
          NAME: c.label ?? 'Loop',
          TYPE: '5',
          START: c.position_ms.toFixed(3),
          LEN: c.length_ms.toFixed(3),
          HOTCUE: hot
        });
      }
    }
    count++;
    if (count % 500 === 0) onProgress?.(count);
  }
  collection.att('ENTRIES', String(count));

  // Playlist
  const playlistsRoot = nml
    .ele('PLAYLISTS')
    .ele('NODE', { TYPE: 'FOLDER', NAME: '$ROOT' })
    .ele('SUBNODES');
  const playlists = getPlaylists(db, sel).filter((p) => !p.is_folder);
  let plCount = 0;
  for (const p of playlists) {
    const trackIds = getPlaylistTrackIds(db, p.id);
    const keys = trackIds.map((id) => keyByTrackId.get(id)).filter((k): k is string => !!k);
    const node = playlistsRoot.ele('NODE', { TYPE: 'PLAYLIST', NAME: p.name });
    const pl = node.ele('PLAYLIST', {
      ENTRIES: String(keys.length),
      TYPE: 'LIST',
      UUID: `crateforge-${p.id}`
    });
    for (const k of keys) {
      pl.ele('ENTRY').ele('PRIMARYKEY', { TYPE: 'TRACK', KEY: k });
    }
    plCount++;
  }
  playlistsRoot.att('COUNT', String(plCount));

  writeFileSync(outPath, doc.end({ prettyPrint: true }), 'utf-8');
  return { tracks: count, playlists: plCount };
}

/** C:\Music\House\a.mp3 → /:Music/:House/: ; /Users/x/a.mp3 → /:Users/:x/:
 *  Su un drive esterno /Volumes/USB/Music/a.mp3 → /:Music/: (il mount va tolto,
 *  finisce in VOLUME — bug B3). */
export function traktorDir(p: string): string {
  const posix = p
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:/, '') // drive Windows
    .replace(/^\/Volumes\/[^/]+/, ''); // mount esterno macOS
  const dir = dirname(posix);
  const parts = dir.split('/').filter(Boolean);
  return `/:${parts.join('/:')}${parts.length ? '/:' : ''}`;
}

// Nome del volume di boot (montato a "/"), scansionando /Volumes una volta.
let _bootVolume: string | null = null;
function bootVolumeName(): string {
  if (_bootVolume !== null) return _bootVolume;
  _bootVolume = '';
  try {
    for (const name of readdirSync('/Volumes')) {
      try {
        if (realpathSync(`/Volumes/${name}`) === '/') {
          _bootVolume = name;
          break;
        }
      } catch {
        /* voce non risolvibile: salta */
      }
    }
  } catch {
    /* niente /Volumes (non-macOS): boot vuoto */
  }
  return _bootVolume;
}

/**
 * VOLUME per Traktor (bug B1): Windows → "C:"; drive esterno macOS
 * "/Volumes/USB/…" → "USB"; percorso di boot macOS → nome del volume di boot
 * ("Macintosh HD"). Prima restituiva sempre "" su macOS, e Traktor non
 * ritrovava i file.
 */
export function traktorVolume(p: string): string {
  const win = p.match(/^([A-Za-z]:)/);
  if (win) return win[1];
  const ext = p.match(/^\/Volumes\/([^/]+)\//);
  if (ext) return ext[1];
  if (p.startsWith('/')) return bootVolumeName();
  return '';
}
