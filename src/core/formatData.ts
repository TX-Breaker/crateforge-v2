/**
 * Sacca dei campi non normalizzati (`tracks.data`, `cues.data`).
 *
 * Il problema che risolve: ogni formato porta dati che nessuna colonna
 * dell'UDM accoglie, e finora venivano letti e buttati via. Una conversione
 * Engine → UDM → Engine perdeva `thirdPartySourceId`; una Serato 4 → UDM →
 * Serato 4 perdeva l'identità `(location_id, portable_id)` e quindi non era una
 * riscrittura, era un reinserimento.
 *
 * La forma è un oggetto JSON con UNA CHIAVE PER FORMATO:
 *
 *   {"serato4": {"locationId": 1, "portableId": "…"}, "engine": {…}}
 *
 * ⚠ La regola che rende sicura questa struttura: chi scrive tocca **solo la
 * propria chiave di primo livello**. `mergeFormatData` la impone — non esiste
 * un modo di scrivere l'intera sacca in una volta, apposta. Senza il vincolo,
 * l'export verso Serato 4 cancellerebbe ciò che ha scritto l'import da Engine,
 * e nessuno se ne accorgerebbe finché non serve.
 *
 * Un JSON illeggibile non è un errore fatale: si riparte da `{}` e si prosegue.
 * La sacca è un contenitore di comodità, non una fonte di verità: perderne il
 * contenuto degrada la fedeltà di una conversione, non la correttezza del
 * database. Bloccare l'applicazione per un campo di comodo sarebbe sproporzionato.
 */

/** Namespace ammessi. Uno per formato, così le collisioni sono impossibili. */
export type FormatNamespace =
  | 'rekordbox'
  | 'rekordboxUsb'
  | 'serato'
  | 'serato4'
  | 'traktor'
  | 'virtualdj'
  | 'engine'
  | 'djay'
  | 'itunes';

export type FormatPayload = Record<string, unknown>;

/** Sacca completa: namespace → payload. */
export type FormatData = Partial<Record<FormatNamespace, FormatPayload>>;

/**
 * Legge la sacca da una colonna `data`.
 *
 * Tollerante per scelta: `null`, stringa vuota, JSON rotto o JSON che non è un
 * oggetto danno tutti `{}`. Il chiamante non deve gestire quattro casi per un
 * campo accessorio.
 */
export function parseFormatData(raw: string | null | undefined): FormatData {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as FormatData;
  } catch {
    return {};
  }
}

/** Payload di un solo formato. `{}` se assente o non è un oggetto. */
export function readFormatData(
  raw: string | null | undefined,
  ns: FormatNamespace
): FormatPayload {
  const value = parseFormatData(raw)[ns];
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as FormatPayload;
}

/**
 * Sostituisce il payload di UN namespace e restituisce la sacca serializzata.
 *
 * Sostituisce, non fonde in profondità: dentro il proprio namespace un adapter
 * è padrone e sa cosa vuole scriverci. La fusione avviene un livello sopra, fra
 * namespace diversi, ed è quella che conta.
 *
 * Un payload vuoto RIMUOVE il namespace invece di lasciare `{}`: così una
 * sacca senza contenuto resta `{}` e non `{"engine":{}}`, e il confronto fra
 * due righe non segnala una differenza che non c'è.
 */
export function mergeFormatData(
  raw: string | null | undefined,
  ns: FormatNamespace,
  payload: FormatPayload
): string {
  const bag = parseFormatData(raw);
  const clean: FormatPayload = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) delete bag[ns];
  else bag[ns] = clean;
  return JSON.stringify(bag);
}
