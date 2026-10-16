import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Keyboard, Monitor, Moon, RefreshCw, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Notice, Segmented, Select, Switch } from '@/components/ui/misc';
import { InfoTip, PageHeader, Section } from '@/components/ui/page';
import { CrateStack } from '@/components/Brand';
import { useAppState, type Theme, type ThemeStyle } from '@/lib/appState';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { useRouter } from '@/lib/router';
import { LOCALES, useT, type StrKey } from '@/lib/strings';
import { cn, shortenPath } from '@/lib/utils';
import logoUrl from '../../../../assets/branding/rekordbox-dj-italia-logo.svg';

/**
 * Impostazioni: quattro schede corte. Ogni riga è un'etichetta e il suo
 * controllo; la spiegazione, quando serve, sta nell'icona ⓘ.
 */

type Tab = 'general' | 'safety' | 'versions' | 'about';

export function SettingsScreen() {
  const t = useT();
  const { tab, setTab } = useRouter();
  const current: Tab = tab === 'safety' || tab === 'versions' || tab === 'about' ? tab : 'general';
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.settings')}>
        <Segmented
          value={current}
          onChange={(v) => setTab(v)}
          options={[
            { value: 'general', label: t('set.t.general') },
            { value: 'safety', label: t('set.t.safety') },
            { value: 'versions', label: t('set.t.versions') },
            { value: 'about', label: t('set.t.about') }
          ]}
        />
      </PageHeader>
      {current === 'general' && <General />}
      {current === 'safety' && <Safety />}
      {current === 'versions' && <Versions />}
      {current === 'about' && <About />}
    </div>
  );
}

