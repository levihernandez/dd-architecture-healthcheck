// Assessment engine types

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingCategory =
  | 'unified_tagging'
  | 'service_architecture'
  | 'integration_hygiene'
  | 'logs_health'
  | 'monitors_health'
  | 'dashboards_health'
  | 'synthetics_health'
  | 'network_cloud'
  | 'governance';

export type ScoreGrade = 'excellent' | 'good' | 'needs_attention' | 'critical';

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
  affectedResources: AffectedResource[];
  evidence: Evidence[];
  tags?: string[];
  createdAt: string;
}

export interface AffectedResource {
  type: string;
  id: string;
  name: string;
  details?: Record<string, unknown>;
}

export interface Evidence {
  type: 'tag_missing' | 'config_gap' | 'metric' | 'api_response' | 'count';
  description: string;
  value?: string | number;
  source?: string;
}

export interface AssessmentRule {
  id: string;
  name: string;
  category: FindingCategory;
  severity: FindingSeverity;
  description: string;
  run(context: AssessmentContext): Promise<RuleResult>;
}

export interface RuleResult {
  ruleId: string;
  passed: boolean;
  score: number;
  maxScore: number;
  findings: Omit<Finding, 'id' | 'orgId' | 'scanRunId' | 'createdAt'>[];
}

export interface AssessmentContext {
  orgId: string;
  scanRunId: string;
  db: import('better-sqlite3').Database;
}

export interface CategoryScore {
  category: FindingCategory;
  score: number;
  maxScore: number;
  percentage: number;
  grade: ScoreGrade;
  findingCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
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

export interface AIAssessmentRequest {
  orgId: string;
  scanRunId: string;
  scorecard: OrgScorecard;
  findingSummary: FindingSummary;
  inventorySummary: InventorySummary;
  tagAnalysis: TagAnalysis;
}

export interface FindingSummary {
  byCategory: Record<FindingCategory, { count: number; topFindings: string[] }>;
  bySeverity: Record<FindingSeverity, number>;
  totalFindings: number;
}

export interface InventorySummary {
  hostCount: number;
  serviceCount: number;
  monitorCount: number;
  dashboardCount: number;
  syntheticsCount: number;
  integrationCount: number;
  sloCount: number;
  teamCount: number;
  logsIndexCount: number;
  logsPipelineCount: number;
}

export interface TagAnalysis {
  totalTagKeys: number;
  uniqueTagKeys: string[];
  envCoverage: number;
  serviceCoverage: number;
  versionCoverage: number;
  teamCoverage: number;
  topTagKeys: Array<{ key: string; count: number; coverage: number }>;
  missingStandardTags: string[];
  tagMappingSuggestions: Array<{
    existingKey: string;
    suggestedKey: string;
    reason: string;
    sampleValues: string[];
  }>;
}

export interface AIAssessmentResponse {
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
  remediationPlan: RemediationPhase[];
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

export interface RemediationPhase {
  phase: number;
  title: string;
  timeframe: string;
  actions: string[];
  expectedOutcome: string;
}
