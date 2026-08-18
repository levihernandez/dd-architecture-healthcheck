import { useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { HUBS, NAV_ITEMS, findNavItem } from '../../lib/navigation';
import { usePinnedPages, useRecentPages } from '../../hooks/usePinnedPages';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';

const COLLAPSED_GROUPS_KEY = 'dd-hc:collapsed-nav-groups';

function readCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

interface PinnedRowProps {
  path: string;
  onUnpin: () => void;
  onNavigate: () => void;
}

function PinnedRow({ path, onUnpin, onNavigate }: PinnedRowProps) {
  const item = NAV_ITEMS.find((i) => i.path === path);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: path });
  if (!item) return null;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="group flex items-center gap-1"
    >
      <span {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-ink-faint px-1 text-xs" aria-label={`Drag to reorder ${item.label}`}>
        ⠿
      </span>
      <NavLink
        to={item.path}
        onClick={onNavigate}
        className={({ isActive }) =>
          clsx(
            'flex-1 flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors min-w-0',
            isActive ? 'bg-dd-purple text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
          )
        }
      >
        <span className="text-sm w-4 text-center shrink-0">{item.icon}</span>
        <span className="truncate">{item.label}</span>
      </NavLink>
      <button
        onClick={onUnpin}
        aria-label={`Unpin ${item.label}`}
        className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-white px-1 text-xs"
      >
        ✕
      </button>
    </div>
  );
}

export default function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const [search, setSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(readCollapsed);
  const { pinned, togglePin, isPinned, reorderPinned } = usePinnedPages();
  const { recent } = useRecentPages();
  const { isPageEnabled } = useFeatureFlags();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function toggleGroup(hubId: string) {
    setCollapsedGroups((prev) => {
      const next = prev.includes(hubId) ? prev.filter((h) => h !== hubId) : [...prev, hubId];
      localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function handlePinDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    reorderPinned(arrayMove(pinned, pinned.indexOf(String(active.id)), pinned.indexOf(String(over.id))));
  }

  const filteredHubs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return HUBS.map((hub) => ({
      hub,
      items: NAV_ITEMS.filter((i) =>
        i.hub === hub.id && (!q || i.label.toLowerCase().includes(q)) && isPageEnabled(i.featureKey)
      ),
    })).filter((g) => g.items.length > 0);
  }, [search, isPageEnabled]);

  const recentItems = recent
    .map((path) => findNavItem(path))
    .filter((i): i is (typeof NAV_ITEMS)[number] => Boolean(i) && i?.path !== pathname && isPageEnabled(i?.featureKey))
    .slice(0, 4);

  const visiblePinned = pinned.filter((path) => isPageEnabled(NAV_ITEMS.find((i) => i.path === path)?.featureKey));

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-dd-purple flex items-center justify-center text-white font-display font-black text-sm shrink-0">
            DD
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-sm leading-none text-white truncate">Architecture</div>
            <div className="text-ink-faint text-xs mt-0.5 truncate tracking-wide">Health Check</div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-3 shrink-0">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pages…"
            className="w-full bg-gray-800 text-gray-200 placeholder-gray-500 text-sm rounded pl-7 pr-2 py-1.5 outline-none focus:ring-1 focus:ring-dd-purple-light"
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint text-xs">⌕</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {/* Pinned */}
        {visiblePinned.length > 0 && (
          <div className="mb-4">
            <div className="px-3 py-1 text-xs font-semibold text-ink-faint uppercase tracking-wider mb-1">Pinned</div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePinDragEnd}>
              <SortableContext items={visiblePinned} strategy={verticalListSortingStrategy}>
                <div className="space-y-0.5">
                  {visiblePinned.map((path) => (
                    <PinnedRow key={path} path={path} onUnpin={() => togglePin(path)} onNavigate={onNavigate ?? (() => {})} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

        {/* Recently viewed */}
        {!search && recentItems.length > 0 && (
          <div className="mb-4">
            <div className="px-3 py-1 text-xs font-semibold text-ink-faint uppercase tracking-wider mb-1">Recently viewed</div>
            {recentItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onNavigate}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded text-sm text-ink-faint hover:bg-gray-800 hover:text-white transition-colors"
              >
                <span className="text-sm w-4 text-center shrink-0">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </NavLink>
            ))}
          </div>
        )}

        {/* Groups */}
        {filteredHubs.map(({ hub, items }) => {
          const isCollapsed = collapsedGroups.includes(hub.id) && !search;
          return (
            <div key={hub.id} className="mb-2">
              <button
                onClick={() => toggleGroup(hub.id)}
                className="w-full flex items-center justify-between px-3 py-1 text-xs font-semibold text-ink-faint uppercase tracking-wider mb-1 hover:text-gray-300"
              >
                <span>{hub.label}</span>
                <span className={clsx('transition-transform text-[10px]', isCollapsed && '-rotate-90')}>▾</span>
              </button>
              {!isCollapsed && (
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <div key={item.path} className="group flex items-center">
                      <NavLink
                        to={item.path}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          clsx(
                            'flex-1 flex items-center gap-2.5 px-3 py-1.5 rounded text-sm transition-colors min-w-0',
                            isActive ? 'bg-dd-purple text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                          )
                        }
                      >
                        <span className="text-sm w-4 text-center shrink-0">{item.icon}</span>
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                      <button
                        onClick={() => togglePin(item.path)}
                        aria-label={isPinned(item.path) ? `Unpin ${item.label}` : `Pin ${item.label}`}
                        className={clsx(
                          'px-2 text-xs shrink-0',
                          isPinned(item.path) ? 'text-amber-400' : 'text-ink-muted opacity-0 group-hover:opacity-100 hover:text-white'
                        )}
                      >
                        {isPinned(item.path) ? '★' : '☆'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-gray-800 text-xs text-ink-faint shrink-0">
        <div>Read-only Datadog API</div>
        <div>Local SQLite storage</div>
      </div>
    </div>
  );
}
