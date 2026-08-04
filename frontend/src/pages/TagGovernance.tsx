import { useQuery } from '@tanstack/react-query';
import { taggingApi } from '../services/api';
import LoadingState, { EmptyState } from '../components/common/LoadingState';

function ConsistencyRing({ score }: { score: number }) {
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  const r = 34;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={80} height={80} viewBox="0 0 80 80">
      <circle cx={40} cy={40} r={r} fill="none" stroke="#e5e7eb" strokeWidth={6} />
      <circle cx={40} cy={40} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        transform="rotate(-90 40 40)" />
      <text x={40} y={41} textAnchor="middle" dominantBaseline="middle"
        fontSize={16} fontWeight="bold" fill={color}>{score}</text>
    </svg>
  );
}

const DRIFT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  missing_in_org: { label: 'Missing in Org', color: 'bg-red-100 text-red-700' },
  value_inconsistency: { label: 'Value Inconsistency', color: 'bg-orange-100 text-orange-700' },
  partial_adoption: { label: 'Partial Adoption', color: 'bg-amber-100 text-amber-700' },
  naming_drift: { label: 'Naming Drift', color: 'bg-yellow-100 text-yellow-700' },
};

export default function TagGovernance() {
  const { data: governance, isLoading } = useQuery({
    queryKey: ['tag-governance'],
    queryFn: () => taggingApi.governance(),
  });

  if (isLoading) return <LoadingState />;
  if (!governance) return <EmptyState message="No multi-org governance data available. Connect at least two orgs and run scans." />;

  const { orgSummaries, inconsistencies, valueDrift, consistencyScore, globalTagKeys, commonTagKeys, orphanTagKeys } = governance;

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Multi-Org Tag Governance</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cross-organization tag consistency analysis — identify drift, missing standards, and orphan tags across all connected orgs.
        </p>
      </div>

      {/* Summary row */}
      <div className="flex gap-6 items-center card">
        <ConsistencyRing score={consistencyScore} />
        <div className="flex-1 grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-gray-900">{orgSummaries.length}</div>
            <div className="text-xs text-gray-500">Orgs Analyzed</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-violet-700">{globalTagKeys.length}</div>
            <div className="text-xs text-gray-500">Global Tag Keys</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">{commonTagKeys.length}</div>
            <div className="text-xs text-gray-500">Common Across All</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-red-600">{inconsistencies.length + valueDrift.length}</div>
            <div className="text-xs text-gray-500">Issues Found</div>
          </div>
        </div>
      </div>

      {/* Per-org overview */}
      {orgSummaries.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3">Organization Tag Profiles</h2>
          <div className="grid grid-cols-2 gap-4">
            {orgSummaries.map((org) => {
              const ustKeys = ['env', 'service', 'version', 'team'];
              const ustPresent = ustKeys.filter((k) => org.tagKeys.includes(k));
              const ustMissing = ustKeys.filter((k) => !org.tagKeys.includes(k));
              return (
                <div key={org.orgId} className="card">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-semibold text-gray-900">{org.orgName}</div>
                      <div className="text-xs text-gray-400">{org.tagKeys.length} tag keys detected</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold ${ustPresent.length === 4 ? 'text-green-600' : ustPresent.length >= 2 ? 'text-amber-600' : 'text-red-600'}`}>
                        {ustPresent.length}/4 UST
                      </div>
                      <div className="text-xs text-gray-400">Unified Service Tags</div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                      {ustPresent.map((k) => (
                        <span key={k} className="text-xs bg-green-50 border border-green-200 text-green-700 px-1.5 py-0.5 rounded font-mono">{k} ✓</span>
                      ))}
                      {ustMissing.map((k) => (
                        <span key={k} className="text-xs bg-red-50 border border-red-200 text-red-600 px-1.5 py-0.5 rounded font-mono">{k} ✗</span>
                      ))}
                    </div>

                    {Object.entries(org.tagValues).slice(0, 3).map(([key, values]) => (
                      <div key={key} className="text-xs text-gray-500">
                        <code className="text-violet-600">{key}:</code>{' '}
                        <span>{(values as string[]).slice(0, 4).join(', ')}{(values as string[]).length > 4 ? ` +${(values as string[]).length - 4}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* UST inconsistencies */}
      {inconsistencies.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Standard Tag Inconsistencies</h2>
          <p className="text-sm text-gray-500 mb-3">
            Unified Service Tags (env, service, version, team) that are missing or inconsistently applied across orgs.
            These block cross-org dashboards, monitors, and SLO federation.
          </p>
          <div className="space-y-3">
            {inconsistencies.map((issue, i) => {
              const cfg = DRIFT_TYPE_LABELS[issue.type] ?? { label: issue.type, color: 'bg-gray-100 text-gray-600' };
              return (
                <div key={i} className="card border-l-4 border-red-400">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <code className="text-sm font-mono text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">{issue.tagKey}</code>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                        <span className="text-xs text-gray-400">{issue.orgsAffected.length} orgs affected</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mb-2">
                        {issue.orgsWithKey.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-green-600 mb-1">Present in</div>
                            <div className="flex flex-wrap gap-1">
                              {issue.orgsWithKey.map((o) => (
                                <span key={o} className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-200">{o}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {issue.orgsMissing.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-red-600 mb-1">Missing from</div>
                            <div className="flex flex-wrap gap-1">
                              {issue.orgsMissing.map((o) => (
                                <span key={o} className="text-xs bg-red-50 text-red-700 px-1.5 py-0.5 rounded border border-red-200">{o}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="text-xs">
                        <span className="font-semibold text-blue-600 uppercase tracking-wide">Recommendation: </span>
                        <span className="text-gray-600">{issue.recommendation}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Value drift */}
      {valueDrift.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Value Drift Across Orgs</h2>
          <p className="text-sm text-gray-500 mb-3">
            The same tag key uses different values in different orgs — e.g. <code className="text-xs bg-gray-100 px-1 rounded">env:production</code> vs <code className="text-xs bg-gray-100 px-1 rounded">env:prod</code>.
            This breaks cross-org monitors, dashboards, and SLO rollups.
          </p>
          <div className="space-y-3">
            {valueDrift.map((drift, i) => (
              <div key={i} className="card border-l-4 border-amber-400">
                <div className="flex items-center gap-2 mb-3">
                  <code className="text-sm font-mono text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">{drift.tagKey}</code>
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Value Drift</span>
                  <span className="text-xs text-gray-400">{drift.orgsAffected.length} orgs</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-left py-1 pr-4 font-semibold">Org</th>
                        <th className="text-left py-1 font-semibold">Values in use</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {Object.entries(drift.valuesByOrg).map(([org, values]) => (
                        <tr key={org}>
                          <td className="py-1.5 pr-4 font-medium text-gray-700 whitespace-nowrap">{org}</td>
                          <td className="py-1.5">
                            <div className="flex flex-wrap gap-1">
                              {(values as string[]).map((v) => (
                                <code key={v} className="bg-orange-50 border border-orange-200 text-orange-700 px-1.5 py-0.5 rounded">{v}</code>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="text-xs mt-3 pt-2 border-t border-gray-100">
                  <span className="font-semibold text-blue-600 uppercase tracking-wide">Recommendation: </span>
                  <span className="text-gray-600">{drift.recommendation}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Common tag keys */}
      {commonTagKeys.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Tags Common to All Orgs</h2>
          <p className="text-sm text-gray-500 mb-3">These keys are consistently present across every connected org — they form your de facto global tagging standard.</p>
          <div className="flex flex-wrap gap-2">
            {commonTagKeys.map((k) => (
              <code key={k} className="text-sm bg-green-50 border border-green-200 text-green-800 px-2.5 py-1 rounded font-mono">{k}</code>
            ))}
          </div>
        </section>
      )}

      {/* Orphan tags */}
      {Object.keys(orphanTagKeys).length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Orphan Tag Keys</h2>
          <p className="text-sm text-gray-500 mb-3">
            Tag keys that appear in only one org — these may be one-off experiments, legacy keys, or candidates for standardization.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(orphanTagKeys).map(([orgName, keys]) => (
              <div key={orgName} className="card">
                <div className="font-medium text-gray-800 mb-2 text-sm">{orgName}</div>
                <div className="flex flex-wrap gap-1">
                  {(keys as string[]).slice(0, 20).map((k) => (
                    <code key={k} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{k}</code>
                  ))}
                  {(keys as string[]).length > 20 && (
                    <span className="text-xs text-gray-400">+{(keys as string[]).length - 20} more</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
