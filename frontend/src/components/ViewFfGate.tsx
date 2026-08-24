import type { ReactNode } from 'react';
import { useViewFeatureFlagsUi } from '../hooks/useViewFeatureFlagsUi';

// Guards operator-only pages (currently just Feature Flags) that stay hidden
// from navigation by default — this catches direct URL access too, not just
// the nav links, since hiding the link alone doesn't stop someone typing the
// path in directly. Doesn't reuse FeatureDisabledState since that page links
// back to /feature-flags, which would be a dead loop here.
export default function ViewFfGate({ children }: { children: ReactNode }) {
  const viewFfEnabled = useViewFeatureFlagsUi();

  if (!viewFfEnabled) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-24 px-6 gap-3">
        <div className="text-3xl">🚩</div>
        <h2 className="text-lg font-semibold text-ink">Page not found</h2>
        <p className="text-sm text-ink-faint max-w-md">
          This page isn't part of the normal navigation.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
