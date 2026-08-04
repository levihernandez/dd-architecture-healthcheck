// Shared frontend types

export interface OrgContextData {
  industry: string | null;
  businessDescription: string | null;
  techStack: string[];
  cloudProviders: string[];
  endUserScale: string | null;
  transactionVolume: string | null;
  deviceCount: string | null;
  tier0Description: string | null;
  tier1Description: string | null;
  tier2Description: string | null;
  tier0UptimeTarget: string | null;
  tier1UptimeTarget: string | null;
  revenueImpactPerHour: string | null;
  seasonalityDescription: string | null;
  peakPeriods: string[];
  complianceFrameworks: string[];
  devTeamSize: string | null;
  hasDedicatedSRE: boolean;
  oncallSetup: string | null;
  currentPainPoints: string[];
  ddGoals: string[];
  additionalContext: string | null;
  updatedAt: string | null;
}

export type DatadogSite =
  | 'datadoghq.com' | 'us3.datadoghq.com' | 'us5.datadoghq.com'
  | 'datadoghq.eu' | 'ap1.datadoghq.com' | 'ap2.datadoghq.com'
  | 'ddog-gov.com' | string;

export type ScoreGrade = 'excellent' | 'good' | 'needs_attention' | 'critical';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingCategory =
  | 'unified_tagging' | 'service_architecture' | 'integration_hygiene'
  | 'logs_health' | 'monitors_health' | 'dashboards_health'
  | 'synthetics_health' | 'network_cloud' | 'governance';

export interface Org {
  id: string;
  name: string;
  site: DatadogSite;
  createdAt: string;
  updatedAt: string;
  sessionOnly: boolean;
  lastScanAt?: string;
  lastScanStatus?: 'success' | 'error' | 'running' | 'pending';
  ddOrgName?: string;
  ddOrgId?: string;
}

export interface ScanRun {
  id: string;
  orgId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
  collectorResults: CollectorResult[];
  findingCount?: number;
  scorecard?: OrgScorecard;
  topFindings?: Finding[];
}

export interface CollectorResult {
  collector: string;
  status: 'success' | 'permission_denied' | 'not_available' | 'not_detected' | 'error';
  itemCount: number;
  error?: string;
  durationMs?: number;
}

export interface CategoryScore {
  category: FindingCategory;
  score: number;
  maxScore: number;
  percentage: number;
  grade: ScoreGrade;
  findingCounts: { critical: number; high: number; medium: number; low: number; info: number };
  topFindings: string[];
}

export interface OrgScorecard {
  orgId: string;
  scanRunId: string;
  overallScore: number;
  overallGrade: ScoreGrade;
  categoryScores: CategoryScore[];
  totalFindings: number;
  criticalFindings: number;
  highFindings: number;
  computedAt: string;
}

export interface Finding {
  id: string;
  orgId: string;
  scanRunId: string;
  category: FindingCategory;
  ruleId: string;
  ruleName: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  impact: string;
  recommendation: string;
  affectedCount: number;
  totalCount: number;
  percentage: number;
  affectedResources: Array<{ type: string; id: string; name: string }>;
  evidence: Array<{ type: string; description: string; value?: string | number; source?: string }>;
  tags?: string[];
  createdAt: string;
}

export interface AIAssessment {
  executiveSummary: string;
  keyStrengths: string[];
  topRisks: string[];
  prioritizedRecommendations: Array<{
    priority: number;
    title: string;
    description: string;
    effort: 'low' | 'medium' | 'high';
    impact: 'low' | 'medium' | 'high';
    category: FindingCategory;
    evidenceRefs: string[];
  }>;
  taggingStrategyProposal: {
    requiredTags: TagDefinition[];
    recommendedTags: TagDefinition[];
    tagMappings: Array<{ from: string; to: string; rationale: string }>;
  };
  serviceOwnershipModel: string;
  remediationPlan: Array<{
    phase: number;
    title: string;
    timeframe: string;
    actions: string[];
    expectedOutcome: string;
  }>;
  healthCheckTakeaways: string[];
  generatedAt: string;
  evidenceCount: number;
}

