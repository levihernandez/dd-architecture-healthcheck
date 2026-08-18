import { Link } from 'react-router-dom';

// Simple centered message shown by FeatureGate when a page's feature flag
// (or one of its ancestors — scan/collector/rule) is disabled.
export default function FeatureDisabledState() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-6 gap-3">
      <div className="text-3xl">🚩</div>
      <h2 className="text-lg font-semibold text-ink">This feature is currently disabled</h2>
      <p className="text-sm text-ink-faint max-w-md">
        An admin has turned this page off, either directly or by disabling a collector or scan step it depends on.
      </p>
      <Link to="/feature-flags" className="btn-secondary mt-2">
        Manage Feature Flags
      </Link>
    </div>
  );
}
