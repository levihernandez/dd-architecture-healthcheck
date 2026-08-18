import axios from 'axios';
import type {
  Org, ScanRun, OrgScorecard, Finding, AIAssessment,
  InventorySummary, TagAnalysisRow, PaginatedResponse, FindingCategory, FindingSeverity,
  OrgContextData, ScanComparisonResult
} from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Org context (Getting to Know You)
export const orgContextApi = {
  get: (orgId: string) => api.get<OrgContextData | null>(`/orgs/${orgId}/context`).then(r => r.data),
  put: (orgId: string, data: OrgContextData) => api.put<OrgContextData>(`/orgs/${orgId}/context`, data).then(r => r.data),
};

// Org's selected tagging template — used across the app once selected.
export const tagTemplateApi = {
  get: (orgId: string) =>
    api.get<import('../types').OrgTagTemplateSelection | null>(`/orgs/${orgId}/tag-template`).then((r) => r.data),
  set: (orgId: string, templateId: string) =>
    api.put<import('../types').OrgTagTemplateSelection>(`/orgs/${orgId}/tag-template`, { templateId }).then((r) => r.data),
};

// Orgs
export const orgsApi = {
  list: () => api.get<Org[]>('/orgs').then((r) => r.data),
  get: (id: string) => api.get<Org>(`/orgs/${id}`).then((r) => r.data),
  create: (data: { name: string; site: string; apiKey: string; appKey: string; sessionOnly?: boolean }) =>
    api.post<Org>('/orgs', data).then((r) => r.data),
  update: (id: string, data: Partial<{ name: string; site: string; apiKey: string; appKey: string }>) =>
    api.put<Org>(`/orgs/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/orgs/${id}`).then((r) => r.data),
  validate: (id: string) => api.post<{ valid: boolean; orgName?: string; error?: string }>(`/orgs/${id}/validate`).then((r) => r.data),
  overview: () => api.get<Array<Org & { scorecard: OrgScorecard | null }>>('/orgs/overview').then((r) => r.data),
};

// Scans
export const scansApi = {
  list: (orgId: string) => api.get<ScanRun[]>('/scans', { params: { orgId } }).then((r) => r.data),
  get: (id: string) => api.get<ScanRun>(`/scans/${id}`).then((r) => r.data),
  start: (orgId: string, collectors?: string[]) =>
    api.post<ScanRun>('/scans', { orgId, collectors }).then((r) => r.data),
  getScorecard: (scanRunId: string) => api.get<OrgScorecard>(`/scans/${scanRunId}/scorecard`).then((r) => r.data),
  getFindings: (scanRunId: string, params?: { category?: string; severity?: string }) =>
    api.get<Finding[]>(`/scans/${scanRunId}/findings`, { params }).then((r) => r.data),
  getPermissions: (scanRunId: string) =>
    api.get<Array<{ endpoint: string; status: string; error?: string; tested_at: string }>>(`/scans/${scanRunId}/permissions`).then((r) => r.data),
  remove: (id: string) => api.delete<void>(`/scans/${id}`).then((r) => r.data),
  compare: (scanRunId: string, against?: string) =>
    api.get<ScanComparisonResult>(`/scans/${scanRunId}/compare`, { params: against ? { against } : undefined }).then((r) => r.data),
};

