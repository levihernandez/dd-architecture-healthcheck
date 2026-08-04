import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orgsApi } from '../../services/api';
import { DATADOG_SITES } from '../../types';
import type { Org } from '../../types';

interface OrgConnectionFormProps {
  org?: Org;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function OrgConnectionForm({ org, onSuccess, onCancel }: OrgConnectionFormProps) {
  const isEdit = Boolean(org);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: org?.name ?? '',
    site: org?.site ?? ('datadoghq.com' as string),
    customSite: '',
    apiKey: '',
    appKey: '',
    sessionOnly: false,
  });
  const [showKeys, setShowKeys] = useState(false);

  const createMutation = useMutation({
    mutationFn: orgsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgs'] });
      onSuccess?.();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; site?: string; apiKey?: string; appKey?: string }) =>
      orgsApi.update(org!.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgs'] });
      onSuccess?.();
    },
  });

  const { mutate, isPending, error, isError } = isEdit ? updateMutation : createMutation;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEdit) {
      const updates: { name?: string; site?: string; apiKey?: string; appKey?: string } = {};
      if (form.apiKey) updates.apiKey = form.apiKey;
      if (form.appKey) updates.appKey = form.appKey;
      if (!updates.apiKey && !updates.appKey) {
        onCancel?.();
        return;
      }
      (updateMutation.mutate as (v: typeof updates) => void)(updates);
      return;
    }
    (createMutation.mutate as (v: { name: string; site: string; apiKey: string; appKey: string; sessionOnly: boolean }) => void)({
      name: form.name,
      site: form.site === 'custom' ? form.customSite : form.site,
      apiKey: form.apiKey,
      appKey: form.appKey,
      sessionOnly: form.sessionOnly,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm">
          {(error as Error)?.message ?? 'Failed to connect. Check credentials.'}
        </div>
      )}

      {!isEdit && (
        <div className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Organization</h3>
          <div>
            <label className="label">Organization Display Name</label>
            <input
              type="text" className="input" placeholder="Production Org"
              value={form.name} required
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Datadog Site</label>
            <select
              className="input"
              value={form.site}
              onChange={(e) => setForm({ ...form, site: e.target.value })}
            >
              {DATADOG_SITES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
              <option value="custom">Custom Site</option>
            </select>
            {form.site === 'custom' && (
              <input
                type="text" className="input mt-2" placeholder="your.custom.site.com"
                value={form.customSite} required
                onChange={(e) => setForm({ ...form, customSite: e.target.value })}
              />
            )}
          </div>
        </div>
      )}

      <div className="space-y-4 pt-1 border-t border-border first:border-t-0 first:pt-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Credentials</h3>
          <button type="button" onClick={() => setShowKeys(!showKeys)} className="text-xs text-ink-faint hover:text-ink-muted">
            {showKeys ? 'Hide' : 'Show'} keys
          </button>
        </div>

        {isEdit && (
          <p className="text-sm text-ink-muted">
            Leave a field blank to keep its current stored value. Only fill in the keys you want to replace.
          </p>
        )}

        <div>
          <label className="label">API Key</label>
          <input
            type={showKeys ? 'text' : 'password'}
            className="input font-mono" placeholder={isEdit ? 'Leave blank to keep current key' : '••••••••••••••••••••••••••••••••'}
            value={form.apiKey} required={!isEdit} minLength={form.apiKey ? 8 : undefined}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            autoComplete="off"
          />
          <p className="text-xs text-ink-faint mt-1">Keys are encrypted before storage. Never logged or exported.</p>
        </div>

        <div>
          <label className="label">Application Key</label>
          <input
            type={showKeys ? 'text' : 'password'}
            className="input font-mono" placeholder={isEdit ? 'Leave blank to keep current key' : '••••••••••••••••••••••••••••••••••••••••'}
            value={form.appKey} required={!isEdit} minLength={form.appKey ? 8 : undefined}
            onChange={(e) => setForm({ ...form, appKey: e.target.value })}
            autoComplete="off"
          />
        </div>

        {!isEdit && (
          <div className="flex items-center gap-2">
            <input
              type="checkbox" id="sessionOnly"
              checked={form.sessionOnly}
              onChange={(e) => setForm({ ...form, sessionOnly: e.target.checked })}
              className="rounded border-border-strong"
            />
            <label htmlFor="sessionOnly" className="text-sm text-ink-muted">
              Session only (do not persist credentials)
            </label>
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-md px-4 py-3 text-sm text-blue-700">
        <strong>Read-only access only.</strong> This tool makes only GET requests to the Datadog API.
        No configurations are modified.
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" className="btn-primary" disabled={isPending}>
          {isPending ? (isEdit ? 'Saving...' : 'Validating & Connecting...') : (isEdit ? 'Save Keys' : 'Connect Organization')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
