import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import SidebarContent from './SidebarContent';
import { NAV_ITEMS } from '../../lib/navigation';
import { usePinnedPages } from '../../hooks/usePinnedPages';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';

const RAIL_KEY = 'dd-hc:sidebar-collapsed';

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(RAIL_KEY) === '1');
  const { pinned } = usePinnedPages();
  const { isPageEnabled } = useFeatureFlags();

  function toggle() {
    setCollapsed((prev) => {
      localStorage.setItem(RAIL_KEY, prev ? '0' : '1');
      return !prev;
    });
  }

  if (collapsed) {
    const railItems = (pinned.length > 0 ? pinned : ['/overview', '/scans', '/inventory', '/tagging-scorecard'])
      .map((path) => NAV_ITEMS.find((i) => i.path === path))
      .filter((i): i is (typeof NAV_ITEMS)[number] => Boolean(i) && isPageEnabled(i?.featureKey));

    return (
      <aside className="hidden md:flex w-14 bg-surface-sunken flex-col items-center h-screen sticky top-0 py-4 gap-1 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-dd-purple flex items-center justify-center text-white font-display font-black text-xs mb-3">
          DD
        </div>
        {railItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            title={item.label}
            className={({ isActive }) =>
              clsx(
                'w-9 h-9 flex items-center justify-center rounded text-base transition-colors',
                isActive ? 'bg-dd-purple text-white' : 'text-ink-faint hover:bg-gray-800 hover:text-white'
              )
            }
          >
            {item.icon}
          </NavLink>
        ))}
        <button
          onClick={toggle}
          title="Expand sidebar"
          className="mt-auto w-9 h-9 flex items-center justify-center rounded text-ink-faint hover:bg-gray-800 hover:text-white"
        >
          »
        </button>
      </aside>
    );
  }

  return (
    <aside className="hidden md:flex w-64 bg-surface-sunken flex-col h-screen sticky top-0 shrink-0 relative">
      <SidebarContent />
      <button
        onClick={toggle}
        title="Collapse sidebar"
        className="absolute bottom-3 right-3 w-7 h-7 flex items-center justify-center rounded bg-gray-800 text-ink-faint hover:bg-gray-700 hover:text-white text-xs"
      >
        «
      </button>
    </aside>
  );
}
