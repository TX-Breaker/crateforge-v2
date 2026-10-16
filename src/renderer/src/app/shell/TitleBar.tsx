import { useLibrary } from '@/lib/library';
import { isMac } from '@/lib/platform';
import { useT } from '@/lib/strings';
import { cn, shortenPath } from '@/lib/utils';
import { CrateTile } from '@/components/Brand';

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
  const t = useT();
  const { rbPaths, stats } = useLibrary();

  return (
    <div
      className={cn(
        'flex shrink-0 items-center border-b border-line-subtle bg-surface-1',
        isMac ? 'h-10 pl-[78px] pr-4' : 'h-[34px] px-3'
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Marchio in negativo sulla piastrella ambra (specifica logo §05):
          stesso box, stesso raggio, stessa posizione della "C" che c'era prima,
          così lo scambio non muove il layout. A 18px vale il disegno D, due
          dorsi: tre a questa misura diventano un blocco grigio. */}
      {!isMac && <CrateTile size={18} radius={4} className="mr-2" />}
      <span className="truncate text-caption text-ink-mid">
        CrateForge
        {stats && rbPaths?.dir ? (
          <span className="text-ink-lo"> — {shortenPath(rbPaths.dir, 40)}</span>
        ) : (
          <span className="text-ink-lo"> — {t('app.tagline')}</span>
        )}
      </span>
    </div>
  );
}
