import { toast } from 'sonner';
import { exportApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { EmptyState } from '../components/common/LoadingState';
import PageHeader from '../components/ui/PageHeader';

const EXPORT_FORMATS = [
  { format: 'json' as const, label: 'JSON', icon: '{ }', description: 'Complete structured export including all findings, scorecard, and AI assessment', color: 'border-blue-500/30 hover:border-blue-400' },
  { format: 'csv' as const, label: 'CSV', icon: '⊞', description: 'Findings table in CSV format for import into Excel or Google Sheets', color: 'border-green-500/30 hover:border-green-400' },
  { format: 'markdown' as const, label: 'Markdown', icon: '#', description: 'Markdown report suitable for Confluence, GitHub, or Notion', color: 'border-emerald-500/30 hover:border-emerald-400' },
  { format: 'html' as const, label: 'HTML Report', icon: '🖨', description: 'Printable executive report with scores, findings, and recommendations', color: 'border-amber-500/30 hover:border-amber-400' },
];

export default function ExportCenter() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  const handleDownload = (format: 'json' | 'csv' | 'markdown' | 'html', label: string) => {
    if (!selectedScanId) {
      toast.error('Select a completed scan first');
      return;
    }
    try {
      exportApi.download(selectedScanId, selectedOrgId, format);
      toast.success(`Downloading ${label} export…`);
    } catch {
      toast.error(`Failed to start ${label} export`);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Export Center" subtitle="Download health check results in various formats" />

      {!selectedScanId ? (
        <EmptyState message="Select a completed scan to export" />
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            {EXPORT_FORMATS.map(({ format, label, icon, description, color }) => (
              <button
                key={format}
                type="button"
                className={`card w-full text-left cursor-pointer border-2 transition-all ${color}`}
                onClick={() => handleDownload(format, label)}
              >
                <div className="flex items-start gap-4">
                  <div className="text-2xl font-mono w-10 text-center">{icon}</div>
                  <div>
                    <h3 className="font-semibold text-ink">{label}</h3>
                    <p className="text-sm text-ink-muted mt-1">{description}</p>
                    <span className="mt-3 inline-block text-sm text-dd-purple font-medium hover:text-dd-purple-dark">
                      Download {label} →
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="card bg-amber-500/10 border-amber-500/30">
            <h3 className="text-sm font-semibold text-amber-400 mb-2">Export Security Notice</h3>
            <ul className="text-sm text-amber-400 space-y-1 list-disc list-inside">
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
