import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { featureFlagsApi } from '../services/api';
import type { FeatureFlagState } from '../types';

interface FeatureFlagsContextValue {
  tree: FeatureFlagState[];
  flat: Map<string, FeatureFlagState>;
  isPageEnabled: (featureKey?: string) => boolean;
  isLoading: boolean;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  tree: [],
  flat: new Map(),
  // Fail open before the tree has loaded / for pages with no featureKey at all —
  // an always-on page should never flash a "disabled" state while flags load.
  isPageEnabled: () => true,
  isLoading: false,
});

function flatten(nodes: FeatureFlagState[], out: Map<string, FeatureFlagState>): void {
  for (const node of nodes) {
    out.set(node.key, node);
    flatten(node.children, out);
  }
}

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: featureFlagsApi.getTree,
    staleTime: 30_000,
  });

  const tree = data ?? [];

  const flat = useMemo(() => {
    const map = new Map<string, FeatureFlagState>();
    flatten(tree, map);
    return map;
  }, [tree]);

  const isPageEnabled = useMemo(() => {
    return (featureKey?: string): boolean => {
      if (!featureKey) return true;
      const node = flat.get(featureKey);
      if (!node) return true; // unknown key (always-on page) — fail open
      return node.effectiveEnabled;
    };
  }, [flat]);

  const value = useMemo(
    () => ({ tree, flat, isPageEnabled, isLoading }),
    [tree, flat, isPageEnabled, isLoading]
  );

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlagsContext() {
  return useContext(FeatureFlagsContext);
}
