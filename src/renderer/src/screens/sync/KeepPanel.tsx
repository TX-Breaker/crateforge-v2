import { useCallback, useEffect, useState } from 'react';
import { Check, Crown, Disc3, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox, Notice, Segmented, Select, Switch } from '@/components/ui/misc';
import { ChoiceTile, InfoTip, InlineConfirm, Section } from '@/components/ui/page';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { useLibrary } from '@/lib/library';
import { useWorkspace } from '@/lib/workspace';
import { useT, type StrKey } from '@/lib/strings';
import { formatClock } from '@/lib/utils';

/**
 * Tieni allineati: quali programmi, chi comanda, cosa allineare. Poi «Allinea
 * ora» per vedere che cosa succede, e l'interruttore per farlo da solo ogni
 * volta che chiudi un programma.
 *
 * Il giro vero sta nel processo principale: rilegge le librerie, allinea e
 * scrive sul posto nei programmi che sa aggiornare. Qui si configura e si
 * racconta l'esito. I programmi che CrateForge non sa ancora aggiornare sul
 * posto sono marcati «solo invia», perché è quello che faranno.
 */

type Mode = 'symmetric' | 'masterSlave';
type Auto = Awaited<ReturnType<typeof window.crateforge.sync.autoConfig>>;
type Report = NonNullable<Awaited<ReturnType<typeof window.crateforge.sync.autoRunNow>>['report']>;

const LABEL: Record<string, string> = {
  rekordbox: 'Rekordbox',
  traktor: 'Traktor',
  virtualdj: 'VirtualDJ',
  serato: 'Serato DJ Pro 3',
  serato4: 'Serato DJ Pro 4',
  engine: 'Engine DJ'
};
/** Specchio di LIVE_WRITABLE nel main: chi sa ricevere sul posto. */
const RECEIVES = new Set(['traktor', 'virtualdj', 'engine', 'serato']);

const fieldLabel = (f: string) => `f.${f}` as StrKey;

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