export interface TagDefinition {
  key: string;
  description: string;
  examples: string[];
  required: boolean;
}

export interface InventorySummary {
  hosts: number;
  services: number;
  monitors: number;
  dashboards: number;
  syntheticsTests: number;
  logsIndexes: number;
  logsPipelines: number;
  integrations: number;
  cloudAccounts: number;
  slos: number;
  tagKeys: number;
  envTagCoverage: number;
}

export interface TagAnalysisRow {
  tag_key: string;
  unique_value_count: number;
  host_occurrence_count: number;
  service_occurrence_count: number;
  top_values: string;
  is_standard_key: number;
  suggested_mapping: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const GRADE_LABELS: Record<ScoreGrade, string> = {
  excellent: 'Excellent',
  good: 'Good',
  needs_attention: 'Needs Attention',
  critical: 'Critical',
};

export const GRADE_COLORS: Record<ScoreGrade, string> = {
  excellent: '#10b981',
  good: '#3b82f6',
  needs_attention: '#f59e0b',
  critical: '#ef4444',
};

export const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#3b82f6',
  info: '#6b7280',
};

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  unified_tagging: 'Unified Tagging',
  service_architecture: 'Service Architecture',
  integration_hygiene: 'Integration Hygiene',
  logs_health: 'Logs Health',
  monitors_health: 'Monitors Health',
  dashboards_health: 'Dashboards Health',
  synthetics_health: 'Synthetics Health',
  network_cloud: 'Network & Cloud',
  governance: 'Governance',
};

// ─── Tagging Intelligence types ───────────────────────────────────────────────

export interface NormalizationResult {
  synonymGroups: Array<{
    canonicalKey: string;
    detectedVariants: string[];
    confidence: number;
    occurrenceCount: number;
    recommendation: string;
    description: string;
    isAligned: boolean;
  }>;
  conflicts: Array<{
    tagKey: string;
    conflictType: 'casing' | 'value_drift' | 'synonym_duplicate';
    valuesFound: string[];
    resourceTypes: string[];
    affectedCount: number;
    recommendation: string;
  }>;
  tagDictionary: Array<{
    canonicalKey: string;
    definition: string;
    currentCoverage: number;
    foundKey: string | null;
    status: 'found' | 'missing' | 'drifted';
    isUst: boolean;
  }>;
  normalizationScore: number;
  totalTagKeys: number;
}

export interface CloudAlignmentRow {
  cloudProvider: string;
  cloudTagKey: string;
  cloudTagValues: string[];
  ddTagKey: string | null;
  ddTagValues: string[];
  alignmentStatus: 'aligned' | 'missing_in_dd' | 'key_drift' | 'value_drift' | 'dd_only';
  mappingSuggestion: string | null;
  hostCount: number;
}

export interface CloudAlignmentResult {
  rows: CloudAlignmentRow[];
  cloudOnlyCount: number;
  alignedCount: number;
  keyDriftCount: number;
  valueDriftCount: number;
  alignmentScore: number;
  detectedProviders: string[];
  propagationGaps: Array<{
    cloudKey: string;
    ddKey: string;
    presentOnCloudResources: number;
    missingInDd: number;
    fixRecommendation: string;
  }>;
}

export interface PropagationResult {
  services: Array<{
    serviceName: string;
    tags: Record<string, {
      infra: { present: boolean; coverage: number | null };
      apm: { present: boolean; coverage: number | null };
      monitors: { present: boolean; coverage: number | null };
      synthetics: { present: boolean; coverage: number | null };
      propagationScore: number;
      gapLayers: string[];
      isUst: boolean;
    }>;
    overallScore: number;
  }>;
  summary: {
    fullPropagation: number;
    partialPropagation: number;
    brokenPropagation: number;
    avgPropagationScore: number;
  };
  fixRecommendations: Array<{
    layer: string;
    tag: string;
    affectedServices: string[];
    fix: string;
  }>;
}

