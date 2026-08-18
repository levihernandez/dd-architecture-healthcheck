import type { ReactNode } from 'react';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { SkeletonText } from './ui/Skeleton';
import FeatureDisabledState from './FeatureDisabledState';

interface FeatureGateProps {
  featureKey: string;
  children: ReactNode;
}

export default function FeatureGate({ featureKey, children }: FeatureGateProps) {
  const { isPageEnabled, isLoading } = useFeatureFlags();

  if (isLoading) {
    return (
      <div className="p-6">
        <SkeletonText lines={3} />
      </div>
    );
  }

  if (!isPageEnabled(featureKey)) {
    return <FeatureDisabledState />;
  }

  return <>{children}</>;
}
