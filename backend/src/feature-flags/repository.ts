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

function loadStoredEnabled(): Map<string, boolean> {
  const db = getDatabase();
  const rows = db.prepare('SELECT key, enabled FROM feature_flags').all() as Array<{ key: string; enabled: number }>;
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
  seedDefaults(): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO feature_flags (key, parent_key, node_type, enabled, updated_at)
      VALUES (?, ?, ?, 1, ?)
    `);
    const txn = db.transaction(() => {
      for (const node of FEATURE_TREE) {
        insert.run(node.key, node.parentKey, node.nodeType, now);
      }
    });
    txn();
    invalidateCache();
    logger.info(`[feature-flags] Seeded ${FEATURE_TREE.length} default flag(s)`);
  },

  getTree(): FeatureFlagState[] {
    const stored = loadStoredEnabled();
    const effective = computeEffective(stored);
    return buildTree(stored, effective);
  },

  getFlatEffective(): Map<string, boolean> {
    if (flatCache) return flatCache;
    const stored = loadStoredEnabled();
    flatCache = computeEffective(stored);
    return flatCache;
  },

  setEnabled(key: string, enabled: boolean): void {
    if (!NODE_BY_KEY.has(key)) {
      throw new Error(`Unknown feature flag key: ${key}`);
    }
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare('UPDATE feature_flags SET enabled = ?, updated_at = ? WHERE key = ?')
      .run(enabled ? 1 : 0, now, key);
    invalidateCache();
  },

  // Fail-open (returns true) if the node isn't found — this should only happen
  // for a genuine data bug (e.g. a collector renamed without updating the registry).
  isCollectorEnabled(collectorName: string): boolean {
    const key = `collector.${collectorName}`;
    if (!NODE_BY_KEY.has(key)) return true;
    return this.getFlatEffective().get(key) ?? true;
  },

  isRuleCategoryEnabled(category: string): boolean {
    const key = `rule.${category}`;
    if (!NODE_BY_KEY.has(key)) return true;
    const ownEnabled = this.getFlatEffective().get(key) ?? true;
    if (!ownEnabled) return false;

    const dependencies = RULE_COLLECTOR_DEPENDENCIES[category];
    if (!dependencies) return true;
    return dependencies.every((collectorName) => this.isCollectorEnabled(collectorName));
  },
};