export function KeepPanel() {
  const t = useT();
  const { push } = useNotifications();
  const { go } = useRouter();
  const { refresh } = useLibrary();
  const { refreshCounts } = useWorkspace();
  const [found, setFound] = useState<string[] | null>(null);
  const [auto, setAuto] = useState<Auto | null>(null);
  const [allFields, setAllFields] = useState<string[]>([]);
  const [directWrites, setDirectWrites] = useState(true);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [wholeField, setWholeField] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  /** Anteprima dell'ultimo «Allinea ora»: niente è scritto finché non si conferma. */
  const [preview, setPreview] = useState<Report | null>(null);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setConflicts(await window.crateforge.sync.conflicts(200));
    try {
      const a = await window.crateforge.sync.autoConfig();
      setAuto(a);
      if (a.status.lastReport) setReport(a.status.lastReport);
    } catch {
      setAuto(null);
    }
  }, []);

  useEffect(() => {
    void window.crateforge.detect
      .djSoftware()
      .then((d) => setFound(d.filter((x) => x.found).map((x) => x.id)));
    void window.crateforge.sync.fields().then((f) => setAllFields(f.all));
    void window.crateforge.settings.get('directWrites').then((v) => setDirectWrites(v === '1'));
    void reload();
  }, [reload]);

  if (!auto) return null;
  const cfg = auto.config;
  const fields = cfg.fields.length ? cfg.fields : ['bpm', 'musical_key', 'rating', 'track_color'];

  /* Ogni scelta si salva subito: è la configurazione che l'automatico userà. */
  const save = async (patch: Partial<Auto['config']>) => {
    const next = { ...cfg, fields, ...patch };
    if (next.mode === 'masterSlave' && (!next.master || !next.softwares.includes(next.master))) {
      next.master = next.softwares[0] ?? null;
    }
    const r = await window.crateforge.sync.autoSetConfig(next);
    setAuto(r);
    if (r.error) setError(r.error);
    else setError(null);
    setReport(null);
    setPreview(null);
  };

  const toggleProgram = (id: string) =>
    save({
      softwares: cfg.softwares.includes(id) ? cfg.softwares.filter((s) => s !== id) : [...cfg.softwares, id]
    });

  /* Passo 1: anteprima. Rilegge le librerie e dice che cosa cambierebbe in
     ogni programma, campo per campo. Non scrive niente. */
  const runPreview = async () => {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const r = await window.crateforge.sync.autoRunNow({ dryRun: true });
      if (!r.ok || !r.report) setError(r.message ?? t('c.error'));
      else {
        setPreview(r.report);
        await reload();
      }
    } finally {
      setBusy(false);
    }
  };

  /* Passo 2: la scrittura, solo dopo la conferma con la parola chiave. */
  const runWrite = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.crateforge.sync.autoRunNow();
      if (!r.ok || !r.report) setError(r.message ?? t('c.error'));
      else {
        setPreview(null);
        setReport(r.report);
        push({ kind: r.report.failed.length ? 'warning' : 'success', title: t('keep.done') });
        await refresh();
        await refreshCounts();
        await reload();
      }
    } finally {
      setBusy(false);
    }
  };

  const resetHistory = async () => {
    const r = await window.crateforge.sync.resetState();
    if (!r.ok) setError(r.message ?? t('c.error'));
    else {
      push({ kind: 'info', title: t('keep.resetDone') });
      setPreview(null);
      setReport(null);
      await reload();
    }
  };

  const fieldsText = (f: Record<string, number>) =>
    Object.entries(f)
      .map(([k, n]) => `${t(fieldLabel(k))} ${n}`)
      .join(', ');

  const resolve = async (id: number, choice: 'a' | 'b' | 'skip') => {
    await window.crateforge.sync.resolveConflict(id, choice, wholeField ? 'field' : 'one');
    await reload();
  };

  const programs = [...new Set([...(found ?? []), ...cfg.softwares])].filter((p) => LABEL[p]);
  const chosen = cfg.softwares;
  const readOnlyChosen = chosen.filter((s) => !RECEIVES.has(s));
  const ready = chosen.length >= 2 && (cfg.mode === 'symmetric' || !!cfg.master);

  return (
    <div className="space-y-6">
      <Section
        title={t('keep.programs')}
        tip={programs.some((p) => !RECEIVES.has(p)) ? t('keep.readOnlyTip') : undefined}
      >
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((p) => (
              <ChoiceTile
                key={p}
                selected={chosen.includes(p)}
                onClick={() => void toggleProgram(p)}
                icon={cfg.mode === 'masterSlave' && cfg.master === p ? <Crown /> : <Disc3 />}
                title={LABEL[p]}
                hint={RECEIVES.has(p) ? t('keep.receives') : t('keep.readOnly')}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Segmented<Mode>
              value={cfg.mode}
              onChange={(mode) => void save({ mode })}
              options={[
                {
                  value: 'masterSlave',
                  label: t('keep.master'),
                  icon: <Crown />
                },
                {
                  value: 'symmetric',
                  label: t('keep.peers'),
                  icon: <RefreshCw />
                }
              ]}
            />
            <InfoTip text={t(cfg.mode === 'masterSlave' ? 'keep.masterTip' : 'keep.peersTip')} />
            {cfg.mode === 'masterSlave' && chosen.length > 0 && (
              <span className="flex items-center gap-2">
                <span className="text-caption text-ink-mid">{t('keep.whichMaster')}</span>
                <Select
                  className="min-w-[180px]"
                  value={cfg.master ?? ''}
                  label={t('keep.whichMaster')}
                  onValueChange={(master) => void save({ master })}
                  options={chosen.map((c) => ({
                    value: c,
                    label: LABEL[c] ?? c
                  }))}
                />
              </span>
            )}
          </div>

          {cfg.mode === 'symmetric' &&
            readOnlyChosen.map((s) => (
              <p key={s} className="text-caption text-warning">
                {t('keep.peerReadOnly', { name: LABEL[s] ?? s })}
              </p>
            ))}
          {cfg.mode === 'masterSlave' && cfg.master && !RECEIVES.has(cfg.master) && (
            <p className="text-caption text-ink-lo">
              {t('keep.masterReadOnlyOk', {
                name: LABEL[cfg.master] ?? cfg.master
              })}
            </p>
          )}

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
                    onClick={() =>
                      void save({
                        fields: on ? fields.filter((x) => x !== f) : [...fields, f]
                      })
                    }
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

          {!directWrites && (
            <Notice
              variant="warning"
              actions={
                <Button size="sm" variant="secondary" onClick={() => go('settings', 'safety')}>
                  {t('nav.settings')}
                </Button>
              }
            >
              {t('keep.needWrites')}
            </Notice>
          )}
          {!ready && <p className="text-caption text-ink-lo">{t('keep.pickTwo')}</p>}
          {error && <Notice variant="destructive">{error}</Notice>}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              variant={preview ? 'secondary' : 'primary'}
              disabled={!ready}
              working={busy && !preview}
              onClick={runPreview}
            >
              <RefreshCw /> {t('keep.runNow')}
            </Button>
            <span className="text-caption text-ink-lo">{t('keep.closeFirst')}</span>
            <span className="ml-auto flex items-center gap-1">
              <InlineConfirm size="sm" variant="ghost" onConfirm={() => void resetHistory()}>
                {t('keep.reset')}
              </InlineConfirm>
              <InfoTip text={t('keep.resetTip')} />
            </span>
          </div>

          {preview && (
            <div className="space-y-2 rounded-card border border-accent/40 bg-accent/5 px-4 py-3 text-caption">
              <p className="text-body font-medium text-ink-hi">{t('keep.preview.title')}</p>
              {preview.planned.length === 0 ? (
                <p className="flex items-center gap-1.5 text-success">
                  <Check className="size-3.5" /> {t('keep.preview.nothing')}
                </p>
              ) : (
                preview.planned.map((p) => (
                  <p key={p.software} className="text-ink-hi">
                    {t('keep.preview.line', {
                      name: LABEL[p.software] ?? p.software,
                      fields: fieldsText(p.fields),
                      n: p.tracks
                    })}
                  </p>
                ))
              )}
              {preview.conflicts > 0 && (
                <p className="text-warning">{t('keep.preview.conflicts', { n: preview.conflicts })}</p>
              )}
              {preview.excluded.map((e) => (
                <p key={e.software} className="text-warning">
                  {t('keep.r.excluded', { name: LABEL[e.software] ?? e.software, reason: e.reason })}
                </p>
              ))}
              {preview.planned.length > 0 && (
                <div className="pt-1">
                  <Button variant="primary" working={busy} onClick={() => setConfirmWrite(true)}>
                    {t('keep.write')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {report && <ReportView report={report} />}

          <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
            <label className="flex items-center gap-2.5 text-body text-ink-hi">
              <Switch
                checked={cfg.enabled}
                disabled={!cfg.enabled && (!ready || !auto.confirmed)}
                onCheckedChange={(enabled) => void save({ enabled })}
              />
              {t('keep.auto')}
            </label>
            <InfoTip text={t('keep.autoTip')} />
            {!cfg.enabled && !auto.confirmed && ready && (
              <span className="text-caption text-ink-lo">{t('keep.autoNeedsRun')}</span>
            )}
            {cfg.enabled && (
              <Button size="sm" variant="ghost" onClick={() => void save({ paused: !cfg.paused })}>
                {cfg.paused ? t('sync.resume') : t('sync.pause')}
              </Button>
            )}
            {auto.status.lastRunAt && (
              <span className="text-caption text-ink-lo">
                {t('sync.lastRun', {
                  when: formatClock(new Date(auto.status.lastRunAt).toISOString())
                })}
              </span>
            )}
            {cfg.enabled && auto.status.lastDecision && !auto.status.lastDecision.run && (
              <span className="text-caption text-ink-lo">
                {t(`sync.reason.${auto.status.lastDecision.reason}` as StrKey)}
              </span>
            )}
          </div>
        </div>
      </Section>

      <DangerConfirmDialog
        open={confirmWrite}
        onOpenChange={setConfirmWrite}
        title={t('keep.confirmTitle')}
        description={t('keep.confirmBody')}
        facts={(preview?.planned ?? []).map((p) => ({
          label: LABEL[p.software] ?? p.software,
          value: fieldsText(p.fields),
          warn: true
        }))}
        confirmWord="SCRIVI"
        confirmLabel={t('keep.confirmBtn')}
        onConfirm={() => void runWrite()}
      />

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
            {conflicts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-body text-ink-hi">
                  {[c.artist, c.title].filter(Boolean).join(' — ') || '—'}
                </span>
                <span className="w-24 text-caption text-ink-lo">{t(fieldLabel(c.field))}</span>
                <Button size="sm" variant="secondary" onClick={() => resolve(c.id, 'a')} title={c.aSoftware}>
                  <span className="max-w-[140px] truncate font-mono">{c.aValue ?? '—'}</span>
                </Button>
                <Button size="sm" variant="secondary" onClick={() => resolve(c.id, 'b')} title={c.bSoftware}>
                  <span className="max-w-[140px] truncate font-mono">{c.bValue ?? '—'}</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => resolve(c.id, 'skip')}>
                  {t('sync.skip')}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function ReportView({ report }: { report: Report }) {
  const t = useT();
  const name = (s: string) => LABEL[s] ?? s;
  const writes = report.written.filter((w) => w.tracks > 0);
  return (
    <div className="space-y-1 rounded-card border border-line-subtle bg-surface-2 px-4 py-3 text-caption">
      <p className="text-ink-mid">{t('keep.r.reread', { list: report.reread.map(name).join(', ') })}</p>
      {report.aligned === 0 && writes.length === 0 ? (
        <p className="flex items-center gap-1.5 text-success">
          <Check className="size-3.5" /> {t('keep.r.nothing')}
        </p>
      ) : (
        <>
          <p className="text-ink-hi">{t('keep.r.aligned', { n: report.aligned })}</p>
          {writes.map((w) => (
            <p key={w.software} className="text-ink-hi">
              {t('keep.r.written', { name: name(w.software), n: w.tracks })}
            </p>
          ))}
        </>
      )}
      {report.failed.map((f) => (
        <p key={`f${f.software}`} className="text-destructive">
          {t('keep.r.failed', { name: name(f.software), reason: f.message })}
        </p>
      ))}
      {report.excluded.map((e) => (
        <p key={e.software} className="text-warning">
          {t('keep.r.excluded', { name: name(e.software), reason: e.reason })}
        </p>
      ))}
      {report.notPropagated.length > 0 && (
        <p className="text-ink-lo">
          {t('keep.r.notPropagated', {
            list: report.notPropagated.map((f) => t(fieldLabel(f))).join(', ')
          })}
        </p>
      )}
    </div>
  );
}
