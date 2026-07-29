import { useLibrary } from '@/lib/library';
import { useAppState } from '@/lib/appState';
import { isMac } from '@/lib/platform';
import { t } from '@/lib/i18n';
import { cn, shortenPath } from '@/lib/utils';

/**
 * Chrome della finestra (§3.1). Stessa gerarchia, buone maniere native.
 *
 *  macOS   — `hiddenInset`: i semafori vivono in una striscia di trascinamento
 *            di 40px; la shell comincia sotto, così nulla resta coperto.
 *  Windows — Window Controls Overlay: i pulsanti restano quelli di sistema
 *            (disegnati dall'OS a destra), noi controlliamo il resto della
 *            striscia da 34px. Nessun bottone finto, nessun IPC per chiudere.
 */
export function TitleBar() {
  const { locale } = useAppState();
  const { rbPaths, stats } = useLibrary();

  return (
    <div
      className={cn(
        'flex shrink-0 items-center border-b border-line-subtle bg-surface-1',
        isMac ? 'h-10 pl-[78px] pr-4' : 'h-[34px] px-3'
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {!isMac && (
        <span className="mr-2 grid size-[18px] place-items-center rounded-[4px] bg-accent font-mono text-[9px] font-bold text-accent-ink">
          C
        </span>
      )}
      <span className="truncate text-caption text-ink-mid">
        CrateForge
        {stats && rbPaths?.dir ? (
          <span className="text-ink-lo"> — {shortenPath(rbPaths.dir, 40)}</span>
        ) : (
          <span className="text-ink-lo"> — {t(locale, 'app.tagline')}</span>
        )}
      </span>
    </div>
  );
}
