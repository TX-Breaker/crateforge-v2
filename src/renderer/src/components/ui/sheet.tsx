import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/strings';

/**
 * Pannello laterale: dove si apre uno strumento.
 *
 * Al posto delle finestre modali al centro dello schermo e delle pagine
 * dedicate. Lo strumento entra da destra e la schermata da cui lo si è aperto
 * resta visibile dietro: si capisce sempre dove si è e come si torna indietro.
 * Il piede tiene le azioni, sempre nello stesso posto.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  icon,
  children,
  footer,
  wide
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Più largo, per strumenti con tabelle. */
  wide?: boolean;
}) {
  const t = useT();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/40 duration-dialog ease-swift',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0'
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface-1 shadow-e3',
            wide ? 'max-w-[880px]' : 'max-w-[560px]',
            'duration-dialog ease-swift data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right'
          )}
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-line-subtle px-5 py-4">
            {icon && <span className="text-accent [&_svg]:size-[18px]">{icon}</span>}
            <DialogPrimitive.Title className="text-section text-ink-hi">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t('c.close')}
              className="ml-auto grid size-8 place-items-center rounded-control text-ink-lo transition-colors duration-press hover:bg-surface-hover hover:text-ink-hi"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && (
            <footer className="flex shrink-0 items-center gap-2 border-t border-line-subtle px-5 py-3">
              {footer}
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
