import { Link, useLocation } from 'react-router-dom';
import { findNavItem, hubFor, hubItems } from '../../lib/navigation';

export default function Breadcrumbs() {
  const { pathname } = useLocation();
  const hub = hubFor(pathname);
  const item = findNavItem(pathname);

  if (!hub || !item) return null;

  const items = hubItems(hub.id);
  const isMultiPage = items.length > 1;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm min-w-0">
      <span className="text-ink-faint shrink-0">{hub.icon}</span>
      {isMultiPage ? (
        <Link to={items[0].path} className="text-ink-muted hover:text-ink shrink-0">
          {hub.label}
        </Link>
      ) : (
        <span className="text-ink-muted shrink-0">{hub.label}</span>
      )}
      {isMultiPage && (
        <>
          <span className="text-ink-faint shrink-0">/</span>
          <span className="text-ink font-medium truncate">{item.label}</span>
        </>
      )}
    </nav>
  );
}
