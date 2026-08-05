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
          <HubTabs />
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
        </main>
      </div>
      <FloatingChat />
      <CommandPalette />
      <Toaster position="bottom-right" richColors closeButton theme="dark" />
    </div>
  );
}
