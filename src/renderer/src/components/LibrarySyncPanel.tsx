import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Check, Crown, RefreshCw } from 'lucide-react';
import { Card, CardContent, Eyebrow } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, Checkbox, Notice, Segmented, Select, Tooltip } from '@/components/ui/misc';
import { cn, formatClock } from '@/lib/utils';

/**
 * Sincronizzazione dei METADATI fra librerie.
 *
 * ⚠ Non è una destinazione nuova: sta accanto alla sincronizzazione dei punti,
 * nella stessa pagina. Chi vuole allineare due librerie e chi vuole convertirne
 * una fanno la stessa cosa con un'intenzione diversa; separarle in due pagine
 * costringerebbe a duplicare la scelta della sorgente, la prova a vuoto e il
 * pannello dei numeri.
 *
 * ⚠ Questa operazione tocca SOLO l'archivio interno. La propagazione verso i
 * software DJ passa dagli export, che hanno i loro gate — ed è per questo che
 * qui non c'è una parola da digitare: non c'è nessun file dell'utente in gioco.
 */

type Mode = 'symmetric' | 'masterSlave';
type T = (k: string, p?: Record<string, string | number>) => string;

interface Summary {
  tracks: number;
  touched: number;
  toA: number;
  toB: number;
  conflicts: number;
  untouched: number;
}

interface ConflictRow {
  id: number;
  canonicalId: number;
  field: string;
  aSoftware: string;
  aValue: string | null;
  bSoftware: string;
  bValue: string | null;
  title: string | null;
  artist: string | null;
}

interface StateRow {
  software: string;
  tracks: number;
  lastSyncedAt: string | null;
  conflicts: number;
}

export interface SyncLibrary {
  /** Nome che l'utente riconosce: «Rekordbox», non «masterdb». */
  id: string;
  /**
   * Valori di `tracks.source` che compongono quella libreria.
   *
   * ⚠ Uno a uno non basta: Rekordbox ne ha due, perché ci si arriva per due
   * strade — il database cifrato e il collection XML. Sono la stessa libreria
   * vista da due porte, e per l'utente devono essere una voce sola.
   */
  sources: string[];
}

