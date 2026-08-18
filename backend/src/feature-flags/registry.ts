import type { FeatureNode } from './types';

// Static feature-flag tree: Scan -> Collector -> Rule/Page.
//
// Collector names are taken verbatim from ALL_COLLECTORS in
// backend/src/datadog/scan-orchestrator.ts (17 total).
//
// Rule category keys are taken verbatim from the FindingCategory union in
// backend/src/types/assessment.types.ts (11 total), and each is parented under
// the single collector its rules file depends on most (read from the actual
// SQL in backend/src/assessment/rules/*.ts):
//   - unified_tagging spans hosts/services/monitors/synthetics_tests (multiple
//     collectors) so it is parented directly under 'scan' instead of one collector.
//   - network_cloud has a weight in scorer.ts's CATEGORY_WEIGHTS but currently
//     has no rules file under backend/src/assessment/rules/ — it's included here
//     for forward-compatibility (and because the /network page maps to it) but
//     isRuleCategoryEnabled() will simply never find anything to skip for it today.
//
// Page nodes cover the ~18 pages that map onto a collector or rule category.
// Utility/always-on pages (Overview, Orgs, Scans, AI Settings/Assessment/Chat/
// Recommendations, Export, OrgContext, Analytics, Inventory Explorer, Calculators,
// Industry Templates, and the Feature Flags admin page itself) intentionally have
// no node — they are never gated.
export const FEATURE_TREE: FeatureNode[] = [
  { key: 'scan', parentKey: null, nodeType: 'scan', label: 'Full Scan' },

  // Collectors (parent: scan)
  { key: 'collector.infrastructure', parentKey: 'scan', nodeType: 'collector', label: 'Infrastructure', collectorName: 'infrastructure' },
  { key: 'collector.apm', parentKey: 'scan', nodeType: 'collector', label: 'APM', collectorName: 'apm' },
  { key: 'collector.service_catalog', parentKey: 'scan', nodeType: 'collector', label: 'Service Catalog', collectorName: 'service_catalog' },
  { key: 'collector.monitors', parentKey: 'scan', nodeType: 'collector', label: 'Monitors', collectorName: 'monitors' },
  { key: 'collector.dashboards', parentKey: 'scan', nodeType: 'collector', label: 'Dashboards', collectorName: 'dashboards' },
  { key: 'collector.synthetics', parentKey: 'scan', nodeType: 'collector', label: 'Synthetics', collectorName: 'synthetics' },
  { key: 'collector.logs', parentKey: 'scan', nodeType: 'collector', label: 'Logs', collectorName: 'logs' },
  { key: 'collector.integrations', parentKey: 'scan', nodeType: 'collector', label: 'Integrations', collectorName: 'integrations' },
  { key: 'collector.slos', parentKey: 'scan', nodeType: 'collector', label: 'SLOs', collectorName: 'slos' },
  { key: 'collector.governance', parentKey: 'scan', nodeType: 'collector', label: 'Governance', collectorName: 'governance' },
  { key: 'collector.idp', parentKey: 'scan', nodeType: 'collector', label: 'Internal Developer Portal', collectorName: 'idp' },
  { key: 'collector.rum', parentKey: 'scan', nodeType: 'collector', label: 'RUM', collectorName: 'rum' },
  { key: 'collector.usage', parentKey: 'scan', nodeType: 'collector', label: 'Usage', collectorName: 'usage' },
  { key: 'collector.security_findings', parentKey: 'scan', nodeType: 'collector', label: 'Security Findings', collectorName: 'security_findings' },
  { key: 'collector.cost_management', parentKey: 'scan', nodeType: 'collector', label: 'Cost Management', collectorName: 'cost_management' },
  { key: 'collector.incidents', parentKey: 'scan', nodeType: 'collector', label: 'Incidents', collectorName: 'incidents' },
  { key: 'collector.events', parentKey: 'scan', nodeType: 'collector', label: 'Events', collectorName: 'events' },

  // Rule categories (parent: the collector they most depend on, per FindingCategory)
  { key: 'rule.unified_tagging', parentKey: 'scan', nodeType: 'rule', label: 'Unified Tagging', ruleCategory: 'unified_tagging' },
  { key: 'rule.service_architecture', parentKey: 'collector.service_catalog', nodeType: 'rule', label: 'Service Architecture', ruleCategory: 'service_architecture' },
  { key: 'rule.integration_hygiene', parentKey: 'collector.integrations', nodeType: 'rule', label: 'Integration Hygiene', ruleCategory: 'integration_hygiene' },
  { key: 'rule.logs_health', parentKey: 'collector.logs', nodeType: 'rule', label: 'Logs Health', ruleCategory: 'logs_health' },
  { key: 'rule.monitors_health', parentKey: 'collector.monitors', nodeType: 'rule', label: 'Monitors Health', ruleCategory: 'monitors_health' },
  { key: 'rule.dashboards_health', parentKey: 'collector.dashboards', nodeType: 'rule', label: 'Dashboards Health', ruleCategory: 'dashboards_health' },
  { key: 'rule.synthetics_health', parentKey: 'collector.synthetics', nodeType: 'rule', label: 'Synthetics Health', ruleCategory: 'synthetics_health' },
  { key: 'rule.network_cloud', parentKey: 'collector.infrastructure', nodeType: 'rule', label: 'Network & Cloud', ruleCategory: 'network_cloud' },
  { key: 'rule.governance', parentKey: 'collector.governance', nodeType: 'rule', label: 'Governance', ruleCategory: 'governance' },
  { key: 'rule.security_posture', parentKey: 'collector.security_findings', nodeType: 'rule', label: 'Security Posture', ruleCategory: 'security_posture' },
  { key: 'rule.cost_optimization', parentKey: 'collector.cost_management', nodeType: 'rule', label: 'Cost Optimization', ruleCategory: 'cost_optimization' },

  // Pages (parent: most relevant rule node, or collector node if no rule dependency)
  { key: 'page.monitors', parentKey: 'rule.monitors_health', nodeType: 'page', label: 'Monitors Health', pagePath: '/monitors' },
  { key: 'page.dashboards', parentKey: 'rule.dashboards_health', nodeType: 'page', label: 'Dashboards', pagePath: '/dashboards' },
  { key: 'page.logs', parentKey: 'rule.logs_health', nodeType: 'page', label: 'Logs Health', pagePath: '/logs' },
  { key: 'page.synthetics', parentKey: 'rule.synthetics_health', nodeType: 'page', label: 'Synthetics', pagePath: '/synthetics' },
  { key: 'page.integrations', parentKey: 'rule.integration_hygiene', nodeType: 'page', label: 'Integrations', pagePath: '/integrations' },
  { key: 'page.governance', parentKey: 'rule.governance', nodeType: 'page', label: 'Governance / SSO', pagePath: '/governance' },
  { key: 'page.services', parentKey: 'rule.service_architecture', nodeType: 'page', label: 'Services & Catalog', pagePath: '/services' },
  { key: 'page.network', parentKey: 'rule.network_cloud', nodeType: 'page', label: 'Network & Cloud', pagePath: '/network' },
  { key: 'page.tagging_scorecard', parentKey: 'rule.unified_tagging', nodeType: 'page', label: 'Unified Tagging Scorecard', pagePath: '/tagging-scorecard' },
  { key: 'page.tags', parentKey: 'rule.unified_tagging', nodeType: 'page', label: 'Tag Explorer', pagePath: '/tags' },
  { key: 'page.tag_mapping', parentKey: 'rule.unified_tagging', nodeType: 'page', label: 'Tag Normalization', pagePath: '/tag-mapping' },
  { key: 'page.cloud_tags', parentKey: 'rule.unified_tagging', nodeType: 'page', label: 'Cloud Alignment', pagePath: '/cloud-tags' },
  { key: 'page.tag_governance', parentKey: 'rule.unified_tagging', nodeType: 'page', label: 'Multi-Org Governance', pagePath: '/tag-governance' },
  { key: 'page.tagging_implementation', parentKey: 'rule.unified_tagging', nodeType: 'page', label: 'Tagging Implementation Guide', pagePath: '/tagging-implementation' },
  { key: 'page.host_gaps', parentKey: 'collector.infrastructure', nodeType: 'page', label: 'Instrumentation Gaps', pagePath: '/host-gaps' },
  { key: 'page.cloud', parentKey: 'collector.infrastructure', nodeType: 'page', label: 'Cloud Inventory', pagePath: '/cloud' },
  { key: 'page.products', parentKey: 'collector.usage', nodeType: 'page', label: 'Product Usage', pagePath: '/products' },
  { key: 'page.usage', parentKey: 'collector.usage', nodeType: 'page', label: 'Plan & Usage', pagePath: '/usage' },
  { key: 'page.events', parentKey: 'collector.events', nodeType: 'page', label: 'Event Stats', pagePath: '/events' },

  // Section-grouping containers for previously-always-on utility pages.
  // These are NOT wired into navigation.ts/App.tsx FeatureGate — the pages
  // themselves stay always-reachable; only their child sections are gateable.
  { key: 'page.overview', parentKey: 'scan', nodeType: 'page', label: 'Overview', pagePath: '/overview' },
  { key: 'page.industry_templates', parentKey: 'scan', nodeType: 'page', label: 'Industry Templates', pagePath: '/tag-templates' },
  { key: 'page.inventory', parentKey: 'scan', nodeType: 'page', label: 'Inventory Explorer', pagePath: '/inventory' },
  { key: 'page.analytics', parentKey: 'scan', nodeType: 'page', label: 'Analytics', pagePath: '/analytics' },
  { key: 'page.ai_assessment', parentKey: 'scan', nodeType: 'page', label: 'AI Assessment', pagePath: '/ai' },
  { key: 'page.ai_settings', parentKey: 'scan', nodeType: 'page', label: 'AI Settings', pagePath: '/ai-settings' },
  { key: 'page.org_context', parentKey: 'scan', nodeType: 'page', label: 'Org Context', pagePath: '/org-context' },

  // Whole-page gates for the remaining previously-ungated pages, per explicit
  // request (unlike the section-grouping containers above, these ARE wired
  // into navigation.ts/App.tsx FeatureGate — disabling one hides the page).
  // Org Connections and Calculators are independent of scan data (you need
  // Org Connections to set up a scan in the first place, and Calculators is a
  // static sizing tool), so they're second/third tree roots (parentKey: null)
  // rather than children of 'scan' — disabling 'scan' must never lock out the
  // page you'd need to fix that.
  { key: 'page.orgs', parentKey: null, nodeType: 'page', label: 'Org Connections', pagePath: '/orgs' },
  { key: 'page.calculators', parentKey: null, nodeType: 'page', label: 'Sizing Calculators', pagePath: '/calculators' },
  { key: 'page.chat', parentKey: 'scan', nodeType: 'page', label: 'AI Chat Advisor', pagePath: '/chat' },
  { key: 'page.recommendations', parentKey: 'scan', nodeType: 'page', label: 'Recommendations', pagePath: '/recommendations' },
  { key: 'page.export', parentKey: 'scan', nodeType: 'page', label: 'Export Center', pagePath: '/export' },
  { key: 'page.scan_comparison', parentKey: 'scan', nodeType: 'page', label: 'Scan Comparison', pagePath: '/scan-comparison' },

  // Sections — 4th tree level, gate individual cards/tabs/widgets within a page.
  // Rendered via <SectionGate> (silent hide) in frontend/src, never <FeatureGate>.
  { key: 'section.overview.stat_tiles', parentKey: 'page.overview', nodeType: 'section', label: 'Stat Tiles' },
  { key: 'section.overview.inventory_summary', parentKey: 'page.overview', nodeType: 'section', label: 'Inventory Summary' },
  { key: 'section.overview.recent_scans', parentKey: 'page.overview', nodeType: 'section', label: 'Recent Scans' },
  { key: 'section.overview.by_org', parentKey: 'page.overview', nodeType: 'section', label: 'By Organization' },

  { key: 'section.industry_templates.picker', parentKey: 'page.industry_templates', nodeType: 'section', label: 'Template Picker' },
  { key: 'section.industry_templates.score_panel', parentKey: 'page.industry_templates', nodeType: 'section', label: 'Score Panel' },
  { key: 'section.industry_templates.export', parentKey: 'page.industry_templates', nodeType: 'section', label: 'Export' },

  { key: 'section.inventory.hosts', parentKey: 'page.inventory', nodeType: 'section', label: 'Hosts Tab' },
  { key: 'section.inventory.services', parentKey: 'page.inventory', nodeType: 'section', label: 'Services Tab' },
  { key: 'section.inventory.monitors', parentKey: 'page.inventory', nodeType: 'section', label: 'Monitors Tab' },
  { key: 'section.inventory.dashboards', parentKey: 'page.inventory', nodeType: 'section', label: 'Dashboards Tab' },
  { key: 'section.inventory.synthetics', parentKey: 'page.inventory', nodeType: 'section', label: 'Synthetics Tab' },
  { key: 'section.inventory.slos', parentKey: 'page.inventory', nodeType: 'section', label: 'SLOs Tab' },

  { key: 'section.host_gaps.coverage_gaps', parentKey: 'page.host_gaps', nodeType: 'section', label: 'Product Coverage Gaps' },
  { key: 'section.host_gaps.app_breakdown', parentKey: 'page.host_gaps', nodeType: 'section', label: 'App Breakdown' },
  { key: 'section.host_gaps.host_inventory', parentKey: 'page.host_gaps', nodeType: 'section', label: 'Host Inventory & Blind Spots' },
  { key: 'section.host_gaps.service_catalog_maturity', parentKey: 'page.host_gaps', nodeType: 'section', label: 'Service Catalog Maturity' },

  { key: 'section.cloud.cost_management', parentKey: 'page.cloud', nodeType: 'section', label: 'Cloud Cost Management' },
  { key: 'section.cloud.account_connections', parentKey: 'page.cloud', nodeType: 'section', label: 'Cloud Account Connections' },
  { key: 'section.cloud.tag_alignment', parentKey: 'page.cloud', nodeType: 'section', label: 'Cloud Tag → Datadog Key Alignment' },
  { key: 'section.cloud.tag_inventory', parentKey: 'page.cloud', nodeType: 'section', label: 'Cloud-Sourced Tag Inventory' },

  { key: 'section.products.product_grid', parentKey: 'page.products', nodeType: 'section', label: 'Inferred Product Grid' },
  { key: 'section.products.governance_signals', parentKey: 'page.products', nodeType: 'section', label: 'Governance Signals' },
  { key: 'section.products.not_covered', parentKey: 'page.products', nodeType: 'section', label: 'Not Yet Covered' },

  { key: 'section.analytics.infra_allotment', parentKey: 'page.analytics', nodeType: 'section', label: 'Infrastructure & Allotment' },
  { key: 'section.analytics.log_pipeline', parentKey: 'page.analytics', nodeType: 'section', label: 'Log Pipeline' },
  { key: 'section.analytics.synthetics', parentKey: 'page.analytics', nodeType: 'section', label: 'Synthetics' },
  { key: 'section.analytics.apm_observability', parentKey: 'page.analytics', nodeType: 'section', label: 'APM & Observability' },
  { key: 'section.analytics.integrations', parentKey: 'page.analytics', nodeType: 'section', label: 'Integrations' },
  { key: 'section.analytics.monitor_intelligence', parentKey: 'page.analytics', nodeType: 'section', label: 'Monitor Intelligence' },
  { key: 'section.analytics.slo_reliability', parentKey: 'page.analytics', nodeType: 'section', label: 'SLO & Reliability' },
  { key: 'section.analytics.governance_access', parentKey: 'page.analytics', nodeType: 'section', label: 'Governance & Access' },
  { key: 'section.analytics.rum', parentKey: 'page.analytics', nodeType: 'section', label: 'RUM' },
  { key: 'section.analytics.fleet_management', parentKey: 'page.analytics', nodeType: 'section', label: 'Fleet Management' },
  { key: 'section.analytics.security_incidents', parentKey: 'page.analytics', nodeType: 'section', label: 'Security & Incidents' },
  { key: 'section.analytics.db_network', parentKey: 'page.analytics', nodeType: 'section', label: 'DB & Network' },
  { key: 'section.analytics.scan_coverage_gaps', parentKey: 'page.analytics', nodeType: 'section', label: 'Scan Coverage Gaps' },
  { key: 'section.analytics.scorecard', parentKey: 'page.analytics', nodeType: 'section', label: 'Scorecard' },

  { key: 'section.usage.cost_insights', parentKey: 'page.usage', nodeType: 'section', label: 'Cost Insights' },
  { key: 'section.usage.product_breakdown', parentKey: 'page.usage', nodeType: 'section', label: 'Product Usage Breakdown' },
  { key: 'section.usage.usage_trends', parentKey: 'page.usage', nodeType: 'section', label: 'Usage Trends' },
  { key: 'section.usage.all_charges', parentKey: 'page.usage', nodeType: 'section', label: 'All Charges' },

  { key: 'section.tagging_scorecard.coverage_by_key', parentKey: 'page.tagging_scorecard', nodeType: 'section', label: 'Tag Coverage by Key' },
  { key: 'section.tagging_scorecard.ust_compliance', parentKey: 'page.tagging_scorecard', nodeType: 'section', label: 'Unified Service Tagging Compliance' },
  { key: 'section.tagging_scorecard.mapping_suggestions', parentKey: 'page.tagging_scorecard', nodeType: 'section', label: 'Tag Mapping Suggestions' },
  { key: 'section.tagging_scorecard.findings', parentKey: 'page.tagging_scorecard', nodeType: 'section', label: 'Findings' },

  { key: 'section.services.findings_summary', parentKey: 'page.services', nodeType: 'section', label: 'Findings Summary' },
  { key: 'section.services.service_inventory', parentKey: 'page.services', nodeType: 'section', label: 'Service Inventory' },

  { key: 'section.logs.risk_signals', parentKey: 'page.logs', nodeType: 'section', label: 'Active Risk Signals' },
  { key: 'section.logs.findings', parentKey: 'page.logs', nodeType: 'section', label: 'Findings' },
  { key: 'section.logs.index_breakdown', parentKey: 'page.logs', nodeType: 'section', label: 'Index Breakdown' },
  { key: 'section.logs.retention_distribution', parentKey: 'page.logs', nodeType: 'section', label: 'Retention Distribution' },

  { key: 'section.monitors.quality_signals', parentKey: 'page.monitors', nodeType: 'section', label: 'Monitor Quality Signals' },
  { key: 'section.monitors.monitor_types', parentKey: 'page.monitors', nodeType: 'section', label: 'Monitor Types' },
  { key: 'section.monitors.findings', parentKey: 'page.monitors', nodeType: 'section', label: 'Findings' },
  { key: 'section.monitors.monitor_inventory', parentKey: 'page.monitors', nodeType: 'section', label: 'Monitor Inventory' },

  { key: 'section.dashboards.metric_tiles', parentKey: 'page.dashboards', nodeType: 'section', label: 'Metric Tiles' },
  { key: 'section.dashboards.coverage_analysis', parentKey: 'page.dashboards', nodeType: 'section', label: 'Coverage Analysis' },
  { key: 'section.dashboards.best_practices', parentKey: 'page.dashboards', nodeType: 'section', label: 'Best Practices' },
  { key: 'section.dashboards.findings', parentKey: 'page.dashboards', nodeType: 'section', label: 'Findings' },

  { key: 'section.synthetics.active_signals', parentKey: 'page.synthetics', nodeType: 'section', label: 'Active Signals' },
  { key: 'section.synthetics.test_type_breakdown', parentKey: 'page.synthetics', nodeType: 'section', label: 'Test Type Breakdown' },
  { key: 'section.synthetics.location_coverage', parentKey: 'page.synthetics', nodeType: 'section', label: 'Location Coverage' },
  { key: 'section.synthetics.test_inventory', parentKey: 'page.synthetics', nodeType: 'section', label: 'Test Inventory' },
  { key: 'section.synthetics.findings', parentKey: 'page.synthetics', nodeType: 'section', label: 'Findings' },

  { key: 'section.network.cloud_connections', parentKey: 'page.network', nodeType: 'section', label: 'Cloud Provider Connections' },
  { key: 'section.network.cnm', parentKey: 'page.network', nodeType: 'section', label: 'Cloud Network Monitor' },
  { key: 'section.network.ndm', parentKey: 'page.network', nodeType: 'section', label: 'Network Device Monitoring' },

  { key: 'section.governance.metric_tiles', parentKey: 'page.governance', nodeType: 'section', label: 'Metric Tiles' },
  { key: 'section.governance.sso_config', parentKey: 'page.governance', nodeType: 'section', label: 'SSO Configuration' },
  { key: 'section.governance.findings', parentKey: 'page.governance', nodeType: 'section', label: 'Findings' },

  { key: 'section.events.by_status', parentKey: 'page.events', nodeType: 'section', label: 'By Status' },
  { key: 'section.events.by_source', parentKey: 'page.events', nodeType: 'section', label: 'By Source' },
  { key: 'section.events.by_service', parentKey: 'page.events', nodeType: 'section', label: 'By Service' },

  { key: 'section.tags.required_recommendations', parentKey: 'page.tags', nodeType: 'section', label: 'Unified Tagging Recommendations' },
  { key: 'section.tags.hierarchy', parentKey: 'page.tags', nodeType: 'section', label: 'Tag Hierarchy by Product Layer' },
  { key: 'section.tags.key_inventory', parentKey: 'page.tags', nodeType: 'section', label: 'All Tag Keys' },

  { key: 'section.tag_mapping.conflicts', parentKey: 'page.tag_mapping', nodeType: 'section', label: 'Conflicts & Inconsistencies' },
  { key: 'section.tag_mapping.synonym_detection', parentKey: 'page.tag_mapping', nodeType: 'section', label: 'Synonym Detection' },
  { key: 'section.tag_mapping.dictionary_status', parentKey: 'page.tag_mapping', nodeType: 'section', label: 'Tag Dictionary Status' },

  { key: 'section.cloud_tags.summary', parentKey: 'page.cloud_tags', nodeType: 'section', label: 'Summary' },
  { key: 'section.cloud_tags.propagation_gaps', parentKey: 'page.cloud_tags', nodeType: 'section', label: 'Propagation Gaps' },
  { key: 'section.cloud_tags.comparison_table', parentKey: 'page.cloud_tags', nodeType: 'section', label: 'Full Tag Comparison' },

  { key: 'section.tag_governance.org_profiles', parentKey: 'page.tag_governance', nodeType: 'section', label: 'Organization Tag Profiles' },
  { key: 'section.tag_governance.standard_inconsistencies', parentKey: 'page.tag_governance', nodeType: 'section', label: 'Standard Tag Inconsistencies' },
  { key: 'section.tag_governance.value_drift', parentKey: 'page.tag_governance', nodeType: 'section', label: 'Value Drift Across Orgs' },
  { key: 'section.tag_governance.common_tags', parentKey: 'page.tag_governance', nodeType: 'section', label: 'Tags Common to All Orgs' },
  { key: 'section.tag_governance.orphan_tags', parentKey: 'page.tag_governance', nodeType: 'section', label: 'Orphan Tag Keys' },

  { key: 'section.ai_assessment.executive_summary', parentKey: 'page.ai_assessment', nodeType: 'section', label: 'Executive Summary' },
  { key: 'section.ai_assessment.strengths_risks', parentKey: 'page.ai_assessment', nodeType: 'section', label: 'Key Strengths / Top Risks' },
  { key: 'section.ai_assessment.prioritized_recommendations', parentKey: 'page.ai_assessment', nodeType: 'section', label: 'Prioritized Recommendations' },
  { key: 'section.ai_assessment.tagging_strategy', parentKey: 'page.ai_assessment', nodeType: 'section', label: 'Recommended Tagging Strategy' },
  { key: 'section.ai_assessment.remediation_plan', parentKey: 'page.ai_assessment', nodeType: 'section', label: 'Remediation Plan' },
  { key: 'section.ai_assessment.takeaways', parentKey: 'page.ai_assessment', nodeType: 'section', label: 'Health Check Takeaways' },

  { key: 'section.ai_settings.provider_config', parentKey: 'page.ai_settings', nodeType: 'section', label: 'Provider Configuration' },
  { key: 'section.ai_settings.status', parentKey: 'page.ai_settings', nodeType: 'section', label: 'Active Configuration Status' },
  { key: 'section.ai_settings.prompts', parentKey: 'page.ai_settings', nodeType: 'section', label: 'Prompts Editor' },

  { key: 'section.org_context.about_business', parentKey: 'page.org_context', nodeType: 'section', label: 'About Your Business' },
  { key: 'section.org_context.tech_stack', parentKey: 'page.org_context', nodeType: 'section', label: 'Tech Stack & Infrastructure' },
  { key: 'section.org_context.scale_volume', parentKey: 'page.org_context', nodeType: 'section', label: 'Scale & Volume' },
  { key: 'section.org_context.service_tiers', parentKey: 'page.org_context', nodeType: 'section', label: 'Service Criticality Tiers' },
  { key: 'section.org_context.revenue_compliance', parentKey: 'page.org_context', nodeType: 'section', label: 'Revenue & Compliance' },
  { key: 'section.org_context.seasonality', parentKey: 'page.org_context', nodeType: 'section', label: 'Seasonality & Traffic Patterns' },
  { key: 'section.org_context.team_ops', parentKey: 'page.org_context', nodeType: 'section', label: 'Team & Operations' },
  { key: 'section.org_context.goals_pain_points', parentKey: 'page.org_context', nodeType: 'section', label: 'Goals & Pain Points' },

  { key: 'section.scans.collector_detail_panel', parentKey: 'scan', nodeType: 'section', label: 'Scan Collector Detail Panel' },
  { key: 'section.integrations.findings_table', parentKey: 'page.integrations', nodeType: 'section', label: 'Integration Findings' },
];

// Rule categories whose findings actually span multiple collectors' data —
// used by FeatureFlagRepository.isRuleCategoryEnabled to additionally require
// every listed collector to be enabled (not just the rule node's own parent).
// Read from unified-tagging.rules.ts: envTagRule queries `hosts` (infrastructure),
// versionTagRule queries `services` (apm), monitorTagRule queries `monitors`,
// syntheticsTagRule queries `synthetics_tests` (synthetics).
export const RULE_COLLECTOR_DEPENDENCIES: Record<string, string[]> = {
  unified_tagging: ['infrastructure', 'apm', 'monitors', 'synthetics'],
};
