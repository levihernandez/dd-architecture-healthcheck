// Feature flag hierarchy types: Scan -> Collector -> Rule/Page.
// See backend/src/feature-flags/registry.ts for the static tree definition
// and backend/src/feature-flags/repository.ts for read/write + effective-state computation.

export type FeatureNodeType = 'scan' | 'collector' | 'rule' | 'page' | 'section';

export interface FeatureNode {
  key: string;
  parentKey: string | null;
  nodeType: FeatureNodeType;
  label: string;
  collectorName?: string;
  ruleCategory?: string;
  pagePath?: string;
}

export interface FeatureFlagState extends FeatureNode {
  storedEnabled: boolean;
  effectiveEnabled: boolean;
  children: FeatureFlagState[];
}
