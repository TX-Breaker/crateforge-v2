/**
 * Piattaforma vista dal renderer. Serve a due cose sole ma importanti:
 * le etichette delle scorciatoie (⌘ su macOS, Ctrl su Windows) e il chrome
 * della finestra (semafori a sinistra vs controlli di sistema a destra).
 *
 * `navigator.userAgentData.platform` non è disponibile ovunque in Electron
 * sandboxed: la UA string resta la fonte più affidabile lato renderer.
 */
export const isMac = /Mac|iPhone|iPad/i.test(navigator.userAgent);
export const isWindows = /Win/i.test(navigator.userAgent);

/** Tasto modificatore principale, già pronto da mostrare. */
export const modKey = isMac ? '⌘' : 'Ctrl';

/** "⌘K" su macOS, "Ctrl+K" su Windows. */
export function shortcut(key: string): string {
  return isMac ? `${modKey}${key}` : `${modKey}+${key}`;
}

/** true quando l'evento porta il modificatore giusto per la piattaforma. */
export function hasMod(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}
