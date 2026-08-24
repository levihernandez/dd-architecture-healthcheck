import { useLocation } from 'react-router-dom';

// The Feature Flags admin page is hidden by default — it's an operator tool,
// not something most users should stumble into. Visiting any page with
// ?view_ff=true unlocks it for the rest of the browser session (persisted in
// sessionStorage, since the query param itself won't survive client-side
// navigation to a different route); ?view_ff=false re-hides it.
const STORAGE_KEY = 'dd_view_ff';

export function useViewFeatureFlagsUi(): boolean {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const param = params.get('view_ff');

  if (param === 'true') {
    sessionStorage.setItem(STORAGE_KEY, 'true');
    return true;
  }
  if (param === 'false') {
    sessionStorage.removeItem(STORAGE_KEY);
    return false;
  }
  return sessionStorage.getItem(STORAGE_KEY) === 'true';
}
