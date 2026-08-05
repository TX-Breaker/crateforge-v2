import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Toaster } from 'sonner';
import { useAppState } from '@/lib/appState';
import { RouterProvider, useRouter } from '@/lib/router';
import { JobsProvider } from '@/lib/jobs';
import { LibraryProvider } from '@/lib/library';
import { WorkspaceProvider } from '@/lib/workspace';
import { SessionDialog } from '@/components/SessionDialog';
import { NotificationsProvider } from '@/lib/notifications';
import { TooltipProvider } from '@/components/ui/misc';
import { hasMod } from '@/lib/platform';
import { TitleBar } from '@/app/shell/TitleBar';
import { Sidebar } from '@/app/shell/Sidebar';
import { Topbar } from '@/app/shell/Topbar';
import { JobBar } from '@/app/shell/JobBar';
import { Statusbar } from '@/app/shell/Statusbar';
import { CommandPalette } from '@/components/CommandPalette';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { FirstRun } from '@/pages/onboarding/FirstRun';
import { OverviewPage } from '@/pages/OverviewPage';
import { HealthPage } from '@/pages/HealthPage';
import { TracksPage } from '@/pages/TracksPage';
import { BackupPage } from '@/pages/BackupPage';
import { CleanupPage } from '@/pages/CleanupPage';
import { RelocatePage } from '@/pages/RelocatePage';
import { EnrichPage } from '@/pages/EnrichPage';
import { SetsPage } from '@/pages/SetsPage';
import { ArrivalsPage } from '@/pages/ArrivalsPage';
import { ConvertPage } from '@/pages/ConvertPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { ActivityPage } from '@/pages/ActivityPage';
import { SettingsPage } from '@/pages/SettingsPage';

/**
 * Shell dell'app (§3 del design system). Cinque zone persistenti: chrome della
 * finestra, sidebar, topbar, barra job, statusbar. Le tre strisce orizzontali
 * non si smontano mai: un job in corso e lo stato del motore di lettura
 * sopravvivono a ogni navigazione.
 */
export function App() {
  return (
    <TooltipProvider delayDuration={350}>
      {/* La sessione sta sopra la libreria: è la libreria a dover sapere da
          quale software sta leggendo, non il contrario. */}
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
  const { route, params, rememberScroll, scrollFor } = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const prevRoute = useRef(route);

  // Scorciatoie globali. Nessuna di queste può innescare un'azione distruttiva:
  // al massimo aprono la pagina che la contiene (§07).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hasMod(e) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable);
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

  /* Memoria dello scroll per rotta: tornare su una pagina non deve far
     ricominciare la lettura dall'inizio.
     Il ripristino avviene in useLayoutEffect, cioè DOPO che la rotta nuova è
     montata e prima che il browser dipinga: scriverlo nell'effetto del cambio
     rotta lo applicava all'altezza della pagina uscente, che lo tagliava — e
     la posizione andava persa proprio nelle pagine lunghe, le uniche in cui
     serviva. */
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevRoute.current !== route) {
      rememberScroll(prevRoute.current, el.scrollTop);
      prevRoute.current = route;
    }
    el.scrollTop = scrollFor(route);
  }, [route, rememberScroll, scrollFor]);

  if (!ready) {
    return <div className="h-full bg-canvas" />;
  }

  if (!onboarded) {
    return (
      <>
        <FirstRun />
        <Toaster theme={isDark ? 'dark' : 'light'} position="bottom-right" />
      </>
    );
  }

  /* `prefers-reduced-motion` e l'impostazione dell'app devono spegnere ANCHE
     le animazioni di framer-motion, che non passano dal CSS: senza questo, la
     regola in index.css copriva le transizioni ma non le pagine e la barra
     job. Un solo punto invece di toccare ogni motion.div. */
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
          <Topbar />
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            {/* Dissolvenza INCROCIATA da 220ms: le due schermate si
                sovrappongono. Con `mode="wait"` il cambio pagina durava 440ms
                con il canvas vuoto in mezzo, e non era una dissolvenza ma una
                staffetta. Niente scivolamento verticale: la specifica per il
                cambio di pagina prevede solo l'opacità. */}
            <div className="relative min-h-full">
              <AnimatePresence initial={false}>
                <motion.main
                  key={route}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, position: 'absolute', inset: 0 }}
                  transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
                  className="p-6"
                >
                  <Route route={route} params={params} />
                </motion.main>
              </AnimatePresence>
            </div>
          </div>
          <JobBar />
          <Statusbar />
        </div>
      </div>

      {/* Prima cosa a ogni avvio: su quale libreria si lavora. */}
      <SessionDialog />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <Toaster
        theme={isDark ? 'dark' : 'light'}
        position="bottom-right"
        offset={56}
        toastOptions={{
          classNames: {
            toast:
              'group rounded-card border border-line bg-surface-2 text-ink-hi shadow-e2 font-sans',
            description: 'text-ink-mid',
            actionButton: 'bg-accent text-accent-ink rounded-chip',
            cancelButton: 'bg-surface-3 text-ink-mid rounded-chip'
          }
        }}
      />
    </div>
    </MotionConfig>
  );
}

function Route({ route, params }: { route: string; params?: Record<string, string> }) {
  switch (route) {
    case 'overview':
      return <OverviewPage />;
    case 'health':
      return <HealthPage />;
    case 'tracks':
      return (
        <TracksPage
          initialSearch={params?.search}
          initialFilter={params?.filter}
          initialCamelot={params?.camelot}
          initialBpm={params?.bpm}
        />
      );
    case 'backup':
      return <BackupPage />;
    case 'cleanup':
      return <CleanupPage />;
    case 'relocate':
      return <RelocatePage />;
    case 'enrich':
      return <EnrichPage />;
    case 'sets':
      return <SetsPage />;
    case 'arrivals':
      return <ArrivalsPage />;
    case 'convert':
      return <ConvertPage />;
    case 'reports':
      return <ReportsPage />;
    case 'activity':
      return <ActivityPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <OverviewPage />;
  }
}
