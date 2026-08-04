import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { orgsApi } from '../services/api';
import { useOrgs } from '../hooks/useOrgs';
import OrgConnectionForm from '../components/forms/OrgConnectionForm';
import { ScanStatusBadge } from '../components/common/StatusBadge';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCard } from '../components/ui/Skeleton';
import { formatDistanceToNow } from 'date-fns';
import type { Org } from '../types';

export default function OrgConnections() {
  const { data: orgs = [], isLoading } = useOrgs();
  const [showForm, setShowForm] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Org | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [validateResult, setValidateResult] = useState<Record<string, { valid: boolean; message: string }>>({});
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const qc = useQueryClient();

  const deleteOrg = useMutation({
    mutationFn: orgsApi.delete,
    onSuccess: (_data, orgId) => {
      const org = orgs.find((o) => o.id === orgId);
      toast.success(`Removed "${org?.name ?? 'organization'}"`);
      qc.invalidateQueries({ queryKey: ['orgs'] });
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to remove organization'),
    onSettled: () => setConfirmingDeleteId(null),
  });

  const validate = async (org: Org) => {
    setValidatingId(org.id);
    try {
      const result = await orgsApi.validate(org.id);
      setValidateResult((prev) => ({
        ...prev,
        [org.id]: {
          valid: result.valid,
          message: result.valid ? `Connected — org: ${result.orgName}` : result.error ?? 'Invalid',
        },
      }));
      if (!result.valid) toast.error(result.error ?? `Validation failed for "${org.name}"`);
    } catch (err) {
      toast.error((err as Error)?.message ?? `Failed to validate "${org.name}"`);
    } finally {
      setValidatingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl space-y-6">
        <PageHeader title="Org Connections" subtitle="Manage Datadog organization credentials" />
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Org Connections"
        subtitle="Manage Datadog organization credentials"
        actions={
          <button
            className="btn-primary"
            onClick={() => {
              setShowForm(!showForm);
              setEditingOrg(null);
            }}
          >
            {showForm ? '✕ Cancel' : '+ Add Organization'}
          </button>
        }
      />

      {showForm && (
        <div className="card">
          <h2 className="text-lg font-semibold text-ink mb-4">Connect New Organization</h2>
          <OrgConnectionForm
            onSuccess={() => {
              setShowForm(false);
              toast.success('Organization connected');
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {editingOrg && (
        <div className="card">
          <h2 className="text-lg font-semibold text-ink mb-4">Edit Keys — {editingOrg.name}</h2>
          <OrgConnectionForm
            org={editingOrg}
            onSuccess={() => {
              setEditingOrg(null);
              toast.success('Keys updated');
            }}
            onCancel={() => setEditingOrg(null)}
          />
        </div>
      )}

      {orgs.length === 0 && !showForm ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-4">🔗</div>
          <h3 className="text-lg font-semibold text-ink mb-2">No organizations connected</h3>
          <p className="text-ink-muted mb-4">Add your first Datadog organization to start a health check</p>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            Connect Organization
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => (
            <div key={org.id} className="card">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-base font-semibold text-ink">{org.name}</h3>
                    {org.ddOrgName && org.ddOrgName !== org.name && (
                      <span className="text-xs text-ink-faint">({org.ddOrgName})</span>
                    )}
                    <ScanStatusBadge status={org.lastScanStatus ?? 'pending'} />
                    {org.sessionOnly && (
                      <span className="badge bg-amber-100 text-amber-700">Session Only</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex gap-4 text-sm text-ink-muted flex-wrap">
                    <span>Site: <code className="text-xs bg-surface-sunken px-1 rounded">{org.site}</code></span>
                    {org.lastScanAt && (
                      <span>Last scan: {formatDistanceToNow(new Date(org.lastScanAt), { addSuffix: true })}</span>
                    )}
                    {org.ddOrgId && (
                      <span>DD Org ID: <code className="text-xs bg-surface-sunken px-1 rounded">{org.ddOrgId}</code></span>
                    )}
                  </div>

                  {validateResult[org.id] && (
                    <div className={`mt-2 text-sm px-3 py-1.5 rounded ${
                      validateResult[org.id].valid
                        ? 'bg-green-50 text-green-700'
                        : 'bg-red-50 text-red-700'
                    }`}>
                      {validateResult[org.id].valid ? '✓' : '✗'} {validateResult[org.id].message}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {confirmingDeleteId === org.id ? (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-md px-3 py-1.5 animate-fade-in">
                      <span className="text-xs text-red-700">Delete "{org.name}" and all scan data?</span>
                      <button
                        className="btn-danger text-xs"
                        disabled={deleteOrg.isPending}
                        onClick={() => deleteOrg.mutate(org.id)}
                      >
                        {deleteOrg.isPending ? 'Removing...' : 'Confirm'}
                      </button>
                      <button
                        className="btn-ghost text-xs"
                        disabled={deleteOrg.isPending}
                        onClick={() => setConfirmingDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className="btn-secondary text-xs"
                        disabled={validatingId === org.id}
                        onClick={() => validate(org)}
                      >
                        {validatingId === org.id ? 'Validating...' : 'Validate'}
                      </button>
                      <button
                        className="btn-secondary text-xs"
                        onClick={() => {
                          setEditingOrg(org);
                          setShowForm(false);
                        }}
                      >
                        Edit Keys
                      </button>
                      <button
                        className="btn-danger text-xs"
                        onClick={() => setConfirmingDeleteId(org.id)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card bg-blue-50 border-blue-200">
        <h3 className="text-sm font-semibold text-blue-800 mb-2">Security Notice</h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li>API and App keys are encrypted using AES before storage</li>
          <li>Keys are never logged, exported, or sent to AI providers</li>
          <li>Only read-only Datadog API endpoints are used</li>
          <li>Use "Session Only" mode to avoid persisting keys at all</li>
        </ul>
      </div>
    </div>
  );
}
