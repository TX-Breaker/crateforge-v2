import { useEffect, useState } from 'react';
import { ArrowRight, Library, Layers } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { Eyebrow } from '@/components/ui/card';
import { useAppState } from '@/lib/appState';
import { pageText } from '@/lib/i18nPages';
import { cn } from '@/lib/utils';
import {
  SOFTWARE,
  SOFTWARE_LABEL,
  useWorkspace,
  type Scope,
  type SoftwareId,
  type Target
} from '@/lib/workspace';

/**
 * Scelta di inizio sessione: da quale libreria si lavora e verso quale si
 * scrive.
 *
 * È la prima cosa che l'utente vede a ogni avvio perché è la prima cosa che
 * deve sapere. Senza, ogni schermata mostra la somma di librerie diverse e
 * nessuno può dire su cosa sta lavorando né dove finirà il risultato.
 *
 * Due domande, e la scelta della volta scorsa già selezionata: chi vuole
 * ripartire com'era preme Invio. Le librerie non ancora importate restano in
 * elenco, spente, con scritto perché — sapere che Serato esiste ma non è stato
 * importato è un'informazione, nasconderlo sarebbe una bugia per omissione.
 */
export function SessionDialog() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'session', k, p);
  const { asking, counts, scope, target, choose, refreshCounts } = useWorkspace();

  const [pickScope, setPickScope] = useState<Scope>(scope);
  /* Esito del collegamento dei doppioni, quando l'utente lo chiede da qui. */
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState<number | null>(null);
  const [pickTarget, setPickTarget] = useState<Target>(target);

  // Riallinea la proposta ogni volta che il dialogo si riapre.
  useEffect(() => {
    if (asking) {
      setPickScope(scope);
      setPickTarget(target);
    }
  }, [asking, scope, target]);

  if (!asking) return null;

  const n = (v: number) => v.toLocaleString(locale);
  const tracksOf = (id: SoftwareId) => counts?.bySoftware?.[id]?.tracks ?? 0;
  const unified = counts?.unified ?? { tracks: 0, shared: 0 };
  const perSoftware = SOFTWARE.map((id) => tracksOf(id));
  const totalRows = perSoftware.reduce((a, b) => a + b, 0);
  const librariesWithTracks = perSoftware.filter((v) => v > 0).length;

  return (
    <Dialog open onOpenChange={() => choose(pickScope, pickTarget)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tp('title')}</DialogTitle>
          <DialogDescription>{tp('subtitle')}</DialogDescription>
        </DialogHeader>

        {/* ---------------- da dove leggo ---------------- */}
        <div className="space-y-2">
          <Eyebrow>{tp('scopeLabel')}</Eyebrow>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => setPickScope('all')}
              className={cn(
                'rounded-card border px-3.5 py-3 text-left transition-colors duration-press',
                pickScope === 'all'
                  ? 'border-accent bg-accent/[.08]'
                  : 'border-line bg-surface-3 hover:border-line-strong'
              )}
            >
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-ink-lo" />
                <span className="text-body font-semibold text-ink-hi">{tp('allTitle')}</span>
                <span className="ml-auto font-mono text-data tabular-nums text-ink-hi">
                  {n(unified.tracks)}
                </span>
              </div>
              <p className="mt-1 text-caption text-ink-mid">
                {unified.shared > 0
                  ? tp('allDescShared', { shared: n(unified.shared) })
                  : tp('allDesc')}
              </p>
            </button>

            {SOFTWARE.map((id) => {
              const tracks = tracksOf(id);
              const empty = tracks === 0;
              return (
                <button
                  key={id}
                  disabled={empty}
                  onClick={() => setPickScope(id)}
                  className={cn(
                    'rounded-card border px-3.5 py-3 text-left transition-colors duration-press',
                    pickScope === id
                      ? 'border-accent bg-accent/[.08]'
                      : 'border-line bg-surface-3 hover:border-line-strong',
                    empty && 'cursor-not-allowed opacity-55 hover:border-line'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Library className="size-4 text-ink-lo" />
                    <span className="text-body font-semibold text-ink-hi">
                      {SOFTWARE_LABEL[id]}
                    </span>
                    {!empty && (
                      <span className="ml-auto font-mono text-data tabular-nums text-ink-hi">
                        {n(tracks)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-caption text-ink-mid">
                    {empty ? tp('notImported') : tp('softwareDesc')}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* I doppioni fra librerie si collegano su richiesta, mai da soli sui
            dati già importati: è la scelta fatta con l'utente. Senza il
            collegamento la vista unificata mostra la stessa canzone una volta
            per software, e il numero qui sopra lo dice invece di nasconderlo. */}
        {pickScope === 'all' && counts && unified.shared === 0 && librariesWithTracks > 1 && (
          <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-3 px-3.5 py-3">
            <p className="min-w-0 flex-1 text-caption text-ink-mid">
              {linked === null
                ? tp('linkHint', { rows: n(totalRows), tracks: n(unified.tracks) })
                : tp('linkDone', { n: n(linked) })}
            </p>
            {linked === null && (
              <Button
                size="sm"
                variant="secondary"
                working={linking}
                onClick={async () => {
                  setLinking(true);
                  try {
                    const r = await window.crateforge.library.linkIdentity();
                    setLinked(r.linked);
                    await refreshCounts();
                  } finally {
                    setLinking(false);
                  }
                }}
              >
                {tp('linkAction')}
              </Button>
            )}
          </div>
        )}

        {/* ---------------- verso dove scrivo ---------------- */}
        <div className="space-y-2 border-t border-line-subtle pt-3">
          <Eyebrow>{tp('targetLabel')}</Eyebrow>
          <p className="text-caption text-ink-mid">{tp('targetDesc')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setPickTarget('ask')}
              className={cn(
                'rounded-full border px-3 py-1 text-caption transition-colors duration-press',
                pickTarget === 'ask'
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-surface-3 text-ink-mid hover:border-line-strong hover:text-ink-hi'
              )}
            >
              {tp('targetAsk')}
            </button>
            {SOFTWARE.map((id) => (
              <button
                key={id}
                onClick={() => setPickTarget(id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-caption transition-colors duration-press',
                  pickTarget === id
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line bg-surface-3 text-ink-mid hover:border-line-strong hover:text-ink-hi'
                )}
              >
                {SOFTWARE_LABEL[id]}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          {/* Riassunto della scelta, in parole: è ciò che comparirà in alto per
              tutta la sessione, quindi si legge già qui. */}
          <span className="mr-auto flex items-center gap-2 text-caption text-ink-mid">
            <Badge variant="neutral">
              {pickScope === 'all' ? tp('allTitle') : SOFTWARE_LABEL[pickScope]}
            </Badge>
            <ArrowRight className="size-3.5 text-ink-lo" />
            <Badge variant="neutral">
              {pickTarget === 'ask' ? tp('targetAsk') : SOFTWARE_LABEL[pickTarget]}
            </Badge>
          </span>
          <Button variant="primary" onClick={() => choose(pickScope, pickTarget)}>
            {tp('start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Barra di contesto: dice, sempre e in ogni pagina, su quale libreria si sta
 * lavorando e dove finirà quello che si scrive. Cliccabile per cambiare senza
 * riavviare.
 */
export function SessionChip() {
  const { locale } = useAppState();
  const tp = (k: string, p?: Record<string, string | number>) => pageText(locale, 'session', k, p);
  const { scope, target, counts, reopen } = useWorkspace();

  const tracks =
    scope === 'all'
      ? (counts?.unified.tracks ?? 0)
      : (counts?.bySoftware?.[scope]?.tracks ?? 0);

  return (
    <button
      onClick={reopen}
      title={tp('changeHint')}
      className={cn(
        'flex items-center gap-2 rounded-control border border-line bg-surface-3 px-2.5 py-1',
        'transition-colors duration-press hover:border-line-strong'
      )}
    >
      <span className="font-mono text-eyebrow uppercase text-ink-lo">{tp('from')}</span>
      <span className="text-caption font-medium text-ink-hi">
        {scope === 'all' ? tp('allTitle') : SOFTWARE_LABEL[scope]}
      </span>
      <span className="font-mono text-caption tabular-nums text-ink-lo">
        {tracks.toLocaleString(locale)}
      </span>
      <ArrowRight className="size-3.5 text-ink-lo" />
      <span className="font-mono text-eyebrow uppercase text-ink-lo">{tp('to')}</span>
      <span className="text-caption font-medium text-ink-hi">
        {target === 'ask' ? tp('targetAsk') : SOFTWARE_LABEL[target]}
      </span>
    </button>
  );
}
