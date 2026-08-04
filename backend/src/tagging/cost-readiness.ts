import { getDatabase } from '../db/database';

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

export function analyzeCostReadiness(orgId: string, scanRunId: string): CostReadinessResult {
  const db = getDatabase();

  const totalHosts = (db.prepare(
    'SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ?'
  ).get(orgId, scanRunId) as { c: number })?.c ?? 0;

  function tagCoverage(tagKey: string): number {
    if (totalHosts === 0) return 0;
    const count = (db.prepare(
      `SELECT COUNT(DISTINCT resource_id) as c FROM resource_tags
       WHERE org_id = ? AND scan_run_id = ? AND resource_type = 'host' AND tag_key = ?`
    ).get(orgId, scanRunId, tagKey) as { c: number })?.c ?? 0;
    return Math.round((count / totalHosts) * 100);
  }

  function tagExists(tagKey: string): boolean {
    return (db.prepare(
      'SELECT COUNT(*) as c FROM tag_analysis WHERE org_id = ? AND scan_run_id = ? AND tag_key = ?'
    ).get(orgId, scanRunId, tagKey) as { c: number })?.c > 0;
  }

  const teamCov = tagCoverage('team');
  const costCenterCov = tagCoverage('cost_center');
  const envCov = tagCoverage('env');
  const serviceCov = tagCoverage('service');
  const appCov = tagCoverage('application');
  const buCov = tagCoverage('business_unit');
  const productCov = tagCoverage('product');
  const hasCostCenter = tagExists('cost_center');
  const hasTeam = tagExists('team');
  const hasApplication = tagExists('application');
  const hasProduct = tagExists('product');
  const hasBusinessUnit = tagExists('business_unit');

  const checks: CostReadinessResult['checks'] = [
    {
      id: 'cost_center',
      label: 'cost_center tag present',
      description: 'Cost center codes applied to infrastructure resources for chargeback.',
      why: 'Without cost_center, you cannot generate chargeback reports or allocate cloud spend to P&L owners. This is the single most important tag for FinOps.',
      how: 'Add cost_center:<code> to all host extra_tags in datadog.yaml. For cloud resources, set it as a cloud provider tag and sync via the Datadog integration. Create a tag enforcement policy in your IaC templates.',
      status: hasCostCenter ? (costCenterCov >= 70 ? 'pass' : 'partial') : 'fail',
      coverage: costCenterCov,
      recommendation: hasCostCenter
        ? costCenterCov >= 70
          ? 'Good coverage. Extend to remaining hosts.'
          : `Only ${costCenterCov}% of hosts have cost_center. Add to IaC templates to reach 100%.`
        : 'cost_center tag is absent. Add it immediately — this is required for any chargeback model.',
    },
    {
      id: 'team',
      label: 'team tag for ownership',
      description: 'Team ownership tags enable cost attribution to engineering teams.',
      why: 'Team-level cost attribution enables each team to see their cloud spend, driving accountability and encouraging cost efficiency. Required for showback/chargeback models.',
      how: 'Add team:<name> to all resources. The value must match your Datadog Teams handle. Enforce via Terraform/CDK resource tags policy or Kubernetes namespace labels.',
      status: hasTeam ? (teamCov >= 70 ? 'pass' : 'partial') : 'fail',
      coverage: teamCov,
      recommendation: hasTeam
        ? teamCov >= 70
          ? 'Good team coverage.'
          : `Only ${teamCov}% of hosts tagged with team. Enforce in IaC templates.`
        : 'team tag missing. Required for team-level cost attribution.',
    },
    {
      id: 'env_isolation',
      label: 'env tag for environment cost split',
      description: 'Environment tags allow separating production vs non-production cloud costs.',
      why: 'Separating production from non-production spend reveals optimization opportunities in dev/staging environments (right-sizing, scheduling idle resources). Typically 30-40% of cloud costs can be reduced in non-prod.',
      how: 'Ensure env:<value> is on all hosts and cloud resources. Use consistent values (prod, staging, dev) across cloud provider tags and Datadog. Sync via cloud integration.',
      status: envCov >= 80 ? 'pass' : envCov >= 40 ? 'partial' : 'fail',
      coverage: envCov,
      recommendation: envCov >= 80
        ? 'Strong env coverage.'
        : `env tag at ${envCov}% — insufficient for environment-level cost analysis. Target 100%.`,
    },
    {
      id: 'service_attribution',
      label: 'service tag for unit cost modeling',
      description: 'Service tags enable per-service cost attribution for unit economics.',
      why: 'Per-service cost data enables unit cost modeling (cost per API request, cost per user). This is the foundation for identifying expensive services and optimizing resource allocation.',
      how: 'Apply service:<name> to all hosts running a specific service. For shared hosts, use the dominant service. For Kubernetes, use pod annotations. The service name must match the APM service identifier.',
      status: serviceCov >= 80 ? 'pass' : serviceCov >= 40 ? 'partial' : 'fail',
      coverage: serviceCov,
      recommendation: serviceCov >= 80
        ? 'Good service coverage.'
        : `service tag at ${serviceCov}% — needed for per-service unit cost modeling.`,
    },
    {
      id: 'application_grouping',
      label: 'application tag for workload cost grouping',
      description: 'Application tags group microservices costs into business application rollups.',
      why: 'Individual service costs are hard to interpret. The application tag rolls up all services into a recognizable business application (e.g., "payments platform") for executive cost reporting.',
      how: 'Define your application taxonomy and add application:<name> to all resources for each app. Use the same taxonomy as your service catalog. Propagate via Kubernetes namespace labels for all pods in an application.',
      status: hasApplication ? (appCov >= 60 ? 'pass' : 'partial') : 'fail',
      coverage: appCov,
      recommendation: hasApplication
        ? `application tag at ${appCov}% — extend to all resources for complete workload cost grouping.`
        : 'application tag absent. Add it to enable business-level cost rollups.',
    },
    {
      id: 'business_unit',
      label: 'business_unit or product for P&L alignment',
      description: 'business_unit or product tags enable P&L-aligned cloud cost reporting.',
      why: 'P&L owners and CFOs need to see cloud costs aligned to their business units. Without this tag, finance teams must manually allocate costs — error-prone and time-consuming.',
      how: 'Add business_unit:<name> or product:<name> to all resources. Define the BU taxonomy from your finance system and propagate it via IaC templates and cloud account tagging policies.',
      status: (hasBusinessUnit || hasProduct) ? 'pass' : 'fail',
      coverage: Math.max(buCov, productCov),
      recommendation: (hasBusinessUnit || hasProduct)
        ? 'P&L alignment tags present.'
        : 'Add business_unit or product tags for P&L-aligned cost reporting.',
    },
    {
      id: 'cloud_sync',
      label: 'Cloud provider tags synced to Datadog',
      description: 'Cloud provider tags (AWS/Azure/GCP) should be visible in Datadog for unified cost correlation.',
      why: 'Your cloud billing data uses cloud tags. If those tags do not appear in Datadog, you cannot correlate cloud cost reports with observability metrics on the same resources.',
      how: 'Enable tag collection in the Datadog AWS/Azure/GCP integration settings. Ensure the integration IAM policy includes ec2:DescribeTags (AWS) or equivalent. Check the Datadog integration page for "Tag collection" status.',
      status: totalHosts > 0 ? 'partial' : 'fail', // Can't verify without cloud tags data
      recommendation: 'Enable tag collection in Datadog cloud integrations and verify AWS/Azure/GCP tags appear on hosts.',
    },
  ];

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const partialCount = checks.filter((c) => c.status === 'partial').length;
  const overallScore = Math.round(
    (passCount / checks.length) * 70 +
    (partialCount / checks.length) * 30
  );

  const attributionScore = Math.round(
    (hasCostCenter ? (costCenterCov >= 70 ? 100 : 50) : 0) * 0.4 +
    (hasTeam ? (teamCov >= 70 ? 100 : 50) : 0) * 0.3 +
    (hasApplication ? (appCov >= 60 ? 100 : 50) : 0) * 0.3
  );

  const alignmentScore = Math.round((envCov + serviceCov) / 2);

  const finopsRecommendations: CostReadinessResult['finopsRecommendations'] = [];

  if (!hasCostCenter) {
    finopsRecommendations.push({
      priority: 'critical',
      action: 'Add cost_center tag to all resources',
      impact: 'Enables chargeback/showback — the most critical FinOps capability',
      effort: 'medium',
    });
  }
  if (!hasTeam) {
    finopsRecommendations.push({
      priority: 'critical',
      action: 'Add team tag to all resources',
      impact: 'Enables team-level cost accountability and budget alerts',
      effort: 'low',
    });
  }
  if (!hasApplication) {
    finopsRecommendations.push({
      priority: 'high',
      action: 'Add application tag for workload grouping',
      impact: 'Enables business application cost rollups for executive dashboards',
      effort: 'medium',
    });
  }
  if (envCov < 80) {
    finopsRecommendations.push({
      priority: 'high',
      action: `Increase env tag coverage from ${envCov}% to 100%`,
      impact: 'Enables prod vs non-prod cost split — typical 30-40% reduction in non-prod spend',
      effort: 'low',
    });
  }
  if (!hasBusinessUnit && !hasProduct) {
    finopsRecommendations.push({
      priority: 'moderate',
      action: 'Add business_unit or product tag',
      impact: 'Enables P&L-aligned cost reporting for finance teams',
      effort: 'medium',
    });
  }

  return { overallScore, attributionScore, alignmentScore, checks, finopsRecommendations };
}
