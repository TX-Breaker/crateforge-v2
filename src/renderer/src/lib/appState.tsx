import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Locale } from './i18n';

/**
 * Stato applicativo globale, persistito nelle settings dell'UDM via IPC.
 *
 * Il tema ha DUE assi indipendenti (§1.4 del design system):
 *   themeStyle : 'studio' | 'neutral'          → famiglia di palette
 *   theme      : 'light' | 'dark' | 'system'   → luminosità
 * Quattro palette coprono le sei combinazioni; `system` risolve sulla
 * luminosità del sistema operativo mantenendo lo stile scelto.
 */

export type Theme = 'light' | 'dark' | 'system';
export type ThemeStyle = 'studio' | 'neutral';
export type Density = 'comfortable' | 'compact';
export type MotionPref = 'system' | 'reduce';
export type UserMode = 'simple' | 'expert';

interface AppState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  themeStyle: ThemeStyle;
  setThemeStyle: (s: ThemeStyle) => void;
  /** luminosità effettivamente applicata in questo momento */
  isDark: boolean;
  density: Density;
  setDensity: (d: Density) => void;
  motion: MotionPref;
  setMotion: (m: MotionPref) => void;
  mode: UserMode;
  setMode: (m: UserMode) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** false finché il primo avvio non è stato completato o saltato */
  onboarded: boolean;
  setOnboarded: (v: boolean) => void;
  /** true quando le settings persistite sono state lette: evita il flash */
  ready: boolean;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [themeStyle, setThemeStyleState] = useState<ThemeStyle>('studio');
  const [density, setDensityState] = useState<Density>('comfortable');
  const [motion, setMotionState] = useState<MotionPref>('system');
  const [mode, setModeState] = useState<UserMode>('simple');
  const [locale, setLocaleState] = useState<Locale>('it');
  const [onboarded, setOnboardedState] = useState(true);
  const [ready, setReady] = useState(false);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    (async () => {
      const get = window.crateforge.settings.get;
      const [t, style, d, mo, m, l, ob] = await Promise.all([
        get('theme'),
        get('themeStyle'),
        get('density'),
        get('motion'),
        get('userMode'),
        get('locale'),
        get('onboarded')
      ]);
      if (t === 'light' || t === 'dark' || t === 'system') setThemeState(t);
      if (style === 'studio' || style === 'neutral') setThemeStyleState(style);
      if (d === 'comfortable' || d === 'compact') setDensityState(d);
      if (mo === 'system' || mo === 'reduce') setMotionState(mo);
      if (m === 'simple' || m === 'expert') setModeState(m);
      if (l === 'it' || l === 'en' || l === 'fr' || l === 'de') setLocaleState(l);
      setOnboardedState(ob === '1');
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setSystemDark(mql.matches);
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, []);

  const isDark = theme === 'dark' || (theme === 'system' && systemDark);

  // Gli assi vivono sull'elemento <html>: il CSS fa il resto senza che i
  // componenti sappiano nulla della palette attiva.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    root.dataset.style = themeStyle;
    root.dataset.density = density;
    if (motion === 'reduce') root.dataset.motion = 'reduce';
    else delete root.dataset.motion;
    root.style.colorScheme = isDark ? 'dark' : 'light';

    // Su Windows i pulsanti di sistema sono disegnati dall'OS sopra la nostra
    // striscia: il colore va passato al main, altrimenti al cambio tema
    // resterebbe quello di partenza.
    const css = getComputedStyle(root);
    const hex = (varName: string) => {
      const raw = css.getPropertyValue(varName).trim();
      const parts = raw.split(/\s+/).map((n) => Number(n));
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
      return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    };
    const bar = hex('--surface-1');
    const symbol = hex('--text-mid');
    if (bar && symbol) window.crateforge.window?.setOverlayTheme(bar, symbol);
  }, [isDark, themeStyle, density, motion]);

  const persist = useCallback((key: string, value: string) => {
    window.crateforge.settings.set(key, value);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      theme,
      setTheme: (t) => {
        setThemeState(t);
        persist('theme', t);
      },
      themeStyle,
      setThemeStyle: (s) => {
        setThemeStyleState(s);
        persist('themeStyle', s);
      },
      isDark,
      density,
      setDensity: (d) => {
        setDensityState(d);
        persist('density', d);
      },
      motion,
      setMotion: (m) => {
        setMotionState(m);
        persist('motion', m);
      },
      mode,
      setMode: (m) => {
        setModeState(m);
        persist('userMode', m);
      },
      locale,
      setLocale: (l) => {
        setLocaleState(l);
        persist('locale', l);
      },
      onboarded,
      setOnboarded: (v) => {
        setOnboardedState(v);
        persist('onboarded', v ? '1' : '0');
      },
      ready
    }),
    [theme, themeStyle, isDark, density, motion, mode, locale, onboarded, ready, persist]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState fuori dal provider');
  return v;
}

/** Scorciatoia comoda: `const t = useT()` → t('nav.overview'). */
export function useLocale(): Locale {
  return useAppState().locale;
}
