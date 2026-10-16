import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox, Notice, Segmented, Switch } from '@/components/ui/misc';
import { InfoTip, Section } from '@/components/ui/page';
import { useAppState } from '@/lib/appState';
import { useNotifications } from '@/lib/notifications';
import { useT, type StrKey } from '@/lib/strings';
import { SOFTWARE_LABEL, SOURCES_OF, type SoftwareId } from '@/lib/workspace';
import { formatClock } from '@/lib/utils';

/**
 * Due librerie allineate nel tempo: cosa allineare, in che direzione, «Allinea
 * ora», e l'interruttore dell'automatico. I conflitti — lo stesso campo
 * cambiato da due parti — si decidono qui sotto, uno per riga.
 *
 * Tocca solo l'archivio di CrateForge: verso i programmi DJ si passa da
 * Converti, che ha i suoi gate. Per questo qui non c'è una parola da digitare.
 */

type Mode = 'symmetric' | 'masterSlave';

interface Summary {
  toA: number;
  toB: number;
  conflicts: number;
  touched: number;
}

interface Conflict {
  id: number;
  field: string;
  aSoftware: string;
  aValue: string | null;
  bSoftware: string;
  bValue: string | null;
  title: string | null;
  artist: string | null;
}

type Auto = Awaited<ReturnType<typeof window.crateforge.sync.autoConfig>>;

const fieldLabel = (f: string) => `f.${f}` as StrKey;