// Inventory
export const inventoryApi = {
  summary: (orgId: string, scanRunId: string) =>
    api.get<InventorySummary>('/inventory/summary', { params: { orgId, scanRunId } }).then((r) => r.data),
  hosts: (orgId: string, scanRunId: string, params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<PaginatedResponse<Record<string, unknown>>>('/inventory/hosts', { params: { orgId, scanRunId, ...params } }).then((r) => r.data),
  services: (orgId: string, scanRunId: string, params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<PaginatedResponse<Record<string, unknown>>>('/inventory/services', { params: { orgId, scanRunId, ...params } }).then((r) => r.data),
  monitors: (orgId: string, scanRunId: string, params?: { page?: number; pageSize?: number }) =>
    api.get<PaginatedResponse<Record<string, unknown>>>('/inventory/monitors', { params: { orgId, scanRunId, ...params } }).then((r) => r.data),
  dashboards: (orgId: string, scanRunId: string, params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<PaginatedResponse<Record<string, unknown>>>('/inventory/dashboards', { params: { orgId, scanRunId, ...params } }).then((r) => r.data),
  synthetics: (orgId: string, scanRunId: string, params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<PaginatedResponse<Record<string, unknown>>>('/inventory/synthetics', { params: { orgId, scanRunId, ...params } }).then((r) => r.data),
  slos: (orgId: string, scanRunId: string, params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<PaginatedResponse<Record<string, unknown>>>('/inventory/slos', { params: { orgId, scanRunId, ...params } }).then((r) => r.data),
  tags: (orgId: string, scanRunId: string) =>
    api.get<TagAnalysisRow[]>('/inventory/tags', { params: { orgId, scanRunId } }).then((r) => r.data),
  cloud: (orgId: string, scanRunId: string) =>
    api.get<import('../types').CloudInventory>('/inventory/cloud', { params: { orgId, scanRunId } }).then((r) => r.data),
  productSignals: (orgId: string, scanRunId: string) =>
    api.get<Array<{ product: string; signal: string; value: string; detected: number }>>('/inventory/product-signals', { params: { orgId, scanRunId } }).then((r) => r.data),
  tagCoverage: (orgId: string, scanRunId: string) =>
    api.get<{
      layers: {
        hosts: { total: number; env: number | null; service: number | null; version: number | null; team: number | null };
        services: { total: number; env: number | null; service: number | null; version: number | null; team: number | null };
        monitors: { total: number; env: number | null; service: number | null; team: number | null };
        synthetics: { total: number; env: number | null; service: number | null };
      };
      detectedTagKeys: string[];
    }>('/inventory/tag-coverage', { params: { orgId, scanRunId } }).then((r) => r.data),
  hostGaps: (orgId: string, scanRunId: string) =>
    api.get<import('../types').HostGapAnalysis>('/inventory/host-gaps', { params: { orgId, scanRunId } }).then((r) => r.data),
};

// Tagging Intelligence
export const taggingApi = {
  dictionary: () =>
    api.get<unknown[]>('/tagging/dictionary').then((r) => r.data),
  normalization: (orgId: string, scanRunId: string) =>
    api.get<import('../types').NormalizationResult>('/tagging/normalization', { params: { orgId, scanRunId } }).then((r) => r.data),
  cloudAlignment: (orgId: string, scanRunId: string) =>
    api.get<import('../types').CloudAlignmentResult>('/tagging/cloud-alignment', { params: { orgId, scanRunId } }).then((r) => r.data),
  propagation: (orgId: string, scanRunId: string) =>
    api.get<import('../types').PropagationResult>('/tagging/propagation', { params: { orgId, scanRunId } }).then((r) => r.data),
  templates: () =>
    api.get<import('../types').TemplateSummary[]>('/tagging/templates').then((r) => r.data),
  templateDetail: (templateId: string) =>
    api.get<import('../types').IndustryTemplateDetail>(`/tagging/templates/${templateId}`).then((r) => r.data),
  score: (orgId: string, scanRunId: string, templateId: string) =>
    api.get<import('../types').TemplateScore>('/tagging/score', { params: { orgId, scanRunId, templateId } }).then((r) => r.data),
  detectTemplate: (orgId: string, scanRunId: string) =>
    api.get<{ recommended: string }>('/tagging/detect-template', { params: { orgId, scanRunId } }).then((r) => r.data),
  governance: () =>
    api.get<import('../types').GovernanceResult>('/tagging/governance').then((r) => r.data),
  costReadiness: (orgId: string, scanRunId: string) =>
    api.get<import('../types').CostReadinessResult>('/tagging/cost-readiness', { params: { orgId, scanRunId } }).then((r) => r.data),
  policyGuidance: () =>
    api.get<import('../types').TagPolicyLayer[]>('/tagging/policy-guidance').then((r) => r.data),
  tagEnforcement: () =>
    api.get<import('../types').TagEnforcementRow[]>('/tagging/tag-enforcement').then((r) => r.data),
  policyResources: () =>
    api.get<import('../types').TagPolicyResource[]>('/tagging/policy-resources').then((r) => r.data),
  implementationGuide: (orgId: string, scanRunId: string, mode: import('../types').TaggingMode, mechanism?: import('../types').HardMechanism) =>
    api.get<import('../types').ImplementationGuideResult>('/tagging/implementation-guide', { params: { orgId, scanRunId, mode, mechanism } }).then((r) => r.data),
};

// Analytics
export const analyticsApi = {
  get: (orgId: string, scanRunId: string) =>
    api.get<import('../types').AnalyticsData>('/analytics', { params: { orgId, scanRunId } }).then(r => r.data),
  tagDetail: (orgId: string, scanRunId: string, tagKey: string) =>
    api.get<import('../types').TagDetail>('/inventory/tag-detail', { params: { orgId, scanRunId, tagKey } }).then(r => r.data),
};

// Usage & Plan data
export const usageApi = {
  get: (orgId: string, scanRunId?: string) =>
    api.get<import('../types').UsageData | null>('/usage', { params: { orgId, ...(scanRunId ? { scanRunId } : {}) } }).then(r => r.data),
};

export const eventsApi = {
  stats: (orgId: string, scanRunId?: string) =>
    api.get<import('../types').EventStatsData | null>('/events/stats', { params: { orgId, ...(scanRunId ? { scanRunId } : {}) } }).then(r => r.data),
};

// Feature flags (Scan -> Collector -> Rule/Page admin toggles)
export const featureFlagsApi = {
  getTree: () => api.get<import('../types').FeatureFlagState[]>('/feature-flags').then(r => r.data),
  setEnabled: (key: string, enabled: boolean) =>
    api.patch<import('../types').FeatureFlagState[]>(`/feature-flags/${encodeURIComponent(key)}`, { enabled }).then(r => r.data),
};

export const pricingSnapshotsApi = {
  latest: () => api.get<import('../types').PricingSnapshot[]>('/pricing-snapshots/latest').then(r => r.data),
  all: () => api.get<import('../types').PricingSnapshot[]>('/pricing-snapshots').then(r => r.data),
  history: (product: string) =>
    api.get<import('../types').PricingSnapshot[]>(`/pricing-snapshots/history/${encodeURIComponent(product)}`).then(r => r.data),
};

export const sizingSnapshotsApi = {
  list: () => api.get<import('../types').SizingSnapshotSummary[]>('/sizing-snapshots').then(r => r.data),
  get: (id: string) => api.get<import('../types').SizingSnapshotRecord>(`/sizing-snapshots/${id}`).then(r => r.data),
  create: (data: {
    name: string; mode: string; orgId?: string; orgName?: string;
    totalListPrice: number; totalRealCost?: number; categoryCount: number;
    cart: import('../types').SizingSnapshotCartItem[]; state: Record<string, unknown>;
  }) => api.post<import('../types').SizingSnapshotRecord>('/sizing-snapshots', data).then(r => r.data),
  remove: (id: string) => api.delete(`/sizing-snapshots/${id}`).then(r => r.data),
};

// AI Settings
export const aiSettingsApi = {
  get: () => api.get<import('../types').AIProviderSettings>('/ai-settings').then(r => r.data),
  save: (data: { provider: string; model: string; apiKey?: string; clearKey?: boolean; baseUrl?: string }) =>
    api.put<{ ok: boolean; settings: import('../types').AIProviderSettings }>('/ai-settings', data).then(r => r.data),
  models: (qs: string) =>
    api.get<{ models: string[]; error?: string }>(`/ai-settings/models?${qs}`).then(r => r.data),
  test: () =>
    api.post<{ ok: boolean; message: string }>('/ai-settings/test').then(r => r.data),
  getPrompts: () =>
    api.get<import('../types').AIPromptDescriptor[]>('/ai-settings/prompts').then(r => r.data),
  savePrompt: (key: string, content: string) =>
    api.put<import('../types').AIPromptDescriptor>(`/ai-settings/prompts/${encodeURIComponent(key)}`, { content }).then(r => r.data),
};

// AI
export const aiApi = {
  generate: (orgId: string, scanRunId: string) =>
    api.post<AIAssessment>('/ai/assess', { orgId, scanRunId }).then((r) => r.data),
  get: (orgId: string, scanRunId: string) =>
    api.get<AIAssessment>(`/ai/assess/${scanRunId}`, { params: { orgId } })
      .then((r) => r.data)
      .catch((err) => {
        if (axios.isAxiosError(err) && err.response?.status === 404) return null;
        throw err;
      }),
};

// Export
export const exportApi = {
  download: (scanRunId: string, orgId: string, format: 'json' | 'csv' | 'markdown' | 'html') => {
    window.location.href = `/api/export/${scanRunId}?orgId=${orgId}&format=${format}`;
  },
};

export default api;
