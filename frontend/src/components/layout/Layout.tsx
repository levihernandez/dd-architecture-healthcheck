import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Toaster } from 'sonner';
import Sidebar from './Sidebar';
import Header from './Header';
import FloatingChat from '../chat/FloatingChat';
import CommandPalette from '../ui/CommandPalette';
import HubTabs from '../ui/HubTabs';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useRecentPages } from '../../hooks/usePinnedPages';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { trackVisit } = useRecentPages();

  useEffect(() => {
    trackVisit(location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useKeyboardShortcuts({
    'g o': () => navigate('/overview'),
    'g s': () => navigate('/scans'),
    'g i': () => navigate('/inventory'),
    'g t': () => navigate('/tagging-scorecard'),
    'g r': () => navigate('/recommendations'),
  });

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* Caps line length on ultra-wide monitors and keeps every page's
             content centered under the sidebar+header chrome, regardless of
             whether that page also sets its own (narrower) max-w wrapper. */}
          <div className="max-w-[1600px] mx-auto w-full">
            <HubTabs />
            {/* flex+justify-center (rather than requiring every page to remember
               mx-auto on its own max-w wrapper) centers whatever width a page
               declares — including pages with no max-w at all, which simply
               stretch to fill this row instead of being clipped or skewed. */}
            <div className="flex justify-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </main>
      </div>
      <FloatingChat />
      <CommandPalette />
      <Toaster position="bottom-right" richColors closeButton theme="dark" />
    </div>
  );
}
