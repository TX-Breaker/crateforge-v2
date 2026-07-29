import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn, formatClock } from '@/lib/utils';
import { useAppState } from '@/lib/appState';
import { t } from '@/lib/i18n';
import {
  filterNotifications,
  useNotifications,
  type NotifyFilter,
  type NotifyKind
} from '@/lib/notifications';

const ICON: Record<NotifyKind, React.ReactNode> = {
  info: <Info />,
  success: <CheckCircle2 />,
  warning: <AlertTriangle />,
  error: <XCircle />
};

const TONE: Record<NotifyKind, string> = {
  info: 'text-ink-lo',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive'
};

/**
 * Centro notifiche (§4.8): storico della SESSIONE. Il registro permanente vive
 * nella pagina Attività — questa lista è la memoria breve, non l'archivio.
 */
export function NotificationCenter() {
  const { locale } = useAppState();
  const { items, markAllRead, unread } = useNotifications();
  const [filter, setFilter] = useState<NotifyFilter>('all');
  const shown = filterNotifications(items, filter);

  const filters: { id: NotifyFilter; label: string }[] = [
    { id: 'all', label: t(locale, 'notif.all') },
    { id: 'jobs', label: t(locale, 'notif.jobs') },
    { id: 'warnings', label: t(locale, 'notif.warnings') },
    { id: 'errors', label: t(locale, 'notif.errors') }
  ];

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="flex items-center justify-between border-b border-line-subtle px-3.5 py-2.5">
        <span className="text-section text-ink-hi">{t(locale, 'notif.title')}</span>
        <button
          onClick={markAllRead}
          disabled={unread === 0}
          className="text-caption text-ink-lo transition-colors duration-press hover:text-ink-hi disabled:opacity-40"
        >
          {t(locale, 'notif.markAllRead')}
        </button>
      </div>

      <div className="flex gap-1 border-b border-line-subtle px-2.5 py-2">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full px-2.5 py-1 text-caption transition-colors duration-press',
              filter === f.id
                ? 'bg-accent/15 text-accent'
                : 'text-ink-lo hover:bg-surface-hover hover:text-ink-mid'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-3.5 py-8 text-center text-caption text-ink-lo">
            {t(locale, 'notif.empty')}
          </p>
        ) : (
          shown.map((n) => (
            <div
              key={n.id}
              className={cn(
                'flex gap-2.5 border-b border-line-subtle px-3.5 py-2.5 last:border-b-0',
                !n.read && 'bg-accent/[.04]'
              )}
            >
              <span className={cn('mt-0.5 shrink-0 [&_svg]:size-3.5', TONE[n.kind])}>
                {ICON[n.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-body text-ink-hi">{n.title}</div>
                {n.body && <div className="text-caption text-ink-mid">{n.body}</div>}
                {n.action && (
                  <button
                    onClick={n.action.run}
                    className="mt-1 text-caption text-accent transition-colors duration-press hover:text-accent-hover"
                  >
                    {n.action.label} →
                  </button>
                )}
              </div>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-lo">
                {formatClock(new Date(n.at).toISOString())}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-line-subtle px-3.5 py-2 text-caption text-ink-lo">
        {t(locale, 'notif.sessionOnly')}
      </div>
    </div>
  );
}
