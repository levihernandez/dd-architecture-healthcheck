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
  | 'synthetics_health' | 'network_cloud' | 'governance'
  | 'security_posture' | 'cost_optimization';

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
  endpoint?: string;
  requestCount?: number;
  pageCount?: number;
  truncated?: boolean;
  rateLimitRemaining?: number;
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
  tagKey?: string;
  bestPractice?: BestPracticeRecommendation;
}

export interface BestPracticeRecommendation {
  tagKey: string;
  found: boolean;
  what: string;
  how: string;
  when: string;
  where: string;
  why: string;
  priority: 'critical' | 'high' | 'moderate' | 'low' | null;
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
  securityFindings: number;
  openIncidents: number;
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

// Validated status palette (dataviz skill) — reserved for state, never reused as a series color.
export const GRADE_COLORS: Record<ScoreGrade, string> = {
  excellent: '#0ca30c', // good
  good: '#2a78d6', // categorical blue — distinct from the other three status tiers
  needs_attention: '#fab219', // warning
  critical: '#d03b3b', // critical
};

export const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  critical: '#d03b3b', // critical
  high: '#ec835a', // serious
  medium: '#fab219', // warning
  low: '#2a78d6', // categorical blue — informational, not a status color
  info: '#898781', // muted ink
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
  security_posture: 'Security Posture',
  cost_optimization: 'Cost Optimization',
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
    affectedResources: Array<{ type: string; id: string; name: string }>;
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
  affectedHosts: Array<{ id: string; name: string }>;
  affectedHostCount: number;
  bestPractice: BestPracticeRecommendation;
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
  sector?: string;
  description: string;
  icon: string;
  requiredCount: number;
  recommendedCount: number;
  optionalCount: number;
  hasComplianceTags: boolean;
}

// Static tag definition — the raw template shape from GET /tagging/templates/:id,
// with no found/coverage since it's not scored against any org's scan data.
export interface ResourceExample {
  resource: 'rum' | 'logs' | 'apm' | 'agent' | 'integrations';
  example: string;
  description?: string;
}

export interface TemplateTagDef {
  key: string;
  description: string;
  why: string;
  how: string;
  when: string;
  where: string;
  exampleValues?: string[];
  platformGuides?: Array<{ platform: string; method: string }>;
  resourceExamples?: ResourceExample[];
}

export interface IndustryTemplateDetail {
  id: string;
  name: string;
  category: 'industry' | 'org';
  sector?: string;
  description: string;
  icon: string;
  detectSignals?: string[];
  globalBaseline: TemplateTagDef[];
  required: TemplateTagDef[];
  recommended: TemplateTagDef[];
  optional: TemplateTagDef[];
  complianceTags?: Array<{ key: string; standard: string; note: string }>;
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
  platformGuides?: Array<{ platform: string; method: string }>;
  resourceExamples?: ResourceExample[];
}

export interface CloudAutoTagScore {
  key: string;
  provider: 'aws' | 'gcp' | 'azure' | 'kubernetes' | 'agent';
  description: string;
  pairsWith: string;
  reuseNote: string;
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
  cloudAutoScore: number;
  globalBaseline: TemplateTag[];
  required: TemplateTag[];
  recommended: Array<{ key: string; description: string; found: boolean; coverage: number }>;
  optional: Array<{ key: string; description: string; found: boolean }>;
  complianceTags: Array<{ key: string; standard: string; note: string; found: boolean }>;
  cloudAuto: CloudAutoTagScore[];
  missingBaseline: string[];
  missingRequired: string[];
  missingRecommended: string[];
  quickWins: string[];
}

export interface TagPolicyLayer {
  layer: string;
  where: string;
  mechanism: string;
  catchesAt: 'design' | 'build' | 'deploy' | 'runtime';
  outcome: string;
  orgSettingsPath?: string;
}

export interface TagEnforcementRow {
  resource: string;
  tagsSupported: string;
  mandatoryEnforcement: boolean;
  notes?: string;
  orgSettingsPath?: string;
  docsUrl?: string;
}

export interface TagPolicyResource {
  title: string;
  url: string;
  type: 'product' | 'docs' | 'api';
  description: string;
}

export interface OrgTagTemplateSelection {
  templateId: string;
  updatedAt: string;
}

export interface MaturityAssessmentResult {
  industry: string;
  templateId: string;
  suggestedTagKeys: string[];
  hasScanData: boolean;
  promptText: string;
}

