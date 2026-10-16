import { useEffect, useState } from 'react';
import { Globe, Tags } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { EmptyState, Notice, Segmented } from '@/components/ui/misc';
import { InfoTip } from '@/components/ui/page';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { useT } from '@/lib/strings';
import { CheckRow, RowList, SelectBar, toggleIn } from './parts';

/**
 * Genere e anno dai cataloghi online. Le proposte si applicano in CrateForge;
 * scriverle nei file audio resta possibile solo con le scritture dirette
 * attive e la parola chiave.
 */

interface Proposal {
  trackId: number;
  artist: string;
  title: string;
  field: 'year' | 'genre';
  current: string | null;
  proposed: string;
  source: string;
}

type Provider = 'musicbrainz' | 'discogs';

export function TagsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const { run } = useJobs();
  const { push } = useNotifications();
  const { refresh } = useLibrary();
  const [provider, setProvider] = useState<Provider>('musicbrainz');
  const [hasToken, setHasToken] = useState(false);
  const [directWrites, setDirectWrites] = useState(false);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOrig, setConfirmOrig] = useState(false);

  useEffect(() => {
    if (!open) return;
    void window.crateforge.settings.get('directWrites').then((v) => setDirectWrites(v === '1'));
    void window.crateforge.settings.get('discogsToken').then((v) => setHasToken(!!v));
  }, [open]);

  const find = async () => {
    setBusy(true);
    setError(null);
    setProposals(null);
    try {
      const r = (await run(t('fix.a.find'), () => window.crateforge.tagger.propose(50, provider))) as {
        ok: boolean;
        message?: string;
        proposals: Proposal[];
      };
      if (!r.ok) setError(r.message ?? t('c.error'));
      else {
        setProposals(r.proposals);
        setChecked(new Set(r.proposals.map((_, i) => i)));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const chosen = () => (proposals ?? []).filter((_, i) => checked.has(i));

  const applyUdm = async () => {
    const r = (await window.crateforge.tagger.apply(chosen(), 'udm')) as { applied: number };
    push({ kind: 'success', title: t('tag.applied', { n: r.applied }), body: t('tag.where') });
    setProposals(null);
    await refresh();
  };

  const applyOriginal = async () => {
    /* Non annullabile: la scrittura entra nei file audio e il ripristino vive
       nel sidecar, che un processo terminato a forza non esegue. */
    const r = (await run(t('tag.origBtn'), () => window.crateforge.tagger.apply(chosen(), 'original'), {
      cancellable: false
    })) as { ok: boolean; message?: string; written: number; failed?: number; backupDir?: string };
    if (!r.ok) {
      setError(r.message ?? t('c.error'));
      return;
    }
    push({
      kind: 'warning',
      job: true,
      title: t('tag.origDone', { n: r.written, failed: r.failed ?? 0 }),
      body: r.backupDir
    });
    setProposals(null);
    await refresh();
  };

  const needToken = provider === 'discogs' && !hasToken;

  return (
    <Sheet
      wide
      open={open}
      onOpenChange={onOpenChange}
      title={t('fix.a.find')}
      icon={<Tags />}
      footer={
        proposals && proposals.length > 0 ? (
          <>
            {directWrites && (
              <Button variant="ghost" disabled={checked.size === 0} onClick={() => setConfirmOrig(true)}>
                {t('tag.applyOrig', { n: checked.size })}
              </Button>
            )}
            <Button variant="primary" disabled={checked.size === 0} onClick={applyUdm}>
              {t('tag.apply', { n: checked.size })}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-caption text-ink-mid">{t('tag.source')}</span>
          <Segmented
            value={provider}
            onChange={setProvider}
            options={[
              { value: 'musicbrainz', label: 'MusicBrainz' },
              { value: 'discogs', label: 'Discogs' }
            ]}
          />
          <Button variant="primary" onClick={find} working={busy} disabled={needToken}>
            <Globe /> {t('tag.find')}
          </Button>
          <InfoTip text={t('tag.where')} />
        </div>
        {needToken && <Notice variant="warning">{t('tag.needToken')}</Notice>}
        {error && <Notice variant="destructive">{error}</Notice>}

        {proposals && proposals.length === 0 && (
          <EmptyState title={t('tag.none')} action={<Button variant="secondary" onClick={find}>{t('c.retry')}</Button>} />
        )}

        {proposals && proposals.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-body font-medium text-ink-hi">{t('tag.found', { n: proposals.length })}</span>
              <SelectBar
                count={checked.size}
                onAll={() => setChecked(new Set(proposals.map((_, i) => i)))}
                onNone={() => setChecked(new Set())}
              />
            </div>
            <RowList>
              {proposals.map((p, i) => (
                <CheckRow
                  key={`${p.trackId}-${p.field}-${i}`}
                  checked={checked.has(i)}
                  onToggle={() => setChecked((s) => toggleIn(s, i))}
                  aside={
                    <span className="flex shrink-0 items-center gap-2 font-mono text-caption">
                      <span className="w-12 text-ink-lo">{t(p.field === 'genre' ? 'tag.f.genre' : 'tag.f.year')}</span>
                      <span className="w-24 truncate text-right text-ink-lo">{p.current ?? '—'}</span>
                      <span className="text-ink-lo">→</span>
                      <span className="w-28 truncate text-accent">{p.proposed}</span>
                    </span>
                  }
                >
                  {p.artist} — {p.title}
                </CheckRow>
              ))}
            </RowList>
          </div>
        )}
      </div>

      <DangerConfirmDialog
        open={confirmOrig}
        onOpenChange={setConfirmOrig}
        title={t('tag.origTitle', { n: checked.size })}
        description={t('tag.origBody')}
        confirmWord="SCRIVI"
        confirmLabel={t('tag.origBtn')}
        onConfirm={applyOriginal}
      />
    </Sheet>
  );
}
