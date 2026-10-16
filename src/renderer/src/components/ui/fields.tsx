import { useCallback, useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/misc';
import { useT } from '@/lib/strings';
import { cn } from '@/lib/utils';

/**
 * Campo percorso: sola lettura + "Sfoglia…". Il valore non si digita a mano
 * perché un percorso battuto a mano è un percorso sbagliato a metà.
 */
export function PathField({
  label,
  value,
  onBrowse,
  hint,
  invalid,
  className
}: {
  label: string;
  value: string;
  onBrowse: () => void;
  hint?: React.ReactNode;
  invalid?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={value} readOnly placeholder="—" mono={!!value} invalid={invalid} />
        <Button variant="secondary" onClick={onBrowse} className="shrink-0">
          <FolderOpen /> {t('c.browse')}
        </Button>
      </div>
      {hint && <p className="text-caption text-ink-lo">{hint}</p>}
    </div>
  );
}

/**
 * Cartella ricordata fra una sessione e l'altra: la cartella della musica o
 * quella della quarantena si scelgono una volta, non a ogni uso.
 */
export function useRememberedDir(key: string): [string, () => Promise<string | null>] {
  const [dir, setDir] = useState('');
  useEffect(() => {
    void window.crateforge.settings.get(`ui.${key}`).then((v) => setDir(v ?? ''));
  }, [key]);
  const pick = useCallback(async () => {
    const d = (await window.crateforge.dialog.openDirectory()) as string | null;
    if (d) {
      setDir(d);
      void window.crateforge.settings.set(`ui.${key}`, d);
    }
    return d;
  }, [key]);
  return [dir, pick];
}
