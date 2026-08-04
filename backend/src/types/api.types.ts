// Internal API request/response types

import type { OrgConfig, DatadogSite } from './datadog.types';
import type { OrgScorecard, Finding, AIAssessmentResponse } from './assessment.types';

export interface CreateOrgRequest {
  name: string;
  site: DatadogSite;
  apiKey: string;
  appKey: string;
  sessionOnly?: boolean;
}

export interface UpdateOrgRequest {
  name?: string;
  site?: DatadogSite;
  apiKey?: string;
  appKey?: string;
}

export interface OrgResponse {
  id: string;
  name: string;
  site: DatadogSite;
  createdAt: string;
  updatedAt: string;
  sessionOnly: boolean;
  lastScanAt?: string;
  lastScanStatus?: string;
  ddOrgName?: string;
  ddOrgId?: string;
}

export interface ScanRunRequest {
  orgId: string;
  collectors?: string[];
}

export interface ScanRunResponse {
  id: string;
  orgId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
  collectorResults: CollectorResultSummary[];
  findingCount?: number;
}

export interface CollectorResultSummary {
  collector: string;
  status: 'success' | 'permission_denied' | 'not_available' | 'not_detected' | 'error';
  itemCount: number;
  error?: string;
  durationMs?: number;
}

export interface InventoryQueryParams {
  orgId?: string;
  scanRunId?: string;
  resourceType?: string;
  search?: string;
  hasTag?: string;
  missingTag?: string;
  env?: string;
  service?: string;
  team?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TagSummaryResponse {
  key: string;
  valueCount: number;
  hostCoverage: number;
  serviceCoverage: number;
  topValues: Array<{ value: string; count: number }>;
}

export interface ExportRequest {
  orgId?: string;
  scanRunId?: string;
  format: 'json' | 'csv' | 'markdown' | 'html';
  sections?: string[];
}

export interface PermissionsReportEntry {
  endpoint: string;
  status: 'success' | 'permission_denied' | 'not_available' | 'error';
  statusCode?: number;
  error?: string;
  testedAt: string;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  details?: unknown;
}

export type ScanWithFindings = ScanRunResponse & {
  scorecard?: OrgScorecard;
  topFindings?: Finding[];
  aiAssessment?: AIAssessmentResponse;
};