export interface TemplateSummary {
  id: string;
  name: string;
  category: 'industry' | 'org';
  description: string;
  icon: string;
  requiredCount: number;
  recommendedCount: number;
  optionalCount: number;
  hasComplianceTags: boolean;
}

export interface TemplateTag {
  key: string;
  description: string;
  why: string;
  how: string;
  when: string;
  where: string;
  exampleValues?: string[];
  found: boolean;
  coverage: number;
  foundKey?: string | null;
}

export interface TemplateScore {
  industry: string;
  templateName: string;
  category: 'industry' | 'org';
  overallScore: number;
  complianceScore: number;
  baselineScore: number;
  globalBaseline: TemplateTag[];
  required: TemplateTag[];
  recommended: Array<{ key: string; description: string; found: boolean; coverage: number }>;
  optional: Array<{ key: string; description: string; found: boolean }>;
  complianceTags: Array<{ key: string; standard: string; note: string; found: boolean }>;
  missingBaseline: string[];
  missingRequired: string[];
  missingRecommended: string[];
  quickWins: string[];
}

export interface GovernanceResult {
  orgSummaries: Array<{ orgId: string; orgName: string; tagKeys: string[]; tagValues: Record<string, string[]> }>;
  inconsistencies: Array<{
    tagKey: string;
    type: string;
    orgsAffected: string[];
    orgsWithKey: string[];
    orgsMissing: string[];
    valuesByOrg: Record<string, string[]>;
    recommendation: string;
  }>;
  valueDrift: Array<{
    tagKey: string;
    type: string;
    orgsAffected: string[];
    orgsWithKey: string[];
    orgsMissing: string[];
    valuesByOrg: Record<string, string[]>;
    recommendation: string;
  }>;
  consistencyScore: number;
  globalTagKeys: string[];
  commonTagKeys: string[];
  orphanTagKeys: Record<string, string[]>;
}

export interface CostReadinessResult {
  overallScore: number;
  attributionScore: number;
  alignmentScore: number;
  checks: Array<{
    id: string;
    label: string;
    description: string;
    why: string;
    how: string;
    status: 'pass' | 'partial' | 'fail';
    coverage?: number;
    recommendation: string;
  }>;
  finopsRecommendations: Array<{
    priority: 'critical' | 'high' | 'moderate';
    action: string;
    impact: string;
    effort: 'low' | 'medium' | 'high';
  }>;
}

export interface CloudInventory {
  accounts: Array<{
    provider: string; accountId: string | null; accountName: string | null;
    status: string; metricsEnabled: boolean; resourceCollectionEnabled: boolean; hasErrors: boolean;
  }>;
  detectedProviders: string[];
  totalHosts: number;
  hostsWithCloudTags: number;
  keysBySource: Record<string, string[]>;
  tagsBySource: Record<string, Array<{ key: string; value: string; hostCount: number }>>;
  mappingGaps: Array<{ ddKey: string; cloudVariants: string[]; found: boolean }>;
  usingFallback: boolean;
}

export interface TagDetail {
  tagKey: string;
  totalValues: number;
  resourceBreakdown: Array<{ resourceType: string; tagged: number; total: number; pct: number }>;
  values: Array<{ value: string; count: number; resourceTypes: string[] }>;
  collisions: Array<{ canonical: string; variants: string[]; kind: 'synonym' | 'casing' }>;
}

