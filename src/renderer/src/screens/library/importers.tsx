import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Disc3, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useJobs } from '@/lib/jobs';
import { useLibrary } from '@/lib/library';
import { useNotifications } from '@/lib/notifications';
import { useT, type StrKey } from '@/lib/strings';
import { useWorkspace } from '@/lib/workspace';

/**
 * Import da un programma DJ: un menu, una voce per sorgente, l'esito in una
 * notifica. Niente schede o pagine dedicate: chi importa sa da dove.
 */

type Source = 'rbdb' | 'rbxml' | 'usb' | 'serato4' | 'serato' | 'traktor' | 'vdj' | 'engine' | 'djay';

const SOURCES: { id: Source; label: StrKey }[] = [
  { id: 'rbdb', label: 'lib.imp.rbdb' },
  { id: 'rbxml', label: 'lib.imp.rbxml' },
  { id: 'usb', label: 'lib.imp.usb' },
  { id: 'serato4', label: 'lib.imp.serato4' },
  { id: 'serato', label: 'lib.imp.serato' },
  { id: 'traktor', label: 'lib.imp.traktor' },
  { id: 'vdj', label: 'lib.imp.vdj' },
  { id: 'engine', label: 'lib.imp.engine' },
  { id: 'djay', label: 'lib.imp.djay' }
];

interface ImportResult {
  ok: boolean;
  tracks?: number;
  message?: string;
}

export type ImportSourceKey = Source;

export function useImporter() {
  const t = useT();
  const { run } = useJobs();
  const { push } = useNotifications();
  const { refresh, rbPaths } = useLibrary();
  const { refreshCounts } = useWorkspace();

  return async (source: Source): Promise<void> => {
    const name = t(SOURCES.find((s) => s.id === source)!.label);
    const pick = async (): Promise<string | null> => {
      switch (source) {
        case 'rbdb':
          return window.crateforge.dialog.openFile(
            [{ name: 'Rekordbox (master.db)', extensions: ['db'] }],
            rbPaths?.masterDbExists ? rbPaths.masterDb : rbPaths?.dir
          );
        case 'rbxml':
          return window.crateforge.dialog.openFile([{ name: 'Rekordbox XML', extensions: ['xml'] }]);
        case 'serato':
        case 'usb':
          return window.crateforge.dialog.openDirectory();
        case 'serato4':
          return window.crateforge.dialog.openFile([{ name: 'Serato DJ Pro 4 (master.sqlite)', extensions: ['sqlite'] }]);
        case 'djay':
          return window.crateforge.dialog.openFile([{ name: 'djay (MediaLibrary.db)', extensions: ['db'] }]);
        case 'traktor':
          return window.crateforge.dialog.openFile([{ name: 'Traktor (collection.nml)', extensions: ['nml'] }]);
        case 'vdj':
          return window.crateforge.dialog.openFile([{ name: 'VirtualDJ (database.xml)', extensions: ['xml'] }]);
        case 'engine':
          return window.crateforge.dialog.openFile([{ name: 'Engine DJ (m.db)', extensions: ['db'] }]);
      }
    };
    const path = await pick();
    if (!path) return;

    const exec = async (): Promise<ImportResult> => {
      switch (source) {
        case 'rbdb':
          return (await window.crateforge.library.ingestMasterdb(path)) as ImportResult;
        case 'rbxml': {
          const r = (await window.crateforge.library.ingestXml(path)) as { tracks: number };
          return { ok: true, tracks: r.tracks };
        }
        case 'serato':
          return (await window.crateforge.library.importSerato(path)) as ImportResult;
        case 'serato4':
          return window.crateforge.library.importSerato4(path);
        case 'djay':
          return window.crateforge.library.importDjay(path);
        case 'usb':
          return window.crateforge.library.importUsbLibrary(path);
        case 'traktor':
          return (await window.crateforge.library.importForeign('traktor', path)) as ImportResult;
        case 'vdj':
          return (await window.crateforge.library.importForeign('virtualdj', path)) as ImportResult;
        case 'engine':
          return (await window.crateforge.library.importForeign('engine', path)) as ImportResult;
      }
    };

    try {
      const r = await run(name, exec);
      if (r.ok) {
        await refresh();
        await refreshCounts();
        push({
          kind: 'success',
          job: true,
          title:
            r.tracks === undefined
              ? t('lib.importedPlain', { name })
              : t('lib.imported', { name, tracks: r.tracks.toLocaleString() })
        });
      } else {
        push({ kind: 'error', job: true, title: t('lib.importFailed', { name }), body: r.message });
      }
    } catch (err) {
      push({ kind: 'error', job: true, title: t('lib.importFailed', { name }), body: String(err) });
    }
  };
}

/** Pulsante «Importa» con il menu delle sorgenti. */
export function ImportMenu({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const t = useT();
  const importFrom = useImporter();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant={variant}>
          <Download /> {t('lib.import')}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-56 rounded-card border border-line bg-surface-2 p-1.5 shadow-e3 animate-scale-in"
        >
          {SOURCES.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setOpen(false);
                void importFrom(s.id);
              }}
              className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-body text-ink-hi transition-colors duration-press hover:bg-surface-hover"
            >
              <Disc3 className="size-4 text-ink-lo" />
              {t(s.label)}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
