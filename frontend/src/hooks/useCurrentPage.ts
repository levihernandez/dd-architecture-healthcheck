import { useLocation } from 'react-router-dom';
import { findNavItem } from '../lib/navigation';

// Resolves the current route to its NAV_ITEMS entry, used to tell the backend
// which page's domain the AI chat should focus its context/assessment on.
export function useCurrentPage() {
  const location = useLocation();
  return findNavItem(location.pathname);
}
