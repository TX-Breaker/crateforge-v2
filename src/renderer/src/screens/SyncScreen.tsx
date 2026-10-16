import { useEffect, useState } from 'react';
import { ArrowRightLeft, Disc3, Library, RefreshCw } from 'lucide-react';
import { Segmented } from '@/components/ui/misc';
import { ChoiceTile, PageHeader, Section } from '@/components/ui/page';
import { useAppState } from '@/lib/appState';
import { useT } from '@/lib/strings';
import { SOFTWARE, SOFTWARE_LABEL, useWorkspace, type SoftwareId } from '@/lib/workspace';
import { ConvertPanel } from './sync/ConvertPanel';
import { KeepPanel } from './sync/KeepPanel';

/**
 * Sincronizza: da dove, verso dove, e un pulsante.
 *
 * Prima erano due pagine (conversione e sincronizzazione) con una matrice di
 * compatibilità, schede per formato e una sorgente da scegliere due volte.
 * Ora la scelta «Da → A» è una sola, in alto, e vale per entrambe le cose:
 * convertire una volta, o tenere allineate due librerie nel tempo.
 */

export type From = SoftwareId | 'all';

export function SyncScreen() {
  const t = useT();
  const { locale } = useAppState();
  const { counts, refreshCounts, scope } = useWorkspace();
  const [mode, setMode] = useState<'once' | 'keep'>('once');
  const [from, setFrom] = useState<From>(scope);
  const [to, setTo] = useState<SoftwareId | null>(null);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  const tracksOf = (s: SoftwareId) => counts?.bySoftware[s]?.tracks ?? 0;
  const withData = SOFTWARE.filter((s) => tracksOf(s) > 0);
  const fromOptions: From[] = mode === 'once' ? ['all', ...withData] : withData;
  const toOptions = SOFTWARE.filter((s) => s !== from && (mode === 'once' || tracksOf(s) > 0));

  /* Una scelta che la modalità nuova non ammette si scioglie da sola, invece
     di restare evidenziata e inerte. */
  useEffect(() => {
    if (!fromOptions.includes(from)) setFrom(fromOptions[0] ?? 'all');
    if (to && !toOptions.includes(to)) setTo(null);
  }, [mode, from, to, fromOptions.join(), toOptions.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const hint = (s: SoftwareId) =>
    tracksOf(s) > 0 ? `${tracksOf(s).toLocaleString(locale)} ${t('c.tracks')}` : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.sync')}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'once', label: t('sync.once'), icon: <ArrowRightLeft /> },
            { value: 'keep', label: t('sync.keep'), icon: <RefreshCw /> }
          ]}
        />
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t('sync.from')}>
          <div className="grid gap-2 sm:grid-cols-2">
            {fromOptions.map((s) => (
              <ChoiceTile
                key={s}
                selected={from === s}
                onClick={() => setFrom(s)}
                icon={s === 'all' ? <Library /> : <Disc3 />}
                title={s === 'all' ? t('sync.everything') : SOFTWARE_LABEL[s]}
                hint={s === 'all' ? undefined : hint(s)}
              />
            ))}
          </div>
        </Section>
        <Section title={t('sync.to')}>
          <div className="grid gap-2 sm:grid-cols-2">
            {toOptions.map((s) => (
              <ChoiceTile
                key={s}
                selected={to === s}
                onClick={() => setTo(s)}
                icon={<Disc3 />}
                title={SOFTWARE_LABEL[s]}
                hint={hint(s)}
              />
            ))}
          </div>
        </Section>
      </div>

      {mode === 'once' ? (
        <ConvertPanel from={from} to={to} counts={counts} />
      ) : (
        <KeepPanel a={from === 'all' ? null : from} b={to} />
      )}
    </div>
  );
}
