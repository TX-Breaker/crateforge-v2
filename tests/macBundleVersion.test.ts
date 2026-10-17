import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { macBundleVersion } from '../src/main/versionProbe';

/**
 * Su macOS la cartella d'installazione di Rekordbox si chiama «rekordbox 7»:
 * la versione completa, quella da confrontare con la collaudata, sta nel
 * Info.plist dell'app. App finta su disco: il test gira su ogni sistema.
 */

function fakeApp(version: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'cf-mac-'));
  const dir = join(root, 'rekordbox 7');
  const contents = join(dir, 'rekordbox.app', 'Contents');
  mkdirSync(contents, { recursive: true });
  writeFileSync(
    join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>rekordbox</string>
  ${version ? `<key>CFBundleShortVersionString</key>\n  <string>${version}</string>` : ''}
</dict></plist>`
  );
  return dir;
}

describe('versione di un’app macOS', () => {
  it('legge CFBundleShortVersionString dalla cartella che contiene l’app', () => {
    expect(macBundleVersion(fakeApp('7.2.16'))).toBe('7.2.16');
  });

  it('accetta anche il percorso dell’app stessa', () => {
    expect(macBundleVersion(join(fakeApp('6.8.5'), 'rekordbox.app'))).toBe('6.8.5');
  });

  it('senza la chiave non inventa niente', () => {
    expect(macBundleVersion(fakeApp(null))).toBeNull();
    expect(macBundleVersion(join(tmpdir(), 'non-esiste-cf'))).toBeNull();
  });
});
