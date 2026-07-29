import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

/** mm:ss (o h:mm:ss oltre l'ora) — sempre reso in mono tabellare. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0
    ? `${h}:${mm}:${String(sec).padStart(2, '0')}`
    : `${mm}:${String(sec).padStart(2, '0')}`;
}

/** Durata lunga in forma compatta: 11m 04s, 2h 15m. */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export function formatNumber(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(locale);
}

/** hh:mm da un timestamp ISO/SQL, senza esplodere su valori sporchi. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Path troncato al centro: la coda (nome file) è la parte informativa. */
export function shortenPath(path: string, max = 52): string {
  if (path.length <= max) return path;
  const tail = path.slice(-(max - 12));
  return `…${tail}`;
}
