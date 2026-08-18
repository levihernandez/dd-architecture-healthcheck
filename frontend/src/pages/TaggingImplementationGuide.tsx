import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { taggingApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import LoadingState, { EmptyState } from '../components/common/LoadingState';
import PageHeader from '../components/ui/PageHeader';
import type { HardMechanism, TaggingMode } from '../types';

const MODES: Array<{ value: TaggingMode; label: string; description: string }> = [
  { value: 'hard', label: 'Hard tagging', description: 'Enforced at the source — Terraform, Ansible, SCOM, or Fleet Automation' },
  { value: 'soft', label: 'Soft tagging', description: 'Applied directly in the Datadog UI/API — fastest fix, doesn\'t survive a redeploy' },
];

const MECHANISMS: Array<{ value: HardMechanism; label: string }> = [
  { value: 'terraform', label: 'Terraform' },
  { value: 'ansible', label: 'Ansible' },
  { value: 'scom', label: 'SCOM' },
  { value: 'fleet_automation', label: 'Fleet Automation' },
];

export default function TaggingImplementationGuide() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const [mode, setMode] = useState<TaggingMode>('hard');
  const [mechanism, setMechanism] = useState<HardMechanism>('terraform');

  const { data: guide, isLoading, isError } = useQuery({
    queryKey: ['tagging-impl-guide', selectedOrgId, selectedScanId, mode, mechanism],
    queryFn: () => taggingApi.implementationGuide(selectedOrgId, selectedScanId, mode, mode === 'hard' ? mechanism : undefined),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  function copyPrompt() {
    if (!guide) return;
    navigator.clipboard.writeText(guide.promptText)
      .then(() => toast.success('Prompt copied — paste it into Bits AI'))
      .catch(() => toast.error('Failed to copy to clipboard'));
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Tagging Implementation Guide"
        subtitle="Turn real tagging gaps from this scan into a mechanism-aware prompt for Bits AI"
      />

      <div className="card space-y-4">
        <div>
          <p className="text-sm font-medium text-ink mb-2">How will tags be applied?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={clsx(
                  'text-left rounded-lg border px-3 py-2.5 transition-colors',
                  mode === m.value
                    ? 'border-dd-purple bg-dd-purple/5 ring-1 ring-dd-purple/40'
                    : 'border-border hover:border-border-strong'
                )}
              >
                <div className="text-sm font-medium text-ink">{m.label}</div>
                <div className="text-xs text-ink-faint mt-0.5">{m.description}</div>
              </button>
            ))}
          </div>
        </div>

        {mode === 'hard' && (
          <div>
            <p className="text-sm font-medium text-ink mb-2">Which mechanism?</p>
            <div className="flex flex-wrap gap-2">
              {MECHANISMS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMechanism(m.value)}
                  className={clsx(
                    'badge border transition-colors',
                    mechanism === m.value
                      ? 'border-dd-purple bg-dd-purple/10 text-dd-purple'
                      : 'border-border text-ink-muted hover:border-border-strong'
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!selectedOrgId || !selectedScanId ? (
        <EmptyState message="Select an org and a completed scan to generate an implementation guide" />
      ) : isLoading ? (
        <LoadingState />
      ) : isError || !guide ? (
        <EmptyState message="Couldn't load the implementation guide for this scan" />
      ) : (
        <>
          {guide.mechanismWarning && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
              {guide.mechanismWarning}
            </div>
          )}

          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">
                {guide.gaps.length} tagging gap{guide.gaps.length === 1 ? '' : 's'} found in this scan
              </h3>
            </div>
            {guide.gaps.length === 0 ? (
              <p className="text-sm text-ink-muted">No tagging gaps found — coverage already meets best-practice thresholds.</p>
            ) : (
              <ul className="space-y-2">
                {guide.gaps.map((g) => (
                  <li key={g.ruleId} className="text-sm border border-border rounded-lg px-3 py-2">
                    <span className="font-medium text-ink">{g.tagKey}</span>
                    <span className="text-ink-faint"> — {g.affectedCount}/{g.totalCount} resources ({g.percentage}% covered)</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Generated prompt for Bits AI</h3>
              <button className="btn-secondary text-xs px-3 py-1.5" onClick={copyPrompt}>
                Copy for Bits AI
              </button>
            </div>
            <pre className="text-xs text-ink-muted bg-surface-sunken border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
              {guide.promptText}
            </pre>
          </div>

          {guide.staticReference.length > 0 && (
            <div className="card space-y-3">
              <h3 className="text-sm font-semibold text-ink">How this works</h3>
              <ul className="space-y-3">
                {guide.staticReference.map((layer) => (
                  <li key={layer.layer} className="text-sm">
                    <p className="font-medium text-ink">{layer.layer}</p>
                    <p className="text-ink-faint text-xs mt-0.5">{layer.where}</p>
                    <p className="text-ink-muted mt-1">{layer.mechanism}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
