import axios from 'axios';
import type {
  Org, ScanRun, OrgScorecard, Finding, AIAssessment,
  InventorySummary, TagAnalysisRow, PaginatedResponse, FindingCategory, FindingSeverity,
  OrgContextData
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
  score: (orgId: string, scanRunId: string, templateId: string) =>
    api.get<import('../types').TemplateScore>('/tagging/score', { params: { orgId, scanRunId, templateId } }).then((r) => r.data),
  detectTemplate: (orgId: string, scanRunId: string) =>
    api.get<{ recommended: string }>('/tagging/detect-template', { params: { orgId, scanRunId } }).then((r) => r.data),
  governance: () =>
    api.get<import('../types').GovernanceResult>('/tagging/governance').then((r) => r.data),
  costReadiness: (orgId: string, scanRunId: string) =>
    api.get<import('../types').CostReadinessResult>('/tagging/cost-readiness', { params: { orgId, scanRunId } }).then((r) => r.data),
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

// AI Settings
export const aiSettingsApi = {
  get: () => api.get<import('../types').AIProviderSettings>('/ai-settings').then(r => r.data),
  save: (data: { provider: string; model: string; apiKey?: string; clearKey?: boolean; baseUrl?: string }) =>
    api.put<{ ok: boolean; settings: import('../types').AIProviderSettings }>('/ai-settings', data).then(r => r.data),
  models: (qs: string) =>
    api.get<{ models: string[]; error?: string }>(`/ai-settings/models?${qs}`).then(r => r.data),
  test: () =>
    api.post<{ ok: boolean; message: string }>('/ai-settings/test').then(r => r.data),
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
