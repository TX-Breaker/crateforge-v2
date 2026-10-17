import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Toaster } from 'sonner';
import { useAppState } from '@/lib/appState';
import { RouterProvider, useRouter } from '@/lib/router';
import { JobsProvider } from '@/lib/jobs';
import { LibraryProvider } from '@/lib/library';
import { WorkspaceProvider } from '@/lib/workspace';
import { NotificationsProvider } from '@/lib/notifications';
import { TooltipProvider } from '@/components/ui/misc';
import { hasMod } from '@/lib/platform';
import { TitleBar } from '@/app/shell/TitleBar';
import { Sidebar } from '@/app/shell/Sidebar';
import { JobBar } from '@/app/shell/JobBar';
import { CommandPalette } from '@/components/CommandPalette';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import type { RouteId } from '@/app/routes';
import { Welcome } from '@/screens/Welcome';
import { LibraryScreen } from '@/screens/LibraryScreen';
import { FixScreen } from '@/screens/FixScreen';
import { SyncScreen } from '@/screens/SyncScreen';
import { SetsScreen } from '@/screens/SetsScreen';
import { PlaylistScreen } from '@/screens/PlaylistScreen';
import { BackupScreen } from '@/screens/BackupScreen';
import { ReportsScreen } from '@/screens/ReportsScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';

/**
 * Guscio dell'app: barra della finestra, colonna di navigazione, schermata.
 * La barra dei lavori compare in fondo solo mentre un lavoro è in corso.
 *
 * Prima c'erano anche una barra in alto (titolo, libreria di sessione, tema,
 * modalità) e una in basso (stato del motore, percorso del database). Il
 * titolo ora sta nella schermata, tema e notifiche in fondo alla colonna, e lo
 * stato del motore si fa vedere solo quando qualcosa non va.
 */
export function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceProvider>
        <LibraryProvider>
          <NotificationsProvider>
            <JobsProvider>
              <RouterProvider>
                <Shell />
              </RouterProvider>
            </JobsProvider>
          </NotificationsProvider>
        </LibraryProvider>
      </WorkspaceProvider>
    </TooltipProvider>
  );
}

function Shell() {
  const { ready, onboarded, isDark, motion: motionPref } = useAppState();
  const { route, rememberScroll, scrollFor } = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const prevRoute = useRef(route);

  useEffect(() => {
    const open = () => setShortcutsOpen(true);
    window.addEventListener('crateforge:shortcuts', open);
    return () => window.removeEventListener('crateforge:shortcuts', open);
  }, []);

  // Scorciatoie globali: aprono strumenti, non eseguono mai azioni distruttive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hasMod(e) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (!typing && e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
      }
      if (hasMod(e) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setCollapsed((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tornando su una schermata si ritrova il punto in cui la si era lasciata.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevRoute.current !== route) {
      rememberScroll(prevRoute.current, el.scrollTop);
      prevRoute.current = route;
    }
    el.scrollTop = scrollFor(route);
  }, [route, rememberScroll, scrollFor]);

  const toaster = (
    <Toaster
      theme={isDark ? 'dark' : 'light'}
      position="bottom-right"
      offset={20}
      toastOptions={{
        classNames: {
          toast: 'group rounded-card border border-line bg-surface-2 text-ink-hi shadow-e2 font-sans',
          description: 'text-ink-mid',
          actionButton: 'bg-accent text-accent-ink rounded-chip',
          cancelButton: 'bg-surface-3 text-ink-mid rounded-chip'
        }
      }}
    />
  );

  if (!ready) return <div className="h-full bg-canvas" />;

  if (!onboarded) {
    return (
      <>
        <Welcome />
        {toaster}
      </>
    );
  }

  return (
    <MotionConfig reducedMotion={motionPref === 'reduce' ? 'always' : 'user'}>
      <div className="flex h-full flex-col bg-canvas">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((v) => !v)}
            onOpenPalette={() => setPaletteOpen(true)}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
              <div className="relative min-h-full">
                <AnimatePresence initial={false}>
                  <motion.main
                    key={route}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, position: 'absolute', inset: 0 }}
                    transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                    className="mx-auto max-w-[1280px] px-8 py-7"
                  >
                    <Screen route={route} />
                  </motion.main>
                </AnimatePresence>
              </div>
            </div>
            <JobBar />
          </div>
        </div>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        {toaster}
      </div>
    </MotionConfig>
  );
}

function Screen({ route }: { route: RouteId }) {
  switch (route) {
    case 'library':
      return <LibraryScreen />;
    case 'fix':
      return <FixScreen />;
    case 'sync':
      return <SyncScreen />;
    case 'sets':
      return <SetsScreen />;
    case 'playlists':
      return <PlaylistScreen />;
    case 'backup':
      return <BackupScreen />;
    case 'reports':
      return <ReportsScreen />;
    case 'settings':
      return <SettingsScreen />;
  }
}
