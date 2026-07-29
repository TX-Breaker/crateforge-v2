import { useAppState } from '@/lib/appState';
import { t, type MsgKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { CUE_PALETTE } from '@/lib/cuePalette';

/**
 * Legenda della palette dei cue (§8.1).
 *
 * Non è cromatura opzionale: otto tinte a 9px non si distinguono a colpo
 * d'occhio, quindi è la legenda a rendere leggibili le bandierine sulla forma
 * d'onda — ed è l'unico posto in cui il legame fra colore e significato viene
 * dichiarato. Sta sotto la forma d'onda, sempre visibile, mai dietro una
 * disclosure.
 *
 * L'ordine è quello degli slot, 1→8, e non cambia mai: la posizione nella
 * legenda è parte dell'informazione tanto quanto la tinta.
 */
export function CueLegend({ className }: { className?: string }) {
  const { locale } = useAppState();
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-card border border-line-subtle bg-surface-1 px-3 py-2',
        className
      )}
    >
      <span className="font-mono text-eyebrow uppercase text-ink-lo">
        {t(locale, 'cue.legend')}
      </span>
      {CUE_PALETTE.map((slot) => (
        <span key={slot.id} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ background: slot.hex }}
          />
          <span className="text-caption text-ink-mid">
            {t(locale, `cue.${slot.id}` as MsgKey)}
          </span>
        </span>
      ))}
    </div>
  );
}