export function KeepPanel({ a, b }: { a: SoftwareId | null; b: SoftwareId | null }) {
  const t = useT();
  const { locale } = useAppState();
  const { push } = useNotifications();
  const [allFields, setAllFields] = useState<string[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('symmetric');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [auto, setAuto] = useState<Auto | null>(null);
  const [wholeField, setWholeField] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setConflicts(await window.crateforge.sync.conflicts(200));
    try {
      setAuto(await window.crateforge.sync.autoConfig());
    } catch {
      setAuto(null);
    }
  }, []);

  useEffect(() => {
    void window.crateforge.sync.fields().then((f) => {
      setAllFields(f.all);
      setFields(f.defaults);
    });
    void reload();
  }, [reload]);

  useEffect(() => setSummary(null), [a, b, mode, fields]);

  const ready = !!a && !!b && a !== b && fields.length > 0;
  const opts = () => ({ aSources: SOURCES_OF[a!], bSources: SOURCES_OF[b!], mode, fields });

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.crateforge.sync.planLibrary(opts());
      if (!r.ok) setError(r.message ?? t('c.error'));
      else setSummary(r.summary ?? null);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.crateforge.sync.applyLibrary(opts());
      if (!r.ok) setError(r.message ?? t('c.error'));
      else {
        push({ kind: 'success', title: t('sync.applied', { n: r.written ?? 0 }) });
        setSummary(null);
        await reload();
      }
    } finally {
      setBusy(false);
    }
  };

  const setAutoOn = async (on: boolean) => {
    setAuto(
      await window.crateforge.sync.autoSetConfig(
        on && a && b
          ? { enabled: true, softwares: [a, b], fields, mode, master: mode === 'masterSlave' ? a : null }
          : { enabled: on }
      )
    );
  };

  const resolve = async (id: number, choice: 'a' | 'b' | 'skip') => {
    await window.crateforge.sync.resolveConflict(id, choice, wholeField ? 'field' : 'one');
    await reload();
  };

  const swLabel = (src: string) =>
    (Object.keys(SOURCES_OF) as SoftwareId[]).find((s) => SOURCES_OF[s].includes(src) || s === src);

  return (
    <div className="space-y-6">
      <Section>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="text-caption text-ink-mid">{t('sync.fields')}</div>
            <div className="flex flex-wrap gap-1.5">
              {allFields.map((f) => {
                const on = fields.includes(f);
                return (
                  <button
                    key={f}
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => setFields((p) => (on ? p.filter((x) => x !== f) : [...p, f]))}
                    className={
                      on
                        ? 'rounded-chip border border-accent bg-accent/10 px-2.5 py-1 text-caption text-ink-hi'
                        : 'rounded-chip border border-line-subtle px-2.5 py-1 text-caption text-ink-mid hover:border-line-strong'
                    }
                  >
                    {t(fieldLabel(f))}
                  </button>
                );
              })}
            </div>
          </div>

          {a && (
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'symmetric', label: t('sync.both') },
                { value: 'masterSlave', label: t('sync.oneWay', { name: SOFTWARE_LABEL[a] }) }
              ]}
            />
          )}

          {!ready && <p className="text-caption text-ink-lo">{t('sync.pickTwo')}</p>}
          {error && <Notice variant="destructive">{error}</Notice>}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant={summary ? 'secondary' : 'primary'} disabled={!ready} working={busy && !summary} onClick={preview}>
              <RefreshCw /> {t('sync.now')}
            </Button>
            {summary &&
              (summary.touched === 0 && summary.conflicts === 0 ? (
                <span className="flex items-center gap-1 text-body text-success">
                  <Check className="size-4" /> {t('sync.inSync')}
                </span>
              ) : (
                <>
                  <span className="text-body text-ink-mid">
                    {t('sync.preview', {
                      toA: summary.toA.toLocaleString(locale),
                      a: SOFTWARE_LABEL[a!],
                      toB: summary.toB.toLocaleString(locale),
                      b: SOFTWARE_LABEL[b!],
                      conflicts: summary.conflicts
                    })}
                  </span>
                  <Button variant="primary" working={busy} onClick={apply}>
                    {t('sync.apply')}
                  </Button>
                </>
              ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
            <label className="flex items-center gap-2.5 text-body text-ink-hi">
              <Switch
                checked={!!auto?.config.enabled}
                disabled={!auto || (!auto.config.enabled && !ready)}
                onCheckedChange={(v) => void setAutoOn(v)}
              />
              {t('sync.auto')}
            </label>
            <InfoTip text={t('sync.autoTip')} />
            {auto?.config.enabled && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => setAuto(await window.crateforge.sync.autoSetConfig({ paused: !auto.config.paused }))}
              >
                {auto.config.paused ? t('sync.resume') : t('sync.pause')}
              </Button>
            )}
            {auto?.status.lastRunAt && (
              <span className="text-caption text-ink-lo">
                {t('sync.lastRun', { when: formatClock(new Date(auto.status.lastRunAt).toISOString()) })}
              </span>
            )}
            {auto?.config.enabled && auto.status.lastDecision && !auto.status.lastDecision.run && (
              <span className="text-caption text-ink-lo">{auto.status.lastDecision.message}</span>
            )}
          </div>
        </div>
      </Section>

      {conflicts.length > 0 && (
        <Section
          title={`${t('sync.conflicts')} · ${conflicts.length}`}
          actions={
            <label className="flex cursor-pointer items-center gap-2 text-caption text-ink-mid">
              <Checkbox checked={wholeField} onCheckedChange={(v) => setWholeField(v === true)} />
              {t('sync.wholeField')}
            </label>
          }
        >
          <ul className="divide-y divide-line-subtle">
            {conflicts.map((c) => {
              const la = swLabel(c.aSoftware);
              const lb = swLabel(c.bSoftware);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-body text-ink-hi">
                    {[c.artist, c.title].filter(Boolean).join(' — ') || '—'}
                  </span>
                  <span className="w-24 text-caption text-ink-lo">{t(fieldLabel(c.field))}</span>
                  <Button size="sm" variant="secondary" onClick={() => resolve(c.id, 'a')} title={la ? SOFTWARE_LABEL[la] : c.aSoftware}>
                    <span className="max-w-[140px] truncate font-mono">{c.aValue ?? '—'}</span>
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => resolve(c.id, 'b')} title={lb ? SOFTWARE_LABEL[lb] : c.bSoftware}>
                    <span className="max-w-[140px] truncate font-mono">{c.bValue ?? '—'}</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => resolve(c.id, 'skip')}>
                    {t('sync.skip')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
