import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';

/**
 * Notifiche (§4.8). Regola di prodotto: i toast riportano ESITI. Un limite
 * dichiarato o un rischio non diventa mai un toast — resta inline e persistente
 * sulla pagina, dove l'utente deve leggerlo prima di agire.
 *
 * Il centro notifiche conserva lo storico della sessione; il registro permanente
 * resta la pagina Attività (oplog nell'UDM).
 */

export type NotifyKind = 'info' | 'success' | 'warning' | 'error';
export type NotifyFilter = 'all' | 'jobs' | 'warnings' | 'errors';

export interface Notification {
  id: number;
  kind: NotifyKind;
  title: string;
  body?: string;
  at: number;
  read: boolean;
  /** true se nasce da un job: alimenta il filtro "Job" */
  job?: boolean;
  action?: { label: string; run: () => void };
}

interface NotifyApi {
  items: Notification[];
  unread: number;
  push: (n: Omit<Notification, 'id' | 'at' | 'read'>) => void;
  markAllRead: () => void;
  clear: () => void;
}

const Ctx = createContext<NotifyApi | null>(null);

let seq = 0;

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Notification[]>([]);

  const push = useCallback<NotifyApi['push']>((n) => {
    const item: Notification = { ...n, id: ++seq, at: Date.now(), read: false };
    setItems((prev) => [item, ...prev].slice(0, 200));

    // Il toast è la forma effimera della stessa notizia: stesso testo, stessa
    // azione, nessuna informazione che esista solo qui.
    const opts = {
      description: n.body,
      duration: n.kind === 'error' ? 8000 : 4500,
      action: n.action ? { label: n.action.label, onClick: n.action.run } : undefined
    };
    if (n.kind === 'success') toast.success(n.title, opts);
    else if (n.kind === 'warning') toast.warning(n.title, opts);
    else if (n.kind === 'error') toast.error(n.title, opts);
    else toast(n.title, opts);
  }, []);

  const value = useMemo<NotifyApi>(
    () => ({
      items,
      unread: items.filter((i) => !i.read).length,
      push,
      markAllRead: () => setItems((prev) => prev.map((i) => ({ ...i, read: true }))),
      clear: () => setItems([])
    }),
    [items, push]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): NotifyApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNotifications fuori dal provider');
  return v;
}

export function filterNotifications(items: Notification[], f: NotifyFilter): Notification[] {
  if (f === 'jobs') return items.filter((i) => i.job);
  if (f === 'warnings') return items.filter((i) => i.kind === 'warning');
  if (f === 'errors') return items.filter((i) => i.kind === 'error');
  return items;
}
