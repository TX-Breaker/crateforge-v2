import { CircleDot, Database, Eye, FolderSync, Radio } from 'lucide-react';
import { cn, shortenPath } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { useLibrary } from '@/lib/library';
import { useJobs } from '@/lib/jobs';
import { t } from '@/lib/i18n';
import { Tooltip } from '@/components/ui/misc';

/**
 * Statusbar (§3, 30px): stato del motore di lettura, database attivo, cartella
 * sorvegliata, riepilogo job, lingua. Sempre sincera — la degradazione (modalità
 * solo-XML) si mostra, non si nasconde.
 */
export function Statusbar() {
  const { locale } = useAppState();
  const { preflight, sidecar, xmlOnly, watcher } = useLibrary();
  const { running, queue } = useJobs();

  const engineOk = !!preflight?.ok && !!sidecar?.available;
  const engineTone = xmlOnly ? 'text-warning' : engineOk ? 'text-success' : 'text-warning';
  const engineLabel = xmlOnly
    ? t(locale, 'status.xmlOnly')
    : engineOk
      ? t(locale, 'status.engineReady')
      : t(locale, 'status.engineDegraded');

  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-5 border-t border-line-subtle bg-surface-1 px-6 text-caption text-ink-lo">
      <Tooltip content={preflight?.key.message ?? sidecar?.binaryPath ?? ''}>
        <span className={cn('flex items-center gap-1.5', engineTone)}>
          <Radio className="size-3" />
          {engineLabel}
        </span>
      </Tooltip>

      <span className="flex items-center gap-1.5">
        <Database className="size-3" />
        <span className="font-mono">UDM · udm.sqlite · WAL</span>
      </span>

      {watcher.running && watcher.folder && (
        <span className="flex items-center gap-1.5 text-ink-mid">
          <FolderSync className="size-3" />
          <span className="font-mono">{shortenPath(watcher.folder, 36)}</span>
        </span>
      )}

      <span className="ml-auto flex items-center gap-4">
        {running ? (
          <span className="flex items-center gap-1.5 text-accent">
            <CircleDot className="size-3" />
            {t(locale, 'status.jobsRunning')}
            {queue.length > 0 && ` · +${queue.length}`}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Eye className="size-3" />
            {t(locale, 'status.idle')}
          </span>
        )}
        <span className="font-mono uppercase">{locale}</span>
      </span>
    </footer>
  );
}
