import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/misc';
import { useAppState } from '@/lib/appState';
import { t } from '@/lib/i18n';
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
  const { locale } = useAppState();
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={value} readOnly placeholder="—" mono={!!value} invalid={invalid} />
        <Button variant="secondary" onClick={onBrowse} className="shrink-0">
          <FolderOpen /> {t(locale, 'common.browse')}
        </Button>
      </div>
      {hint && <p className="text-caption text-ink-lo">{hint}</p>}
    </div>
  );
}

/** Riga introduttiva della pagina, sotto il titolo della topbar. */
export function PageIntro({ children }: { children: React.ReactNode }) {
  return <p className="max-w-3xl text-body text-ink-mid">{children}</p>;
}
