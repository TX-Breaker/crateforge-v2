import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Sessione di lavoro: DA DOVE leggo e VERSO DOVE scrivo.
 *
 * Perché esiste. Nell'archivio interno convivono le librerie di più software:
 * Rekordbox, Traktor, VirtualDJ, Serato, Engine. Prima di questa sessione ogni
 * schermata mostrava la SOMMA di tutte, senza dire a quale software appartenesse
 * ciascuna riga. Il risultato era che l'utente non poteva rispondere a tre
 * domande elementari: su cosa sto lavorando, dove finirà quello che faccio, e
 * queste due copie della stessa canzone sono un doppione o due librerie diverse.
 *
 * La scelta è di SESSIONE, non un'impostazione da configurare una volta: chi
 * apre il programma il lunedì per sistemare Rekordbox e il martedì per portare
 * un set su Traktor sta facendo due lavori diversi. L'ultima scelta resta come
 * proposta, ma la domanda si ripete a ogni avvio — ed è una domanda, non un
 * modulo: due clic e si è dentro.
 *
 * `all` non fonde niente sul disco: le librerie restano separate nell'archivio,
 * e la vista unificata mostra una riga per BRANO REALE (identità canonica,
 * core/identity.ts) dicendo in quanti software si trova.
 */

export type SoftwareId = 'rekordbox' | 'traktor' | 'virtualdj' | 'serato' | 'engine';

/** Da dove leggo: un software solo, oppure tutto insieme. */
export type Scope = SoftwareId | 'all';

/** Verso dove scrivo: un software, oppure lo decido operazione per operazione. */
export type Target = SoftwareId | 'ask';

export const SOFTWARE: SoftwareId[] = ['rekordbox', 'traktor', 'virtualdj', 'serato', 'engine'];

export const SOFTWARE_LABEL: Record<SoftwareId, string> = {
  rekordbox: 'Rekordbox',
  traktor: 'Traktor',
  virtualdj: 'VirtualDJ',
  serato: 'Serato',
  engine: 'Engine DJ'
};

/**
 * Valori di `tracks.source` che appartengono a ciascun software.
 *
 * Rekordbox ne ha DUE perché ci si arriva per due strade: il database cifrato
 * letto dal sidecar (`masterdb`) e il collection XML esportato a mano (`xml`).
 * Sono la stessa libreria vista da due porte, e per l'utente devono essere una
 * voce sola.
 */
export const SOURCES_OF: Record<SoftwareId, string[]> = {
  rekordbox: ['masterdb', 'xml'],
  traktor: ['traktor'],
  virtualdj: ['virtualdj'],
  serato: ['serato'],
  engine: ['engine']
};

/** Dal valore grezzo di `tracks.source` al software che l'utente riconosce. */
export function softwareOfSource(source: string): SoftwareId | null {
  for (const s of SOFTWARE) if (SOURCES_OF[s].includes(source)) return s;
  return null;
}

/** Quante tracce e playlist ci sono per ciascuna sorgente dell'archivio. */
export interface SourceCounts {
  bySoftware: Record<SoftwareId, { tracks: number; playlists: number; sources: string[] }>;
  /** vista unificata: un conteggio per brano reale, non per riga */
  unified: { tracks: number; shared: number };
}

interface WorkspaceState {
  scope: Scope;
  target: Target;
  /** true finché la scelta di questa sessione non è stata fatta */
  asking: boolean;
  /** conteggi per popolare la scelta; null finché non sono stati letti */
  counts: SourceCounts | null;
  /** applica la scelta e chiude la domanda */
  choose: (scope: Scope, target: Target) => void;
  /** riapre la domanda (dalla barra di contesto) */
  reopen: () => void;
  /** ricarica i conteggi (dopo un import) */
  refreshCounts: () => Promise<void>;
  /**
   * Valori di `source` da passare alle query per la sessione corrente.
   * `null` significa "tutte le sorgenti" — cioè vista unificata.
   */
  sources: string[] | null;
}

const Ctx = createContext<WorkspaceState | null>(null);

const isScope = (v: string | null): v is Scope =>
  v === 'all' || (!!v && (SOFTWARE as string[]).includes(v));
const isTarget = (v: string | null): v is Target =>
  v === 'ask' || (!!v && (SOFTWARE as string[]).includes(v));

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScope] = useState<Scope>('all');
  const [target, setTarget] = useState<Target>('ask');
  const [asking, setAsking] = useState(false);
  const [counts, setCounts] = useState<SourceCounts | null>(null);

  const refreshCounts = useCallback(async () => {
    const c = (await window.crateforge.library.sources()) as SourceCounts;
    setCounts(c);
  }, []);

  useEffect(() => {
    (async () => {
      const get = window.crateforge.settings.get;
      const [lastScope, lastTarget] = await Promise.all([
        get('workspace.scope'),
        get('workspace.target')
      ]);
      if (isScope(lastScope)) setScope(lastScope);
      if (isTarget(lastTarget)) setTarget(lastTarget);
      await refreshCounts();
      /* La domanda si fa a OGNI avvio, non solo al primo: è la scelta che
         determina cosa vedrai per tutta la sessione, e darla per scontata
         significa far lavorare qualcuno sulla libreria sbagliata. */
      setAsking(true);
    })();
  }, [refreshCounts]);

  const choose = useCallback((s: Scope, t: Target) => {
    setScope(s);
    setTarget(t);
    setAsking(false);
    // L'ultima scelta torna come proposta al prossimo avvio, non come automatismo.
    window.crateforge.settings.set('workspace.scope', s);
    window.crateforge.settings.set('workspace.target', t);
  }, []);

  const value = useMemo<WorkspaceState>(
    () => ({
      scope,
      target,
      asking,
      counts,
      choose,
      reopen: () => setAsking(true),
      refreshCounts,
      sources: scope === 'all' ? null : SOURCES_OF[scope]
    }),
    [scope, target, asking, counts, choose, refreshCounts]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace fuori da WorkspaceProvider');
  return v;
}
