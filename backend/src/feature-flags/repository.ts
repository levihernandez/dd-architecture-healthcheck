import { getDatabase } from '../db/database';
import { logger } from '../utils/logger';
import { FEATURE_TREE, RULE_COLLECTOR_DEPENDENCIES } from './registry';
import type { FeatureFlagState, FeatureNode } from './types';

interface FeatureFlagRow {
  key: string;
  parent_key: string | null;
  node_type: string;
  enabled: number;
  updated_at: string;
}

const NODE_BY_KEY = new Map(FEATURE_TREE.map((n) => [n.key, n]));

// Cache of key -> effectiveEnabled, invalidated on any write. Cheap to rebuild
// (the tree is tiny and static) so a full recompute on invalidation is fine.
let flatCache: Map<string, boolean> | null = null;

function invalidateCache(): void {
  flatCache = null;
}

async function loadStoredEnabled(): Promise<Map<string, boolean>> {
  const db = getDatabase();
  const rows = await db<{ key: string; enabled: number }>('feature_flags').select('key', 'enabled');
  const map = new Map<string, boolean>();
  for (const row of rows) map.set(row.key, row.enabled === 1);
  return map;
}

// effectiveEnabled(node) = storedEnabled(node) AND effectiveEnabled(parent).
// Computed at read time — a disabled ancestor never overwrites a descendant's
// own stored row.
function computeEffective(stored: Map<string, boolean>): Map<string, boolean> {
  const effective = new Map<string, boolean>();

  function resolve(key: string): boolean {
    if (effective.has(key)) return effective.get(key) as boolean;
    const node = NODE_BY_KEY.get(key);
    const own = stored.get(key) ?? true; // missing row (shouldn't happen post-seed) fails open
    const value = node?.parentKey ? own && resolve(node.parentKey) : own;
    effective.set(key, value);
    return value;
  }

  for (const node of FEATURE_TREE) resolve(node.key);
  return effective;
}

function buildTree(stored: Map<string, boolean>, effective: Map<string, boolean>): FeatureFlagState[] {
  const nodesByParent = new Map<string | null, FeatureNode[]>();
  for (const node of FEATURE_TREE) {
    const list = nodesByParent.get(node.parentKey) ?? [];
    list.push(node);
    nodesByParent.set(node.parentKey, list);
  }

  function toState(node: FeatureNode): FeatureFlagState {
    const children = (nodesByParent.get(node.key) ?? []).map(toState);
    return {
      ...node,
      storedEnabled: stored.get(node.key) ?? true,
      effectiveEnabled: effective.get(node.key) ?? true,
      children,
    };
  }

  return (nodesByParent.get(null) ?? []).map(toState);
}

export const FeatureFlagRepository = {
  // INSERT OR IGNORE one row per FEATURE_TREE entry, enabled=1. Call once at
  // boot, right after runMigrations() has created the table.
  async seedDefaults(): Promise<void> {
    const db = getDatabase();
    const now = new Date().toISOString();

    const rows = FEATURE_TREE.map((node) => ({
      key: node.key,
      parent_key: node.parentKey,
      node_type: node.nodeType,
      enabled: 1,
      updated_at: now,
    }));

    await db('feature_flags').insert(rows).onConflict('key').ignore();
    invalidateCache();
    logger.info(`[feature-flags] Seeded ${FEATURE_TREE.length} default flag(s)`);
  },

  async getTree(): Promise<FeatureFlagState[]> {
    const stored = await loadStoredEnabled();
    const effective = computeEffective(stored);
    return buildTree(stored, effective);
  },

  async getFlatEffective(): Promise<Map<string, boolean>> {
    if (flatCache) return flatCache;
    const stored = await loadStoredEnabled();
    flatCache = computeEffective(stored);
    return flatCache;
  },

  async setEnabled(key: string, enabled: boolean): Promise<void> {
    if (!NODE_BY_KEY.has(key)) {
      throw new Error(`Unknown feature flag key: ${key}`);
    }
    const db = getDatabase();
    const now = new Date().toISOString();
    await db('feature_flags').where({ key }).update({ enabled: enabled ? 1 : 0, updated_at: now });
    invalidateCache();
  },

  // Fail-open (returns true) if the node isn't found — this should only happen
  // for a genuine data bug (e.g. a collector renamed without updating the registry).
  async isCollectorEnabled(collectorName: string): Promise<boolean> {
    const key = `collector.${collectorName}`;
    if (!NODE_BY_KEY.has(key)) return true;
    const effective = await this.getFlatEffective();
    return effective.get(key) ?? true;
  },

  async isRuleCategoryEnabled(category: string): Promise<boolean> {
    const key = `rule.${category}`;
    if (!NODE_BY_KEY.has(key)) return true;
    const effective = await this.getFlatEffective();
    const ownEnabled = effective.get(key) ?? true;
    if (!ownEnabled) return false;

    const dependencies = RULE_COLLECTOR_DEPENDENCIES[category];
    if (!dependencies) return true;
    for (const collectorName of dependencies) {
      if (!(await this.isCollectorEnabled(collectorName))) return false;
    }
    return true;
  },
};