function Row({ label, tip, hint, children }: { label: string; tip?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-body text-ink-hi">
          {label} {tip && <InfoTip text={tip} />}
        </div>
        {hint && <div className="text-caption text-ink-lo">{hint}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function General() {
  const t = useT();
  const { locale, setLocale, theme, setTheme, themeStyle, setThemeStyle, density, setDensity, motion, setMotion, setOnboarded } =
    useAppState();
  const { watcher } = useLibrary();
  const { push } = useNotifications();
  const [folder, setFolder] = useState(watcher.folder ?? '');
  const [running, setRunning] = useState(watcher.running);

  useEffect(() => {
    setFolder(watcher.folder ?? '');
    setRunning(watcher.running);
  }, [watcher.folder, watcher.running]);

  const pickFolder = async () => {
    const d = (await window.crateforge.dialog.openDirectory()) as string | null;
    if (!d) return;
    setFolder(d);
    if (running) {
      await window.crateforge.watcher.stop();
      const r = (await window.crateforge.watcher.start(d)) as { added: number };
      push({ kind: 'info', title: t('st.watchFound', { n: r.added }) });
    }
  };

  const toggleWatch = async (on: boolean) => {
    if (on) {
      if (!folder) return;
      const r = (await window.crateforge.watcher.start(folder)) as { added: number };
      push({ kind: 'info', title: t('st.watchFound', { n: r.added }) });
    } else {
      await window.crateforge.watcher.stop();
    }
    setRunning(on);
  };

  const scan = async () => {
    const r = (await window.crateforge.watcher.scan(folder)) as { added: number };
    push({ kind: 'info', title: t('st.watchFound', { n: r.added }) });
  };

  return (
    <Section>
      <div className="divide-y divide-line-subtle">
        <Row label={t('st.language')}>
          <Segmented value={locale} onChange={setLocale} options={LOCALES.map((l) => ({ value: l.id, label: l.label }))} />
        </Row>
        <Row label={t('st.theme')}>
          <Segmented<Theme>
            value={themeStyle === 'oled' ? 'dark' : theme}
            onChange={setTheme}
            disabled={themeStyle === 'oled'}
            options={[
              { value: 'light', label: t('st.light'), icon: <Sun /> },
              { value: 'dark', label: t('st.dark'), icon: <Moon /> },
              { value: 'system', label: t('st.auto'), icon: <Monitor /> }
            ]}
          />
        </Row>
        <Row label={t('st.style')}>
          <Select
            className="min-w-[180px]"
            value={themeStyle}
            label={t('st.style')}
            onValueChange={(v) => setThemeStyle(v as ThemeStyle)}
            options={[
              { value: 'studio', label: t('st.studio') },
              { value: 'neutral', label: t('st.neutral') },
              { value: 'oled', label: t('st.oled') }
            ]}
          />
        </Row>
        <Row label={t('st.density')}>
          <Switch aria-label={t('st.density')} checked={density === 'compact'} onCheckedChange={(v) => setDensity(v ? 'compact' : 'comfortable')} />
        </Row>
        <Row label={t('st.motion')}>
          <Switch aria-label={t('st.motion')} checked={motion === 'reduce'} onCheckedChange={(v) => setMotion(v ? 'reduce' : 'system')} />
        </Row>
        <Row label={t('st.watch')} tip={t('st.watchTip')} hint={folder ? shortenPath(folder, 60) : undefined}>
          <Button size="sm" variant="ghost" onClick={pickFolder}>
            <FolderOpen /> {t('c.choose')}
          </Button>
          {folder && (
            <Button size="sm" variant="ghost" onClick={scan}>
              {t('st.watchScan')}
            </Button>
          )}
          <Switch checked={running} disabled={!folder} onCheckedChange={(v) => void toggleWatch(v)} aria-label={t('st.watchOn')} />
        </Row>
        <Row label={t('st.shortcuts')}>
          <Button size="sm" variant="secondary" onClick={() => window.dispatchEvent(new Event('crateforge:shortcuts'))}>
            <Keyboard /> {t('c.open')}
          </Button>
        </Row>
        <Row label={t('st.rerun')}>
          <Button size="sm" variant="secondary" onClick={() => setOnboarded(false)}>
            <RefreshCw /> {t('c.open')}
          </Button>
        </Row>
      </div>
    </Section>
  );
}

function Safety() {
  const t = useT();
  const [direct, setDirect] = useState(false);
  const [masterDb, setMasterDb] = useState(false);
  const [token, setToken] = useState('');

  useEffect(() => {
    void window.crateforge.settings.get('directWrites').then((v) => setDirect(v === '1'));
    void window.crateforge.settings.get('masterDbWrites').then((v) => setMasterDb(v === '1'));
    void window.crateforge.settings.get('discogsToken').then((v) => setToken(v ?? ''));
  }, []);

  /* I gate passano da un canale dedicato con conferma NATIVA nel processo
     principale: qui si chiede soltanto, e si mostra l'esito vero. */
  const gate = async (key: 'directWrites' | 'masterDbWrites', on: boolean) => {
    const r = await window.crateforge.security.setGate(key, on);
    (key === 'directWrites' ? setDirect : setMasterDb)(r.enabled);
  };

  return (
    <Section title={t('set.t.safety')} tip={t('st.gatesTip')}>
      <div className="divide-y divide-line-subtle">
        <Row label={t('st.direct')} hint={t('st.directHint')}>
          <Switch aria-label={t('st.direct')} checked={direct} onCheckedChange={(v) => void gate('directWrites', v)} />
        </Row>
        <Row label={t('st.masterdb')} hint={t('st.masterdbHint')}>
          <Switch aria-label={t('st.masterdb')} checked={masterDb} onCheckedChange={(v) => void gate('masterDbWrites', v)} />
        </Row>
        <Row label={t('st.discogs')} hint={t('st.discogsHint')}>
          <Input
            type="password"
            aria-label={t('st.discogs')}
            className="w-64"
            value={token}
            autoComplete="off"
            onChange={(e) => {
              setToken(e.target.value);
              void window.crateforge.settings.set('discogsToken', e.target.value);
            }}
          />
        </Row>
      </div>
    </Section>
  );
}

type VRow = Awaited<ReturnType<typeof window.crateforge.versions.detect>>['rows'][number];

const STATUS_TONE: Record<VRow['status'], string> = {
  ok: 'text-success',
  newer: 'text-warning',
  unknown: 'text-ink-lo',
  acknowledged: 'text-accent'
};

function Versions() {
  const t = useT();
  const [rows, setRows] = useState<VRow[] | null>(null);
  const [gate, setGate] = useState<'standard' | 'strict'>('standard');

  const load = useCallback(async () => {
    const r = await window.crateforge.versions.detect();
    setRows(r.rows);
    setGate(r.gate);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Section
      title={t('set.t.versions')}
      tip={t('st.v.tip')}
      actions={
        <span className="flex items-center gap-2">
          <span className="text-caption text-ink-mid">{t('st.v.gate')}</span>
          <Segmented<'standard' | 'strict'>
            size="sm"
            value={gate}
            onChange={(m) => void window.crateforge.versions.setGate(m).then(load)}
            options={[
              { value: 'standard', label: t('st.v.standard') },
              { value: 'strict', label: t('st.v.strict') }
            ]}
          />
          <InfoTip text={t('st.v.gateTip')} />
        </span>
      }
    >
      <table className="w-full text-left">
        <thead>
          <tr className="text-caption text-ink-lo">
            <th className="py-2 font-normal">{t('st.v.software')}</th>
            <th className="py-2 font-normal">{t('st.v.detected')}</th>
            <th className="py-2 font-normal">{t('st.v.tested')}</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {(rows ?? []).map((r) => (
            <tr key={r.software}>
              <td className="py-2.5 text-body text-ink-hi">{r.label}</td>
              <td className="py-2.5 font-mono text-caption text-ink-mid">{r.detected ?? '—'}</td>
              <td className="py-2.5 font-mono text-caption text-ink-mid">{r.maxTested}</td>
              <td className="py-2.5 text-right">
                <span className={cn('mr-3 text-caption', STATUS_TONE[r.status])}>{t(`st.v.${r.status}` as StrKey)}</span>
                {r.status === 'newer' && r.detected && (
                  <Button size="sm" variant="ghost" onClick={() => void window.crateforge.versions.acknowledge(r.software, r.detected!).then(load)}>
                    {t('st.v.unlock')}
                  </Button>
                )}
                {r.status === 'acknowledged' && (
                  <Button size="sm" variant="ghost" onClick={() => void window.crateforge.versions.revoke(r.software).then(load)}>
                    {t('st.v.revoke')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function About() {
  const t = useT();
  const { sidecar, preflight, rerunPreflight } = useLibrary();
  const { push } = useNotifications();
  const [busy, setBusy] = useState(false);

  const downloadKey = async () => {
    setBusy(true);
    try {
      const r = (await window.crateforge.sidecar.downloadKey()) as { ok: boolean; message?: string };
      push(r.ok ? { kind: 'success', title: t('st.e.downloaded') } : { kind: 'error', title: t('st.e.download'), body: r.message });
      await rerunPreflight();
    } finally {
      setBusy(false);
    }
  };

  const ready = !!sidecar?.available && preflight?.sidecar.runs !== false;

  return (
    <div className="space-y-6">
      <Section
        title={t('st.engine')}
        tip={t('st.engineTip')}
        actions={
          <Button size="sm" variant="ghost" onClick={() => void rerunPreflight()}>
            <RefreshCw /> {t('st.e.recheck')}
          </Button>
        }
      >
        <div className="divide-y divide-line-subtle">
          <Row label={t('st.engine')} hint={sidecar?.binaryPath ? shortenPath(sidecar.binaryPath, 70) : undefined}>
            <span className={cn('text-body', ready ? 'text-success' : 'text-warning')}>
              {ready ? t('st.e.ready') : t('st.e.down')}
            </span>
          </Row>
          {sidecar?.available && (
            <Row label={t('st.e.key')}>
              <span className={cn('text-body', preflight?.key.ready ? 'text-success' : 'text-warning')}>
                {preflight?.key.ready ? t('st.e.keyOk') : t('st.e.keyMissing')}
              </span>
              {!preflight?.key.ready && (
                <Button size="sm" variant="secondary" working={busy} onClick={downloadKey}>
                  {t('st.e.download')}
                </Button>
              )}
            </Row>
          )}
        </div>
        {preflight?.sidecar.reason && !ready && <Notice variant="warning" className="mt-3">{preflight.sidecar.reason}</Notice>}
      </Section>

      <Section>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <CrateStack size={48} version="v2.0.0" />
          <p className="max-w-lg text-body text-ink-mid">{t('st.tagline')}</p>
          <img src={logoUrl} alt="Rekordbox DJ Italia Group" className="mt-2 h-20 w-20 opacity-90" />
          <p className="max-w-lg text-caption text-ink-mid">{t('st.credit')}</p>
          <p className="max-w-lg text-caption text-ink-lo">{t('st.disclaimer')}</p>
        </div>
      </Section>
    </div>
  );
}
