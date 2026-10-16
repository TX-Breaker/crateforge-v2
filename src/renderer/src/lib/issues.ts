import type { HealthReport } from './library';

/**
 * I problemi della libreria, in un solo posto.
 *
 * La barra laterale mostra QUANTE categorie chiedono attenzione, non quanti
 * brani hanno un difetto: «2.140» brani senza genere è un numero che non dice
 * cosa fare, «4» cose da sistemare sì. La schermata Da sistemare elenca le
 * stesse categorie, nello stesso ordine — dalla più urgente.
 */

export type IssueId =
  | 'missing'
  | 'review'
  | 'duplicates'
  | 'noBpm'
  | 'noKey'
  | 'noCues'
  | 'noGenre'
  | 'noYear'
  | 'orphans'
  | 'quarantine';

/** Categorie contate dal rapporto di salute, in ordine di urgenza. */
export function healthIssues(h: HealthReport | null): { id: IssueId; count: number }[] {
  if (!h) return [];
  return [
    { id: 'review' as const, count: h.needsReview },
    { id: 'duplicates' as const, count: h.duplicateTracks },
    { id: 'noBpm' as const, count: h.missingBpm },
    { id: 'noKey' as const, count: h.missingKey },
    { id: 'noCues' as const, count: h.withoutHotCues },
    { id: 'noGenre' as const, count: h.missingGenre },
    { id: 'noYear' as const, count: h.missingYear }
  ];
}

/** Quante categorie hanno almeno un problema. `null` finché il rapporto non c'è. */
export function openIssueCount(h: HealthReport | null): number | null {
  if (!h) return null;
  return healthIssues(h).filter((i) => i.count > 0).length;
}
