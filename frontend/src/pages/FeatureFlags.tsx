import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { featureFlagsApi } from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonText } from '../components/ui/Skeleton';
import FilterChip, { FilterChipRow } from '../components/ui/FilterChip';
import type { FeatureFlagState } from '../types';
import type { FeatureNodeType } from '../types';

type CategoryFilter = 'all' | FeatureNodeType;

const CATEGORY_OPTIONS: CategoryFilter[] = ['all', 'scan', 'collector', 'rule', 'page', 'section'];

function nodeMatches(node: FeatureFlagState, query: string, category: CategoryFilter): boolean {
  const matchesCategory = category === 'all' || node.nodeType === category;
  if (!matchesCategory) return false;
  if (!query) return true;
  return node.label.toLowerCase().includes(query) || node.key.toLowerCase().includes(query);
}

// Keeps a node's whole subtree as-is once it matches (so managing a matched
// parent still shows all its children); otherwise recurses and keeps the node
// only as a path down to matching descendants, dropping non-matching siblings.
function filterTree(nodes: FeatureFlagState[], query: string, category: CategoryFilter): FeatureFlagState[] {
  const result: FeatureFlagState[] = [];
  for (const node of nodes) {
    if (nodeMatches(node, query, category)) {
      result.push(node);
      continue;
    }
    const filteredChildren = filterTree(node.children, query, category);
    if (filteredChildren.length > 0) {
      result.push({ ...node, children: filteredChildren });
    }
  }
  return result;
}

// Counts, per node type, how many nodes in the whole tree match the current
// search text (ignoring the category filter itself, so chip counts update
// live as you type without the selected chip zeroing out the others).
function countByType(nodes: FeatureFlagState[], query: string): Record<string, number> {
  const counts: Record<string, number> = {};
  function walk(list: FeatureFlagState[]) {
    for (const node of list) {
      if (nodeMatches(node, query, 'all')) {
        counts[node.nodeType] = (counts[node.nodeType] ?? 0) + 1;
      }
      walk(node.children);
    }
  }
  walk(nodes);
  return counts;
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-dd-purple' : 'bg-surface-sunken border border-border-strong'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

const NODE_TYPE_LABELS: Record<string, string> = {
  scan: 'Scan',
  collector: 'Collector',
  rule: 'Rule',
  page: 'Page',
  section: 'Section',
};

function FlagRow({
  node,
  depth,
  onToggle,
  pending,
}: {
  node: FeatureFlagState;
  depth: number;
  onToggle: (key: string, enabled: boolean, label: string) => void;
  pending: boolean;
}) {
  // Disabled only because an ancestor is off — the node's own preference is still
  // "on" underneath, so toggling it here would have no visible effect until the
  // ancestor is re-enabled. Grey it out and make the switch non-interactive.
  const disabledByParent = node.storedEnabled && !node.effectiveEnabled;

  return (
    <div>
      <div
        className={`flex items-center gap-3 py-2 border-b border-border last:border-b-0 ${
          disabledByParent ? 'opacity-50' : ''
        }`}
        style={{ paddingLeft: `${depth * 1.5}rem` }}
      >
        <Toggle
          checked={node.storedEnabled}
          disabled={disabledByParent || pending}
          onChange={() => onToggle(node.key, !node.storedEnabled, node.label)}
        />
        <span className="text-xs font-semibold text-ink-faint uppercase tracking-wide w-20 shrink-0">
          {NODE_TYPE_LABELS[node.nodeType] ?? node.nodeType}
        </span>
        <span className="text-sm text-ink font-medium truncate">{node.label}</span>
        <code className="text-xs text-ink-faint font-mono truncate">{node.key}</code>
        {disabledByParent && (
          <span className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 ml-auto shrink-0">
            disabled by parent
          </span>
        )}
      </div>
      {node.children.map((child) => (
        <FlagRow key={child.key} node={child} depth={depth + 1} onToggle={onToggle} pending={pending} />
      ))}
    </div>
  );
}

export default function FeatureFlags() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const { data: tree, isLoading } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: featureFlagsApi.getTree,
  });

  const normalizedSearch = search.trim().toLowerCase();

  const filteredTree = useMemo(
    () => filterTree(tree ?? [], normalizedSearch, category),
    [tree, normalizedSearch, category]
  );

  const typeCounts = useMemo(() => countByType(tree ?? [], normalizedSearch), [tree, normalizedSearch]);
  const totalCount = Object.values(typeCounts).reduce((sum, n) => sum + n, 0);

  const toggleMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean; label: string }) =>
      featureFlagsApi.setEnabled(key, enabled),
    onSuccess: (updatedTree, variables) => {
      qc.setQueryData(['feature-flags'], updatedTree);
      toast.success(`${variables.label} ${variables.enabled ? 'enabled' : 'disabled'} — saved`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update feature flag');
    },
  });

  const handleToggle = (key: string, enabled: boolean, label: string) => {
    toggleMutation.mutate({ key, enabled, label });
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-8">
        <PageHeader title="Feature Flags" subtitle="Enable or disable scan collectors, assessment rules, and pages." />
        <div className="card space-y-4">
          <SkeletonText lines={6} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Feature Flags"
        subtitle="Disabling a node disables every node beneath it — a stored 'on' preference underneath a disabled parent is preserved but has no effect until the parent is re-enabled."
      />

      <div className="space-y-3">
        <input
          type="text"
          placeholder="Search by label or key..."
          className="input w-full text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FilterChipRow>
          {CATEGORY_OPTIONS.map((c) => (
            <FilterChip
              key={c}
              label={NODE_TYPE_LABELS[c] ?? 'All'}
              count={c === 'all' ? totalCount : (typeCounts[c] ?? 0)}
              active={category === c}
              onClick={() => setCategory(c)}
            />
          ))}
        </FilterChipRow>
      </div>

      <div className="card">
        {filteredTree.length === 0 ? (
          <div className="text-xs text-ink-faint px-1 py-4 text-center">
            No flags match {search ? `"${search}"` : 'this filter'}.
          </div>
        ) : (
          filteredTree.map((node) => (
            <FlagRow key={node.key} node={node} depth={0} onToggle={handleToggle} pending={toggleMutation.isPending} />
          ))
        )}
      </div>
    </div>
  );
}
