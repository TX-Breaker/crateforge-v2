import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Label } from '@/components/ui/misc';
import { useT } from '@/lib/strings';
import { cn } from '@/lib/utils';

export interface DangerFact {
  label: React.ReactNode;
  value: React.ReactNode;
  /** true quando il fatto è di per sé un problema (es. "Rekordbox aperto: sì") */
  warn?: boolean;
}

/**
 * Doppia conferma per azioni distruttive (§4.9). Regola invariata dalla V1:
 * il bottone si arma solo se la parola chiave è digitata ESATTAMENTE e la
 * casella è spuntata.
 *
 * Novità V2: il pannello dei fatti sopra l'input. Cosa sta per succedere, in
 * numeri, prima ancora che l'utente scriva la parola chiave.
 */
export function DangerConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  facts,
  confirmWord,
  confirmLabel,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  facts?: DangerFact[];
  /** es. "ELIMINA", "MASTERDB" */
  confirmWord: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const t = useT();
  const [pre, post] = t('c.typeToConfirm', { word: '\u0000' }).split('\u0000');
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState(false);
  const armed = typed.trim() === confirmWord && checked;

  const reset = () => {
    setTyped('');
    setChecked(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5 shrink-0" /> {title}
          </DialogTitle>
          {description && <DialogDescription asChild>
            <div className="space-y-2 text-caption">{description}</div>
          </DialogDescription>}
        </DialogHeader>

        {facts && facts.length > 0 && (
          <div className="divide-y divide-line-subtle rounded-card border border-line bg-surface-3">
            {facts.map((f, i) => (
              <div key={i} className="flex items-center justify-between gap-4 px-3.5 py-2">
                <span className="text-caption text-ink-mid">{f.label}</span>
                <span
                  className={cn(
                    'truncate text-right font-mono text-data tabular-nums',
                    f.warn ? 'text-warning' : 'text-ink-hi'
                  )}
                >
                  {f.value}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="confirm-word">
              {pre}
              <span className="font-mono font-bold text-destructive">{confirmWord}</span>
              {post}
            </Label>
            <Input
              id="confirm-word"
              mono
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              invalid={typed.length > 0 && typed.trim() !== confirmWord}
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-caption text-ink-mid">
            <Checkbox
              className="mt-px"
              checked={checked}
              onCheckedChange={(v) => setChecked(v === true)}
            />
            {t('c.understood')}
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('c.cancel')}
          </Button>
          <Button
            variant={armed ? 'destructive' : 'secondary'}
            size="lg"
            disabled={!armed}
            onClick={() => {
              reset();
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
