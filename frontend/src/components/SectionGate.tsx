import type { ReactNode } from 'react';
import { useFeatureFlags } from '../hooks/useFeatureFlags';

interface SectionGateProps {
  featureKey: string;
  children: ReactNode;
}

// Like FeatureGate, but for sub-page sections rather than whole routes: a
// disabled section renders nothing at all (no placeholder), since it sits
// alongside other content on the same page rather than occupying the page.
export default function SectionGate({ featureKey, children }: SectionGateProps) {
  const { isPageEnabled, isLoading } = useFeatureFlags();

  if (isLoading) return null;
  if (!isPageEnabled(featureKey)) return null;

  return <>{children}</>;
}