export interface RemediationExecutionResult {
  industry: string;
  templateId: string;
  suggestedTagKeys: string[];
  hasScanData: boolean;
  promptText: string;
}

// ─── Host instrumentation blind-spot analysis ─────────────────────────────────

export interface HostGapRow {
  hostName: string;
  cloudProvider: string;
  instanceType: string | null;
  region: string | null;
  availabilityZone: string | null;
  platform: string | null;
  agentVersion: string | null;
  envTag: string | null;
  serviceTag: string | null;
  hasEnvTag: boolean;
  hasServiceTag: boolean;
  hasVersionTag: boolean;
  hasTeamTag: boolean;
  hasApm: boolean;
  matchedService: string | null;
  installedChecks: string[];
  isBlindSpot: boolean;
}

export interface ProductGap {
  product: string;
  icon: string;
  hostsCoveredEstimate: number;
  totalHosts: number;
  coveragePct: number;
  gapCount: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  why: string;
  what: string;
  how: string;
  howMuch: string;
  improvement: string;
}

export interface ServiceMaturityRow {
  serviceName: string;
  env: string | null;
  team: string | null;
  score: number;
  grade: ScoreGrade;
  hasServiceCatalog: boolean;
  hasMonitor: boolean;
  hasSLO: boolean;
  hasVersionTag: boolean;
  hasOwner: boolean;
  missing: string[];
}

export interface AppBreakdownRow {
  type: string;
  label: string;
  icon: string;
  count: number;
  tagCoveragePct: number | null;
  tagCoverageNote: string;
}

export interface HostGapAnalysis {
  totalHosts: number;
  blindSpotCount: number;
  hosts: HostGapRow[];
  productGaps: ProductGap[];
  serviceMaturity: {
    services: ServiceMaturityRow[];
    avgScore: number;
    distribution: Record<ScoreGrade, number>;
  };
  appBreakdown: AppBreakdownRow[];
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
  costManagement: Array<{ provider: string; configured: boolean; accountCount: number }>;
}

export interface TagDetail {
  tagKey: string;
  totalValues: number;
  resourceBreakdown: Array<{ resourceType: string; tagged: number; total: number; pct: number }>;
  values: Array<{ value: string; count: number; resourceTypes: string[] }>;
  collisions: Array<{ canonical: string; variants: string[]; kind: 'synonym' | 'casing' }>;
}

export interface CostFigure {
  amount: number;
  source: 'real' | 'estimated';
  note?: string;
}

export interface AnalyticsData {
  scannedAt: string | null;
  infrastructure: {
    totalHosts: number; hostTier: string;
    tagCoverage: { env: number; service: number; version: number; team: number };
    cloudAccounts: Array<{ provider: string; n: number }>;
    containers: number | null;
    cost: CostFigure | null;
    recommendations: string[];
  };
  customMetrics: {
    estimated: number; allotmentAt100PerHost: number; allotmentAt200PerHost: number;
    utilizationPct: number; risk: 'low' | 'medium' | 'high';
    topDrivers: Array<{ key: string; uniqueValues: number; estimatedMetrics: number }>;
    cost: CostFigure | null;
    recommendations: string[];
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
    cost: CostFigure | null;
    recommendations: string[];
  };
  integrations: {
    total: number; configured: number; enabled: number;
    installed: number; broken: number; idle: number; notInstalled: number; receivingData: number;
    byType: Array<{ type: string; count: number }>;
    list: Array<{
      name: string; type: string | null; status: string | null; isConfigured: boolean; isEnabled: boolean;
      hostCount: number | null; receivingData: boolean;
    }>;
    recommendations: string[];
  };
  synthetics: {
    apiTests: number; browserTests: number; estimatedMonthlyRuns: number;
    details: Array<{ name: string; type: string; status: string; locations: number; estimatedMonthlyRuns: number }>;
    cost: CostFigure | null;
    recommendations: string[];
  };
  apm: {
    totalServices: number; svcInCatalog: number; svcWithMonitor: number; svcWithSLO: number; slos: number;
    cost: CostFigure | null;
    recommendations: string[];
  };
  observability: {
    monitors: number;
    dashboards: number;
    dashboardBreakdown: { ootb: number; byAuthor: Array<{ author: string; count: number }> };
  };
  monitorBreakdown: {
    total: number;
    byState: Record<string, number>;
    byType: Record<string, number>;
    mutedCount: number;
    withoutNotification: number;
    withoutEnvTag: number;
    withoutServiceTag: number;
    withoutTeamTag: number;
    recommendations: string[];
  };
  sloBreakdown: {
    total: number;
    byType: Record<string, number>;
    withEnvTag: number;
    withServiceTag: number;
    recommendations: string[];
  };
  governance: {
    userCount: number | null;
    roleCount: number | null;
    findings: Array<{
      ruleName: string; severity: string; title: string; description: string;
      affectedCount: number; totalCount: number; recommendation: string | null;
    }>;
    recommendations: string[];
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
    cost: CostFigure | null;
    recommendations: string[];
  };
  fleet: {
    agentVersions: Record<string, number>;
    platforms: Record<string, number>;
    installedChecks: Array<{ name: string; count: number }>;
    recommendations: string[];
  };
  security: {
    total: number;
    unresolvedCritical: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
    cost: CostFigure | null;
    recommendations: string[];
  };
  incidents: {
    total: number;
    open: number;
    bySeverity: Record<string, number>;
  };
  costManagement: {
    providers: Array<{ provider: string; configured: boolean }>;
  };
  productProxies: {
    npm: number;
    ndm: number;
    dbm: number;
    cost: CostFigure | null;
    recommendations: string[];
  };
}

