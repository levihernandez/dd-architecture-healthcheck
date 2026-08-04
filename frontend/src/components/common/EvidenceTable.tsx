import type { Finding } from '../../types';

interface EvidenceTableProps {
  findings: Finding[];
  onFindingClick?: (f: Finding) => void;
}

export default function EvidenceTable({ findings, onFindingClick }: EvidenceTableProps) {
  if (findings.length === 0) return null;

  return (
    <div className="space-y-3">
      {findings.map((finding) => (
        <div
          key={finding.id}
          className="border border-gray-200 rounded-lg overflow-hidden cursor-pointer hover:border-dd-purple transition-colors"
          onClick={() => onFindingClick?.(finding)}
        >
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-gray-900">{finding.title}</p>
              <div className="flex gap-1 shrink-0">
                <span className="badge bg-gray-200 text-gray-600 uppercase text-xs">{finding.ruleId}</span>
              </div>
            </div>
          </div>
          <div className="px-4 py-3">
            <p className="text-sm text-gray-600 mb-2">{finding.description}</p>
            {finding.evidence.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {finding.evidence.map((ev, i) => (
                  <div key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-200">
                    <span className="font-medium">{ev.description}</span>
                    {ev.source && <span className="text-blue-500 ml-1">({ev.source})</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="text-xs text-gray-500">
              <strong>Recommendation:</strong> {finding.recommendation}
            </div>
            {finding.affectedCount > 0 && (
              <div className="mt-1 text-xs text-gray-500">
                <strong>Affected:</strong> {finding.affectedCount} of {finding.totalCount}
                {finding.totalCount > 0 && ` (${finding.percentage}%)`}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