export interface AnalyticsData {
  scannedAt: string | null;
  infrastructure: {
    totalHosts: number; hostTier: string;
    tagCoverage: { env: number; service: number; version: number; team: number };
    cloudAccounts: Array<{ provider: string; n: number }>;
    containers: number | null;
  };
  customMetrics: {
    estimated: number; allotmentAt100PerHost: number; allotmentAt200PerHost: number;
    utilizationPct: number; risk: 'low' | 'medium' | 'high';
    topDrivers: Array<{ key: string; uniqueValues: number; estimatedMetrics: number }>;
  };
  logs: {
    totalIndexes: number; pipelines: number; enabledPipelines: number;
    totalDailyLimitEvents: number; totalExclusionFilters: number;
    rateLimitedCount: number; flexIndexCount: number;
    retentionDistribution: Record<string, number>;
    indexDetails: Array<{
      name: string; retentionDays: number | null; dailyLimitEvents: number | null;
      exclusionFilters: number; isRateLimited: boolean; filterQuery: string | null; isFlex: boolean;
    }>;
  };
  integrations: {
    total: number; configured: number; enabled: number;
    byType: Array<{ type: string; count: number }>;
    list: Array<{ name: string; type: string | null; status: string | null; isConfigured: boolean; isEnabled: boolean }>;
  };
  synthetics: {
    apiTests: number; browserTests: number; estimatedMonthlyRuns: number;
    details: Array<{ name: string; type: string; status: string; locations: number; estimatedMonthlyRuns: number }>;
  };
  apm: { totalServices: number; svcInCatalog: number; svcWithMonitor: number; svcWithSLO: number; slos: number };
  observability: { monitors: number; dashboards: number };
  monitorBreakdown: {
    total: number;
    byState: Record<string, number>;
    byType: Record<string, number>;
    mutedCount: number;
    withoutNotification: number;
    withoutEnvTag: number;
    withoutServiceTag: number;
    withoutTeamTag: number;
  };
  sloBreakdown: {
    total: number;
    byType: Record<string, number>;
    withEnvTag: number;
    withServiceTag: number;
  };
  governance: {
    userCount: number | null;
    roleCount: number | null;
    findings: Array<{
      ruleName: string; severity: string; title: string; description: string;
      affectedCount: number; totalCount: number; recommendation: string | null;
    }>;
  };
  scorecard: {
    overallScore: number;
    overallGrade: string;
    categories: Array<{
      category: string; score: number; maxScore: number; percentage: number; grade: string;
      findingCounts: { critical: number; high: number; medium: number; low: number; info: number };
      topFindings: string[];
    }>;
    topFindings: Array<{
      ruleName: string; severity: string; title: string; description: string;
      affectedCount: number; recommendation: string | null; category: string;
    }>;
  } | null;
  rum: {
    total: number;
    byType: Record<string, number>;
    apps: Array<{ id: string; name: string | null; type: string | null; framework: string | null; createdAt: string | null }>;
  };
  fleet: {
    agentVersions: Record<string, number>;
    platforms: Record<string, number>;
    installedChecks: Array<{ name: string; count: number }>;
  };
}

export interface UsageProductSummary {
  name: string;
  metricKey: string;
  value: number | null;
  unit: string;
  committedCost: number;
  onDemandCost: number;
  hasOnDemand: boolean;
}

export interface UsageData {
  reportMonth: string;
  collectedAt: string;
  latestUsage: Record<string, unknown>;
  usageHistory: Array<Record<string, unknown>>;
  costCharges: Array<{ charge_type: string; product_name: string; cost: number }>;
  products: UsageProductSummary[];
}

export interface AIProviderSettings {
  provider: string;
  model: string | null;
  baseUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
  updatedAt: string | null;
  envProvider?: string;
}

export const DATADOG_SITES: Array<{ value: DatadogSite; label: string }> = [
  { value: 'datadoghq.com', label: 'US1 — datadoghq.com' },
  { value: 'us3.datadoghq.com', label: 'US3 — us3.datadoghq.com' },
  { value: 'us5.datadoghq.com', label: 'US5 — us5.datadoghq.com' },
  { value: 'datadoghq.eu', label: 'EU1 — datadoghq.eu' },
  { value: 'ap1.datadoghq.com', label: 'AP1 — ap1.datadoghq.com' },
  { value: 'ap2.datadoghq.com', label: 'AP2 — ap2.datadoghq.com' },
  { value: 'ddog-gov.com', label: 'US1-FED — ddog-gov.com' },
];
