import { useFeatureFlagsContext } from '../context/FeatureFlagsContext';

// Thin hook wrapper over FeatureFlagsContext, matching the app's other
// useXyz-wraps-a-context hooks (e.g. useOrgScanContext).
export function useFeatureFlags() {
  return useFeatureFlagsContext();
}
