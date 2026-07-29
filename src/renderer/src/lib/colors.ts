/**
 * Aritmetica di colore condivisa dai componenti dati (§07 · accessibilità).
 *
 * Serve dove una tinta NON viene da un token ma da un dato — la tonalità di
 * Camelot, il riempimento di una casella di copertura — e quindi il contrasto
 * non è garantito dalla palette: va calcolato. Il design system chiede 4.5:1
 * sul testo normale in tutti e sei i temi, e una casella colorata con sopra un
 * numero è testo normale a tutti gli effetti.
 *
 * Stava duplicato dentro CamelotWheel: due copie della stessa regola sono due
 * occasioni di divergere.
 */

/** Miscela `hex` verso `other`: t=1 tiene hex, t=0 lo sostituisce con other. */
export function mix(hex: string, other: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16)
  ];
  const a = parse(hex);
  const b = parse(other);
  return (
    '#' +
    a
      .map((v, i) => Math.round(v * t + b[i] * (1 - t)).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Luminanza relativa WCAG. */
export function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Rapporto di contrasto WCAG fra due tinte opache. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Fra i due inchiostri del tema, quello che si legge meglio sul fondo dato. */
export function readableInk(bg: string, dark: string, light: string): string {
  return contrastRatio(dark, bg) >= contrastRatio(light, bg) ? dark : light;
}

/**
 * Alcune mescolanze finiscono in una fascia di luminanza morta dove NESSUNO
 * dei due inchiostri passa AA: si scurisce il riempimento finché uno dei due
 * ce la fa. Serve in circa il 10% degli stati della ruota di Camelot.
 */
export function aaSafe(bg: string, dark: string, light: string, target = 4.6): string {
  let c = bg;
  for (let i = 0; i < 24; i++) {
    if (Math.max(contrastRatio(dark, c), contrastRatio(light, c)) >= target) break;
    c = mix(c, dark, 0.9);
  }
  return c;
}

/**
 * Porta una tinta-dato a essere leggibile SU un fondo, senza cambiarne
 * l'identità: la si spinge verso l'inchiostro del tema che contrasta meglio
 * con quel fondo, un passo alla volta, finché non passa la soglia.
 *
 * È il caso della tonalità di Camelot scritta al centro della ruota: sulle
 * palette scure il ciano acceso si legge benissimo, su quelle chiare
 * sparirebbe. La tinta resta riconoscibile, cambia solo quanto serve.
 */
export function ensureReadable(
  hue: string,
  bg: string,
  dark: string,
  light: string,
  target = 4.5
): string {
  const toward = readableInk(bg, dark, light);
  let c = hue;
  for (let i = 0; i < 24; i++) {
    if (contrastRatio(c, bg) >= target) break;
    c = mix(c, toward, 0.86);
  }
  return c;
}

/* `tokenHex` — leggere un token dal tema attivo — vive in `themeTokens.ts`:
   tocca il DOM, e questo file resta aritmetica pura così i test di contrasto
   possono eseguirlo senza montare un browser. */
