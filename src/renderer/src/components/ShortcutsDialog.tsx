import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT, type StrKey } from '@/lib/strings';
import { isMac, shortcut } from '@/lib/platform';

/**
 * Cheatsheet delle scorciatoie (`?`). Le etichette sono risolte per
 * piattaforma: ⌘ su macOS, Ctrl su Windows, in ogni lingua.
 */
const ROWS: { keys: string; labelKey: StrKey }[] = [
  { keys: shortcut('K'), labelKey: 'shortcut.palette' },
  { keys: shortcut('B'), labelKey: 'shortcut.sidebar' },
  { keys: '?', labelKey: 'shortcut.help' },
  { keys: 'Esc', labelKey: 'shortcut.close' },
  { keys: isMac ? '⇧ + click' : 'Shift + click', labelKey: 'shortcut.range' },
  { keys: isMac ? '⌘ + click' : 'Ctrl + click', labelKey: 'shortcut.toggle' }
];

export function ShortcutsDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('shortcut.title')}</DialogTitle>
          <DialogDescription>{t('shortcut.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-line-subtle rounded-card border border-line">
          {ROWS.map((r) => (
            <div key={r.labelKey} className="flex items-center justify-between gap-4 px-3.5 py-2.5">
              <span className="text-body text-ink-mid">{t(r.labelKey)}</span>
              <kbd className="rounded-chip border border-line bg-surface-3 px-2 py-0.5 font-mono text-caption text-ink-hi">
                {r.keys}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