export function LibrarySyncPanel({
  t,
  libraries,
  locale
}: {
  t: T;
  libraries: SyncLibrary[];
  locale: string;
}) {
  const [mode, setMode] = useState<Mode>('symmetric');
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [allFields, setAllFields] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [state, setState] = useState<StateRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void window.crateforge.sync.fields().then((f) => {
      setAllFields(f.all);
      setFields(f.defaults);
    });
  }, []);

  const refreshState = useCallback(async () => {
    setState(await window.crateforge.sync.libraryState());
    setConflicts(await window.crateforge.sync.conflicts(200));
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  /* Il piano si azzera a ogni cambio di scelta: un pannello dei numeri che si
     riferisce a una configurazione diversa da quella mostrata è peggio di
     nessun numero. */
  useEffect(() => {
    setSummary(null);
    setDone(null);
  }, [mode, a, b, fields]);

  const pronti = a !== null && b !== null && a !== b && fields.length > 0;

  const sourcesOf = (id: string) => libraries.find((l) => l.id === id)?.sources ?? [];

  const opts = () => ({
    aSources: sourcesOf(a as string),
    bSources: sourcesOf(b as string),
    mode,
    fields
  });

  const prova = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.crateforge.sync.planLibrary(opts());
      if (!r.ok) {
        setError(r.message ?? t('syncErr'));
        return;
      }
      setSummary(r.summary ?? null);
      setSkipped(r.skipped ?? 0);
    } finally {
      setBusy(false);
    }
  };

  const applica = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.crateforge.sync.applyLibrary(opts());
      if (!r.ok) {
        setError(r.message ?? t('syncErr'));
        return;
      }
      setDone(
        t('syncDone', {
          tracks: r.written ?? 0,
          conflicts: r.conflicts ?? 0
        })
      );
      setSummary(null);
      await refreshState();
    } finally {
      setBusy(false);
    }
  };

  const risolvi = async (id: number, choice: 'a' | 'b' | 'skip', scope: 'one' | 'field') => {
    await window.crateforge.sync.resolveConflict(id, choice, scope);
    await refreshState();
  };

  const opzioni = libraries.map((l) => ({ value: l.id, label: l.id }));

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <Eyebrow>{t('libSyncEyebrow')}</Eyebrow>
          <h3 className="mt-1 text-body text-ink-hi">{t('libSyncTitle')}</h3>
          <p className="mt-1 max-w-2xl text-caption text-ink-mid">{t('libSyncBody')}</p>
        </div>

        {/* --- modalità ------------------------------------------------- */}
        <div className="space-y-1.5">
          <p className="text-caption text-ink-mid">{t('libSyncMode')}</p>
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { value: 'symmetric', label: t('libSyncSymmetric'), icon: <ArrowLeftRight /> },
              { value: 'masterSlave', label: t('libSyncMaster'), icon: <Crown /> }
            ]}
          />
          <p className="text-caption text-ink-lo">
            {mode === 'symmetric' ? t('libSyncSymmetricHelp') : t('libSyncMasterHelp')}
          </p>
        </div>

        {/* --- le due librerie ------------------------------------------ */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-caption text-ink-mid">
              {mode === 'masterSlave' ? t('libSyncA_master') : t('libSyncA')}
            </p>
            <Select
              label={t('libSyncA')}
              value={a ?? ''}
              onValueChange={setA}
              placeholder={t('libSyncPick')}
              options={opzioni}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-caption text-ink-mid">
              {mode === 'masterSlave' ? t('libSyncB_slave') : t('libSyncB')}
            </p>
            <Select
              label={t('libSyncB')}
              value={b ?? ''}
              onValueChange={setB}
              placeholder={t('libSyncPick')}
              options={opzioni.filter((o) => o.value !== a)}
            />
          </div>
        </div>

        {/* --- campi ----------------------------------------------------- */}
        <div className="space-y-1.5">
          <p className="text-caption text-ink-mid">{t('libSyncFields')}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {allFields.map((f) => (
              <label key={f} className="flex items-center gap-2">
                <Checkbox
                  checked={fields.includes(f)}
                  onCheckedChange={(v) =>
                    setFields((prev) => (v === true ? [...prev, f] : prev.filter((x) => x !== f)))
                  }
                />
                <span className="text-caption text-ink-hi">{t(`field_${f}`)}</span>
              </label>
            ))}
          </div>
          {/* ⚠ Il predefinito non include i campi testuali, e vale la pena
              dirlo: chi ha ripulito i generi in un software raramente vuole
              che quelli di un altro glieli sovrascrivano. */}
          <p className="text-caption text-ink-lo">{t('libSyncFieldsHelp')}</p>
        </div>

        {/* --- azioni ---------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={!pronti || busy} onClick={prova}>
            <RefreshCw /> {t('libSyncDryRun')}
          </Button>
          <Button variant="primary" disabled={!pronti || busy || summary === null} onClick={applica}>
            <Check /> {t('libSyncApply')}
          </Button>
          {summary === null && pronti && (
            <span className="text-caption text-ink-lo">{t('libSyncNeedDryRun')}</span>
          )}
        </div>

        {error && (
          <Notice variant="destructive" title={t('syncErr')}>
            {error}
          </Notice>
        )}
        {done && (
          <Notice variant="success" title={t('libSyncDoneTitle')}>
            {done}
          </Notice>
        )}

        {/* --- pannello dei numeri --------------------------------------- */}
        {summary && (
          <div className="space-y-1.5">
            <p className="text-caption text-ink-mid">{t('libSyncPlan')}</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md border border-line bg-surface-2 px-3 py-2">
              {[
                { k: 'planPairs', v: summary.tracks },
                { k: 'planTouched', v: summary.touched },
                { k: 'planToA', v: summary.toA },
                { k: 'planToB', v: summary.toB },
                { k: 'planSkipped', v: skipped },
                { k: 'planConflicts', v: summary.conflicts, warn: summary.conflicts > 0 }
              ].map((r) => (
                <div key={r.k} className="col-span-2 grid grid-cols-subgrid">
                  <dt className="text-caption text-ink-mid">{t(r.k)}</dt>
                  <dd
                    className={cn(
                      'text-right font-mono text-caption tabular-nums',
                      r.warn ? 'text-warning' : 'text-ink-hi'
                    )}
                  >
                    {r.v.toLocaleString(locale)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* --- stato per libreria ---------------------------------------- */}
        {state.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-caption text-ink-mid">{t('libSyncState')}</p>
            <div className="space-y-1">
              {state.map((r) => (
                <div
                  key={r.software}
                  className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-1.5"
                >
                  <span className="text-caption text-ink-hi">{r.software}</span>
                  <span className="text-caption text-ink-lo">
                    {t('libSyncStateTracks', { n: r.tracks })}
                  </span>
                  {r.conflicts > 0 && (
                    <Badge variant="warning">{t('libSyncStateConflicts', { n: r.conflicts })}</Badge>
                  )}
                  <span className="ml-auto font-mono text-caption tabular-nums text-ink-lo">
                    {r.lastSyncedAt ? formatClock(r.lastSyncedAt) : t('libSyncNever')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- conflitti -------------------------------------------------- */}
        {conflicts.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-warning" />
              <p className="text-caption text-ink-mid">
                {t('libSyncConflictsOpen', { n: conflicts.length })}
              </p>
            </div>
            <div className="space-y-1.5">
              {conflicts.slice(0, 50).map((c) => (
                <div key={c.id} className="rounded-md border border-line bg-surface-2 p-2.5">
                  <div className="flex items-center gap-2">
                    <Badge>{t(`field_${c.field}`)}</Badge>
                    <span className="truncate text-caption text-ink-mid">
                      {c.artist ? `${c.artist} — ` : ''}
                      {c.title ?? `#${c.canonicalId}`}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ['a', c.aSoftware, c.aValue],
                        ['b', c.bSoftware, c.bValue]
                      ] as const
                    ).map(([lato, software, valore]) => (
                      <button
                        key={lato}
                        type="button"
                        onClick={() => risolvi(c.id, lato, 'one')}
                        className="rounded-control border border-line px-2.5 py-1.5 text-left transition-colors duration-press hover:border-accent"
                      >
                        <span className="block text-caption text-ink-lo">{software}</span>
                        <span className="block truncate text-body text-ink-hi">
                          {valore === null || valore === '' ? t('libSyncEmpty') : valore}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => risolvi(c.id, 'skip', 'one')}>
                      {t('libSyncLeave')}
                    </Button>
                    {/* ⚠ La risoluzione in blocco è il modo in cui i conflitti
                        si presentano davvero: cinquanta volte lo stesso, non
                        cinquanta diversi. */}
                    <Tooltip content={t('libSyncAllFieldHelp')}>
                      <Button size="sm" variant="ghost" onClick={() => risolvi(c.id, 'a', 'field')}>
                        {t('libSyncAllField', { software: c.aSoftware })}
                      </Button>
                    </Tooltip>
                    <Tooltip content={t('libSyncAllFieldHelp')}>
                      <Button size="sm" variant="ghost" onClick={() => risolvi(c.id, 'b', 'field')}>
                        {t('libSyncAllField', { software: c.bSoftware })}
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
