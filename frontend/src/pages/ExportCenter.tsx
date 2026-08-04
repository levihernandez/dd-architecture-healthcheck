import { exportApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { EmptyState } from '../components/common/LoadingState';

const EXPORT_FORMATS = [
  { format: 'json' as const, label: 'JSON', icon: '{ }', description: 'Complete structured export including all findings, scorecard, and AI assessment', color: 'border-blue-200 hover:border-blue-400' },
  { format: 'csv' as const, label: 'CSV', icon: '⊞', description: 'Findings table in CSV format for import into Excel or Google Sheets', color: 'border-green-200 hover:border-green-400' },
  { format: 'markdown' as const, label: 'Markdown', icon: '#', description: 'Markdown report suitable for Confluence, GitHub, or Notion', color: 'border-purple-200 hover:border-purple-400' },
  { format: 'html' as const, label: 'HTML Report', icon: '🖨', description: 'Printable executive report with scores, findings, and recommendations', color: 'border-amber-200 hover:border-amber-400' },
];

export default function ExportCenter() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Export Center</h1>
          <p className="text-gray-500 text-sm mt-1">Download health check results in various formats</p>
        </div>
      </div>

      {!selectedScanId ? (
        <EmptyState message="Select a completed scan to export" />
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            {EXPORT_FORMATS.map(({ format, label, icon, description, color }) => (
              <div
                key={format}
                className={`card cursor-pointer border-2 transition-all ${color}`}
                onClick={() => exportApi.download(selectedScanId, selectedOrgId, format)}
              >
                <div className="flex items-start gap-4">
                  <div className="text-2xl font-mono w-10 text-center">{icon}</div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{label}</h3>
                    <p className="text-sm text-gray-500 mt-1">{description}</p>
                    <button className="mt-3 text-sm text-dd-purple font-medium hover:text-dd-purple-dark">
                      Download {label} →
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card bg-amber-50 border-amber-200">
            <h3 className="text-sm font-semibold text-amber-800 mb-2">Export Security Notice</h3>
            <ul className="text-sm text-amber-700 space-y-1 list-disc list-inside">
              <li>API keys and App keys are never included in any export</li>
              <li>All exports contain only collected metadata and assessment findings</li>
              <li>Raw JSON snapshots have credentials redacted before storage</li>
              <li>AI assessments receive only anonymized summary data, never raw credentials</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