export interface PricingSnapshot {
  id: string;
  capturedAt: string;
  sourceUrl: string;
  product: string;
  tier?: string;
  unit: string;
  price: number;
  rawText?: string;
}

export interface SizingSnapshotSkuLine {
  sku: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
}

export interface SizingSnapshotCartItem {
  id: string;
  label: string;
  icon: string;
  primaryMetric: string;
  listPriceCost: number;
  realCost?: number;
  skuLines?: SizingSnapshotSkuLine[];
}

export interface SizingSnapshotSummary {
  id: string;
  name: string;
  createdAt: string;
  mode: string;
  orgId?: string;
  orgName?: string;
  totalListPrice: number;
  totalRealCost?: number;
  categoryCount: number;
  cart: SizingSnapshotCartItem[];
}

export interface SizingSnapshotRecord extends SizingSnapshotSummary {
  state: Record<string, unknown>;
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

export interface EventStatBucket {
  key: string;
  count: number;
}

export interface EventStatsData {
  scanRunId: string;
  computedAt: string | null;
  totalEvents: number;
  bySource: EventStatBucket[];
  byService: EventStatBucket[];
  byStatus: EventStatBucket[];
}

export type FeatureNodeType = 'scan' | 'collector' | 'rule' | 'page' | 'section';

// Mirrors backend/src/feature-flags/types.ts FeatureFlagState — a tree node
// with both its own stored preference and the read-time-computed effective
// state (storedEnabled AND every ancestor's effectiveEnabled).
export interface FeatureFlagState {
  key: string;
  parentKey: string | null;
  nodeType: FeatureNodeType;
  label: string;
  collectorName?: string;
  ruleCategory?: string;
  pagePath?: string;
  storedEnabled: boolean;
  effectiveEnabled: boolean;
  children: FeatureFlagState[];
}

export type FindingDiffStatus = 'new' | 'resolved' | 'worsened' | 'improved' | 'unchanged';

export interface FindingSnapshot {
  severity: FindingSeverity;
  title: string;
  affectedCount: number;
  totalCount: number;
  percentage: number;
}

export interface FindingDiff {
  ruleId: string;
  ruleName: string;
  category: FindingCategory;
  status: FindingDiffStatus;
  previous: FindingSnapshot | null;
  current: FindingSnapshot | null;
}

export interface CategoryComparison {
  category: FindingCategory;
  previousScore: number | null;
  currentScore: number | null;
  scoreDelta: number | null;
  concerns: FindingDiff[];
  improvements: FindingDiff[];
  unchangedCount: number;
}

export interface ScanComparisonResult {
  orgId: string;
  previousScanId: string;
  currentScanId: string;
  previousCompletedAt: string | null;
  currentCompletedAt: string | null;
  overallPreviousScore: number | null;
  overallCurrentScore: number | null;
  overallScoreDelta: number | null;
  categories: CategoryComparison[];
  topConcerns: FindingDiff[];
  topImprovements: FindingDiff[];
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

export interface AIPromptDescriptor {
  key: string;
  label: string;
  filePath: string;
  content: string;
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
