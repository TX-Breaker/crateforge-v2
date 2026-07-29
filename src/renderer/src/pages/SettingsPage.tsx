import { useEffect, useState } from 'react';
import {
  Brush,
  Info,
  KeyRound,
  Languages,
  Lock,
  Monitor,
  Moon,
  RefreshCw,
  Rows3,
  ShieldCheck,
  Sun
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Eyebrow
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Input,
  Notice,
  Segmented,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/misc';
import { useAppState, type Theme, type ThemeStyle } from '@/lib/appState';
import { useLibrary } from '@/lib/library';
import { useRouter } from '@/lib/router';
import { LOCALES, t } from '@/lib/i18n';
import { pageText } from '@/lib/i18nPages';
import logoUrl from '../../../../assets/branding/rekordbox-dj-italia-logo.svg';
import { CrateStack } from '@/components/Brand';

/**
 * Impostazioni — quattro tab: Generale (aspetto, densità, lingua, movimento),
 * Sicurezza (i due gate di scrittura), Motore (sidecar + chiave), Informazioni.
 */
export function SettingsPage() {
  const { locale } = useAppState();
  const { tab, setTab } = useRouter();
  return (
    <Tabs value={tab ?? 'general'} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="general">
          <Brush /> {pageText(locale, 'tabs', 'general')}
        </TabsTrigger>
        <TabsTrigger value="security">
          <Lock /> {pageText(locale, 'tabs', 'security')}
        </TabsTrigger>
        <TabsTrigger value="engine">
          <KeyRound /> {pageText(locale, 'tabs', 'engine')}
        </TabsTrigger>
        <TabsTrigger value="about">
          <Info /> {pageText(locale, 'tabs', 'about')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="general">
        <GeneralTab />
      </TabsContent>
      <TabsContent value="security">
        <SecurityTab />
      </TabsContent>
      <TabsContent value="engine">
        <EngineTab />
      </TabsContent>
      <TabsContent value="about">
        <AboutTab />
      </TabsContent>
    </Tabs>
  );
}

function GeneralTab() {
  const {
    locale,
    setLocale,
    theme,
    setTheme,
    themeStyle,
    setThemeStyle,
    density,
    setDensity,
    motion,
    setMotion,
    setOnboarded
  } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'settings', k, p);

  const styles: { id: ThemeStyle; label: string; desc: string }[] = [
    { id: 'studio', label: tp('styleStudio'), desc: tp('styleStudioDesc') },
    { id: 'neutral', label: tp('styleNeutral'), desc: tp('styleNeutralDesc') },
    { id: 'oled', label: tp('styleOled'), desc: tp('styleOledDesc') }
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-body">{tp('appearance')}</CardTitle>
          <CardDescription>{tp('appearanceDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Eyebrow>{tp('styleLabel')}</Eyebrow>
            <div className="grid gap-3 sm:grid-cols-3">
              {styles.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setThemeStyle(s.id)}
                  className={`rounded-card border px-4 py-3 text-left transition-colors duration-press ${
                    themeStyle === s.id
                      ? 'border-accent bg-accent/[.08]'
                      : 'border-line bg-surface-3 hover:border-line-strong'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-body font-medium text-ink-hi">{s.label}</span>
                    {themeStyle === s.id && <Badge variant="accent">{tp('active')}</Badge>}
                  </div>
                  <p className="mt-0.5 text-caption text-ink-mid">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 border-t border-line-subtle pt-3">
            <Eyebrow>{tp('brightnessLabel')}</Eyebrow>
            {/* Con OLED la luminosità è forzata a scuro: l'interruttore resta
                visibile ma disattivato, e sopra c'è scritto perché. Un comando
                che non fa nulla senza spiegazione è peggio di un comando in meno. */}
            {themeStyle === 'oled' && (
              <p className="text-caption text-ink-mid">{tp('oledForcesDark')}</p>
            )}
            <Segmented<Theme>
              value={themeStyle === 'oled' ? 'dark' : theme}
              onChange={setTheme}
              disabled={themeStyle === 'oled'}
              options={[
                { value: 'light', label: tp('themeLight'), icon: <Sun /> },
                { value: 'dark', label: tp('themeDark'), icon: <Moon /> },
                { value: 'system', label: tp('themeAuto'), icon: <Monitor /> }
              ]}
            />
          </div>

          <div className="space-y-2 border-t border-line-subtle pt-3">
            <Eyebrow>{tp('densityLabel')}</Eyebrow>
            <p className="text-caption text-ink-mid">{tp('densityDesc')}</p>
            <Segmented
              value={density}
              onChange={setDensity}
              options={[
                { value: 'comfortable', label: tp('densityComfortable'), icon: <Rows3 /> },
                { value: 'compact', label: tp('densityCompact'), icon: <Rows3 /> }
              ]}
            />
          </div>

          <label className="flex items-center justify-between gap-4 border-t border-line-subtle pt-3">
            <span>
              <span className="block text-body text-ink-hi">{tp('motionLabel')}</span>
              <span className="block text-caption text-ink-lo">{tp('motionDesc')}</span>
            </span>
            <Switch
              checked={motion === 'reduce'}
              onCheckedChange={(v) => setMotion(v ? 'reduce' : 'system')}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-body">
            <Languages className="size-4" /> {tp('langLabel')}
          </CardTitle>
          <CardDescription>{tp('langDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Segmented
            value={locale}
            onChange={setLocale}
            options={LOCALES.map((l) => ({ value: l.id, label: l.label }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-body">{tp('onboardingTitle')}</CardTitle>
          <CardDescription>{tp('onboardingDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={() => setOnboarded(false)}>
            <RefreshCw /> {tp('onboardingBtn')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SecurityTab() {
  const { locale, mode, setMode } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'settings', k, p);
  const [directWrites, setDirectWrites] = useState(false);
  const [masterDbWrites, setMasterDbWrites] = useState(false);
  const [discogsToken, setDiscogsToken] = useState('');

  useEffect(() => {
    window.crateforge.settings.get('directWrites').then((v) => setDirectWrites(v === '1'));
    window.crateforge.settings.get('masterDbWrites').then((v) => setMasterDbWrites(v === '1'));
    window.crateforge.settings.get('discogsToken').then((v) => setDiscogsToken(v ?? ''));
  }, []);

  // I gate passano dal canale sicuro con conferma nativa nel main: se l'utente
  // annulla il dialog di sistema, lo stato torna com'era.
  const toggleDirect = async (v: boolean) => {
    const r = await window.crateforge.security.setGate('directWrites', v);
    setDirectWrites(r.enabled);
  };
  const toggleMasterDb = async (v: boolean) => {
    const r = await window.crateforge.security.setGate('masterDbWrites', v);
    setMasterDbWrites(r.enabled);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-body">{tp('modeTitle')}</CardTitle>
          <CardDescription>{tp('modeDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-body text-ink-hi">{tp('expertLabel')}</span>
              <span className="block text-caption text-ink-lo">{tp('expertDesc')}</span>
            </span>
            <Switch
              checked={mode === 'expert'}
              onCheckedChange={(v) => setMode(v ? 'expert' : 'simple')}
            />
          </label>
          {mode === 'expert' && (
            <Notice variant="warning" title={tp('expertOnTitle')}>
              {tp('expertOnBody')}
            </Notice>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-body">{tp('gatesTitle')}</CardTitle>
          <CardDescription>{tp('gatesDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode !== 'expert' ? (
            <Notice variant="info">{tp('gatesNeedExpert')}</Notice>
          ) : (
            <>
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-4">
                  <span>
                    <span className="flex items-center gap-2 text-body text-ink-hi">
                      {tp('directLabel')}
                      <code className="rounded-chip bg-surface-3 px-1.5 py-0.5 font-mono text-caption text-ink-lo">
                        directWrites
                      </code>
                    </span>
                    <span className="block text-caption text-ink-lo">{tp('directDesc')}</span>
                  </span>
                  <Switch checked={directWrites} onCheckedChange={toggleDirect} />
                </label>
                {directWrites && (
                  <Notice variant="destructive" title={tp('directOnTitle')}>
                    {tp('directOnBody')}
                  </Notice>
                )}
              </div>

              <div className="space-y-2 border-t border-line-subtle pt-3">
                <label className="flex items-center justify-between gap-4">
                  <span>
                    <span className="flex items-center gap-2 text-body text-ink-hi">
                      {tp('masterdbLabel')}
                      <code className="rounded-chip bg-surface-3 px-1.5 py-0.5 font-mono text-caption text-ink-lo">
                        masterDbWrites
                      </code>
                    </span>
                    <span className="block text-caption text-ink-lo">{tp('masterdbDesc')}</span>
                  </span>
                  <Switch checked={masterDbWrites} onCheckedChange={toggleMasterDb} />
                </label>
                {masterDbWrites && (
                  <Notice variant="destructive" title={tp('masterdbOnTitle')}>
                    {tp('masterdbOnBody')}
                  </Notice>
                )}
              </div>

              <div className="space-y-1.5 border-t border-line-subtle pt-3">
                <span className="block text-body text-ink-hi">{tp('discogsLabel')}</span>
                <p className="text-caption text-ink-lo">{tp('discogsDesc')}</p>
                <Input
                  type="password"
                  value={discogsToken}
                  placeholder={tp('discogsPh')}
                  onChange={(e) => {
                    setDiscogsToken(e.target.value);
                    window.crateforge.settings.set('discogsToken', e.target.value);
                  }}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <VersionCompatCard />
    </div>
  );
}

/**
 * Compatibilità con le versioni dei software DJ.
 *
 * Sta qui, tra i gate, perché è esattamente la stessa materia: cosa CrateForge
 * si permette di scrivere. La regola è che si scrive solo verso versioni che
 * l'autore ha collaudato guardando i byte; una versione più recente non è
 * "probabilmente compatibile", è non verificata, e la scrittura si ferma.
 * Lo sblocco esiste (chi ha provato di persona deve poter procedere) ma è per
 * singolo software e singola versione, e passa da una conferma di sistema.
 */
function VersionCompatCard() {
  const { locale, mode } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'settings', k, p);
  type Row = Awaited<ReturnType<typeof window.crateforge.versions.detect>>['rows'][number];
  const [rows, setRows] = useState<Row[] | null>(null);
  const [gate, setGate] = useState<'standard' | 'strict'>('standard');

  const load = () =>
    window.crateforge.versions.detect().then((r) => {
      setRows(r.rows);
      setGate(r.gate);
    });
  useEffect(() => {
    void load();
  }, []);

  const tone: Record<Row['status'], 'success' | 'warning' | 'destructive' | 'neutral'> = {
    ok: 'success',
    newer: 'destructive',
    unknown: 'warning',
    acknowledged: 'warning'
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-body">
          <ShieldCheck className="size-4" /> {tp('versionsTitle')}
        </CardTitle>
        <CardDescription>{tp('versionsDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-card border border-line-subtle">
          <table className="w-full text-left">
            <thead className="border-b border-line-subtle bg-surface-3">
              <tr className="font-mono text-eyebrow uppercase text-ink-lo">
                <th className="px-3 py-2">{tp('versionsSoftware')}</th>
                <th className="px-3 py-2">{tp('versionsDetected')}</th>
                <th className="px-3 py-2">{tp('versionsTested')}</th>
                <th className="px-3 py-2">{tp('versionsStatus')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.software} className="border-b border-line-subtle last:border-b-0">
                  <td className="px-3 py-1.5 text-caption text-ink-hi">
                    {r.label}
                    <span className="block text-caption text-ink-lo">{r.marker}</span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-caption text-ink-mid">
                    {r.detected ?? (r.libraryFound ? '—' : tp('versionsNotFound'))}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-caption text-ink-mid">{r.maxTested}</td>
                  <td className="px-3 py-1.5">
                    <Badge variant={tone[r.status]}>{tp(`versionsStatus_${r.status}`)}</Badge>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {mode === 'expert' && r.status === 'acknowledged' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          window.crateforge.versions.revoke(r.software).then(() => void load())
                        }
                      >
                        {tp('versionsRevoke')}
                      </Button>
                    )}
                    {mode === 'expert' && r.status === 'newer' && r.detected && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          window.crateforge.versions
                            .acknowledge(r.software, r.detected!)
                            .then(() => void load())
                        }
                      >
                        {tp('versionsUnlock', { v: r.detected })}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(rows ?? []).some((r) => r.status !== 'ok') && (
          <Notice variant="warning" title={tp('versionsBlockedTitle')}>
            <ul className="list-disc space-y-1 pl-5">
              {(rows ?? [])
                .filter((r) => r.status !== 'ok')
                .map((r) => (
                  <li key={r.software}>{r.message}</li>
                ))}
            </ul>
          </Notice>
        )}

        <div className="space-y-1.5 border-t border-line-subtle pt-3">
          <Eyebrow>{tp('versionsGateLabel')}</Eyebrow>
          <p className="text-caption text-ink-lo">{tp('versionsGateDesc')}</p>
          <Segmented<'standard' | 'strict'>
            value={gate}
            onChange={(m) => window.crateforge.versions.setGate(m).then(() => void load())}
            options={[
              { value: 'standard', label: tp('versionsGateStandard') },
              { value: 'strict', label: tp('versionsGateStrict') }
            ]}
          />
        </div>
        {mode !== 'expert' && <p className="text-caption text-ink-lo">{tp('versionsNeedExpert')}</p>}
      </CardContent>
    </Card>
  );
}

function EngineTab() {
  const { locale, mode } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'settings', k, p);
  const { sidecar, preflight, rerunPreflight, xmlOnly } = useLibrary();
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doDownloadKey = async () => {
    setBusy(true);
    setKeyMsg(null);
    try {
      const r = await window.crateforge.sidecar.downloadKey();
      setKeyMsg(r.ok ? tp('keyOk') : tp('keyFail', { msg: r.message ?? '?' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-body">{tp('sidecarTitle')}</CardTitle>
          <CardDescription>{tp('sidecarDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sidecar === null ? (
            <p className="text-caption text-ink-lo">{tp('checking')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={sidecar.available ? 'success' : 'warning'}>
                  {sidecar.available ? tp('available') : tp('unavailable')}
                </Badge>
                {sidecar.binaryPath && (
                  <span className="truncate font-mono text-caption text-ink-lo" data-selectable>
                    {sidecar.binaryPath}
                  </span>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-card border border-line-subtle bg-surface-3 px-3 py-2">
                  <Eyebrow>{tp('engineRuns')}</Eyebrow>
                  <div className="text-body text-ink-hi">
                    {preflight?.sidecar.runs ? tp('yes') : tp('no')}
                  </div>
                </div>
                <div className="rounded-card border border-line-subtle bg-surface-3 px-3 py-2">
                  <Eyebrow>{tp('engineKey')}</Eyebrow>
                  <div className="text-body text-ink-hi">
                    {preflight?.key.ready ? tp('keyReady') : tp('keyMissing')}
                  </div>
                </div>
                <div className="rounded-card border border-line-subtle bg-surface-3 px-3 py-2">
                  <Eyebrow>{tp('engineChecked')}</Eyebrow>
                  <div className="font-mono text-caption tabular-nums text-ink-hi">
                    {preflight?.checkedAt ?? '—'}
                  </div>
                </div>
              </div>

              <Button variant="secondary" size="sm" onClick={rerunPreflight}>
                <RefreshCw /> {tp('recheck')}
              </Button>

              {xmlOnly && (
                <Notice variant="warning" title={tp('unavailTitle')}>
                  {tp('unavailBody')}
                </Notice>
              )}

              {mode === 'expert' && sidecar.available && (
                <div className="space-y-2 border-t border-line-subtle pt-3">
                  <span className="block text-body text-ink-hi">{tp('keyLabel')}</span>
                  <p className="text-caption text-ink-lo">{tp('keyDesc')}</p>
                  <Button variant="secondary" size="sm" onClick={doDownloadKey} working={busy}>
                    <KeyRound /> {tp('keyBtn')}
                  </Button>
                  {keyMsg && <Notice variant="info">{keyMsg}</Notice>}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Notice variant="info" title={tp('degradeTitle')}>
        {tp('degradeBody')}
      </Notice>
    </div>
  );
}

function AboutTab() {
  const { locale } = useAppState();
  const tp = (k: string) => pageText(locale, 'about', k);
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        {/* Unico punto in cui la piastrella SPARISCE (specifica logo §05): a
            48px il marchio sta da solo e la scritta passa alla voce tecnica —
            mono maiuscolo, tracciatura ampia, riga di versione sotto. */}
        <CrateStack size={48} version="v2.0.0" />
        <p className="max-w-lg text-body text-ink-mid">{tp('tagline')}</p>
        {/* Co-branding (§05): righe separate e una banda di spazio libero piena
            fra i due marchi, mai affiancati in un lockup comune e mai scalati
            per pareggiarsi — il marchio della community resta visibilmente una
            cosa sua. */}
        <img src={logoUrl} alt="Rekordbox DJ Italia Group" className="mt-2 h-20 w-20 opacity-90" />
        <p className="max-w-lg text-caption text-ink-mid">{tp('credit')}</p>
        <p className="max-w-lg text-caption text-ink-lo">{tp('disclaimer')}</p>
        <p className="max-w-lg text-caption text-ink-lo">{t(locale, 'safety.readonly')}</p>
      </CardContent>
    </Card>
  );
}
