import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { hubFor, hubItems } from '../../lib/navigation';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';

/**
 * Horizontal tab bar linking sibling pages within the current nav hub
 * (e.g. Inventory Explorer / Cloud Inventory / Analytics / ...). Renders
 * nothing for single-page hubs. Existing routes are unchanged — this is
 * purely a navigation affordance so related pages read as one workspace.
 */
export default function HubTabs() {
  const { pathname } = useLocation();
  const { isPageEnabled } = useFeatureFlags();
  const hub = hubFor(pathname);
  if (!hub) return null;

  const items = hubItems(hub.id).filter((i) => isPageEnabled(i.featureKey));
  if (items.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 border-b border-border mb-6 -mt-2 overflow-x-auto">
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
              isActive
                ? 'border-dd-purple text-dd-purple'
                : 'border-transparent text-ink-muted hover:text-ink hover:border-border-strong'
            )
          }
        >
          <span className="text-xs">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}
