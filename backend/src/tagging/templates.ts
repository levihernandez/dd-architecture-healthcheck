import { getDatabase } from '../db/database';

export interface TemplateTag {
  key: string;
  description: string;
  why: string;
  how: string;
  when: string;
  where: string;
  exampleValues?: string[];
  /** Exact per-platform setup syntax — populated for env/service/version per
   * https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging */
  platformGuides?: Array<{ platform: string; method: string }>;
}

/**
 * Tags cloud providers, container orchestrators, and the Agent already inject
 * automatically — no manual tagging required. Per
 * https://www.datadoghq.com/blog/tagging-best-practices/: "Letting Datadog
 * automatically import tags is one of the most powerful ways you can begin
 * monitoring your systems" — these should be reused/paired with rather than
 * duplicated by a manual tag of the same intent.
 */
export interface CloudAutoTag {
  key: string;
  provider: 'aws' | 'gcp' | 'azure' | 'kubernetes' | 'agent';
  description: string;
  /** Which manual/business tag this auto-tag complements or can stand in for. */
  pairsWith: string;
  reuseNote: string;
  exampleValues?: string[];
}

export const CLOUD_AUTO_TAGS: CloudAutoTag[] = [
  {
    key: 'region', provider: 'aws',
    description: 'Cloud region, auto-imported from the AWS/GCP/Azure integration.',
    pairsWith: 'env',
    reuseNote: 'Combine with env (region:env) to scope dashboards, monitors, and disaster-recovery views without adding any manual tag.',
    exampleValues: ['us-east-1', 'eu-west-1'],
  },
  {
    key: 'availability-zone', provider: 'aws',
    description: 'AWS availability zone, auto-imported from EC2 metadata.',
    pairsWith: 'env',
    reuseNote: 'Free failure-domain visibility — pair with env to spot AZ-correlated incidents before they page anyone.',
    exampleValues: ['us-east-1a', 'us-east-1b'],
  },
  {
    key: 'account', provider: 'aws',
    description: 'AWS account ID/alias, auto-imported from the AWS integration (also account_id).',
    pairsWith: 'cost_center',
    reuseNote: 'Map account → cost_center with a log/metric pipeline processor instead of hand-tagging every host — most orgs run one account per cost center already.',
    exampleValues: ['prod-payments', '123456789012'],
  },
  {
    key: 'instance-type', provider: 'aws',
    description: 'EC2/VM instance type, auto-imported from cloud metadata.',
    pairsWith: 'tier',
    reuseNote: 'Correlate instance sizing with service tier to catch under/over-provisioned tier-0 services without manual tagging.',
    exampleValues: ['m5.xlarge', 'c6g.2xlarge'],
  },
  {
    key: 'autoscaling-group', provider: 'aws',
    description: 'ASG name, auto-imported from the AWS integration.',
    pairsWith: 'service',
    reuseNote: 'ASGs are usually 1:1 with a service — reuse the ASG name as a service-grouping key before asking teams to add a redundant tag.',
    exampleValues: ['api-gateway-asg', 'worker-fleet-asg'],
  },
  {
    key: 'kube_cluster_name', provider: 'kubernetes',
    description: 'Cluster name, auto-injected by the Datadog Cluster Agent.',
    pairsWith: 'application',
    reuseNote: 'Reuse as the application/business-grouping signal for cluster-per-app deployment models before adding a manual tag.',
    exampleValues: ['prod-us-east', 'staging-eu'],
  },
  {
    key: 'kube_namespace', provider: 'kubernetes',
    description: 'Namespace, auto-injected by the Cluster Agent from pod metadata.',
    pairsWith: 'team',
    reuseNote: 'Most orgs map namespace 1:1 to team — reuse namespace as the team signal via a pipeline processor instead of asking every service owner to add team manually.',
    exampleValues: ['payments', 'platform-sre'],
  },
  {
    key: 'kube_deployment', provider: 'kubernetes',
    description: 'Deployment name, auto-injected by the Cluster Agent.',
    pairsWith: 'service',
    reuseNote: 'Should already equal DD_SERVICE if the Kubernetes UST labels (tags.datadoghq.com/service) are set on the Deployment — verify rather than re-tag.',
    exampleValues: ['auth-server', 'checkout-api'],
  },
  {
    key: 'pod_name', provider: 'kubernetes',
    description: 'Pod name, auto-injected by the Agent — enables per-pod trace/log correlation with zero configuration.',
    pairsWith: 'service',
    reuseNote: 'Purely an identity key for correlation, not a substitute for service — leave as-is, do not attempt to replace.',
    exampleValues: ['auth-server-7d9f8-x2k1p'],
  },
  {
    key: 'host', provider: 'agent',
    description: 'Universal host pivot, auto-injected by every Agent integration.',
    pairsWith: 'env',
    reuseNote: 'Already correlates infra metrics, APM traces, logs, and NDM flows by hostname with no setup — the pivot every other tag should be layered on top of, not replace.',
  },
  {
    key: 'container_id', provider: 'agent',
    description: 'Container ID, auto-injected by Autodiscovery for every container.',
    pairsWith: 'service',
    reuseNote: 'Exact correlation between container metrics, traces, and stdout logs — already free; only add service alongside it, don\'t re-derive identity from it.',
  },
];

export interface IndustryTemplate {
  id: string;
  name: string;
  category: 'industry' | 'org';
  /** Broad grouping for the template picker UI (e.g. "Payments", "Healthcare & Life Sciences").
   * Multiple templates can share a sector to represent sub-verticals within it — e.g. Payments
   * splits into Banking, Restaurants/Merchants, E-commerce, and Card Networks, each with its own
   * required/recommended/optional tags, rather than one generic "Payments" template for everyone.
   * Undefined for 'org' category templates, which aren't industry-scoped. */
  sector?: string;
  description: string;
  icon: string;
  detectSignals?: string[]; // tag keys or service name patterns that suggest this template
  globalBaseline: TemplateTag[]; // always required across all templates
  required: TemplateTag[];
  recommended: TemplateTag[];
  optional: TemplateTag[];
  complianceTags?: Array<{ key: string; standard: string; note: string }>;
}

// ─── Core global baseline (required in every template) ────────────────────────

const GLOBAL_BASELINE: TemplateTag[] = [
  {
    key: 'env',
    description: 'Deployment environment (prod, staging, dev, qa)',
    why: 'Isolates production telemetry from test noise. Without env you cannot filter dashboards or SLOs by environment.',
    how: 'Set DD_ENV in all app runtimes. Use extra_tags in datadog.yaml for hosts. Use Kubernetes Admission Controller or pod annotations (tags.datadoghq.com/env) for containers.',
    when: 'Day 0 — before any telemetry flows. Enforce in CI/CD so no deployment proceeds without it.',
    where: 'Hosts, containers, APM traces, monitors, synthetics, logs, RUM sessions, SLOs.',
    exampleValues: ['prod', 'staging', 'dev', 'qa'],
    platformGuides: [
      { platform: 'Kubernetes', method: 'Pod/Deployment label tags.datadoghq.com/env: "<ENV>", or env var DD_ENV. OpenTelemetry: OTEL_RESOURCE_ATTRIBUTES="deployment.environment=<ENV>".' },
      { platform: 'Docker', method: 'Env var DD_ENV=<ENV>, or Docker label com.datadoghq.tags.env=<ENV> — e.g. docker run -e DD_ENV=<ENV> -l com.datadoghq.tags.env=<ENV> ...' },
      { platform: 'Amazon ECS', method: 'DD_ENV env var or com.datadoghq.tags.env label in the task definition. On Fargate this goes on the application container, not the Datadog Agent container.' },
      { platform: 'VM / plain host (single service)', method: 'Agent datadog.yaml: env: <ENV> plus tags: [service:<SERVICE>].' },
      { platform: 'VM / plain host (multi-service)', method: 'Set env: <ENV> in datadog.yaml, then per-process DD_ENV=<env> DD_SERVICE=<service> DD_VERSION=<version> /bin/my-service.' },
    ],
  },
  {
    key: 'service',
    description: 'Logical service name — must match APM service identifier exactly',
    why: 'Powers the Service Map, service-level SLOs, and Deployment Tracking. Enables alert routing to the right team. env and service are non-replaceable core tags in APM and logs — they cannot be renamed.',
    how: 'Set DD_SERVICE in all app runtimes. For hosts, add service:<name> to extra_tags. For K8s, use pod annotations. For logs, use a remapper processor to normalize the service field. There can only be one service per span.',
    when: 'At service creation time. The name must never change without a migration plan — historical continuity breaks.',
    where: 'APM spans, hosts, containers, monitors, synthetics, logs, RUM, service catalog.',
    exampleValues: ['auth-server', 'api-gateway', 'payment-processor'],
    platformGuides: [
      { platform: 'Kubernetes', method: 'Label tags.datadoghq.com/service: "<SERVICE>", or DD_SERVICE env var. Per-container override: tags.datadoghq.com/<CONTAINER_NAME>.service. OTel: OTEL_SERVICE_NAME (takes precedence over service.name).' },
      { platform: 'Docker', method: 'DD_SERVICE env var or com.datadoghq.tags.service label.' },
      { platform: 'Amazon ECS', method: 'DD_SERVICE env var or com.datadoghq.tags.service label in the task definition (application container, not the Agent container on Fargate).' },
      { platform: 'VM / plain host', method: 'tags: [service:<SERVICE>] in datadog.yaml for single-service hosts; per-process DD_SERVICE for multi-service hosts; or a Process Check config with a service: field.' },
    ],
  },
  {
    key: 'version',
    description: 'Application version, git SHA, or release tag',
    why: 'Required for Deployment Tracking — auto-compares error rates between current and previous release. Mandated by most change management processes.',
    how: 'Set DD_VERSION in all app runtimes. Inject the Docker image tag or git SHA at build time. The value must update with every deployment, including hotfixes. Manually-set version is never overridden by Datadog automatic tagging.',
    when: 'At build time. Use the CI/CD pipeline to inject automatically so it is never forgotten.',
    where: 'APM traces (required for Deployment Tracking), hosts running the app, RUM sessions.',
    exampleValues: ['2.1.3', 'v1.0.0', '06142ee'],
    platformGuides: [
      { platform: 'Kubernetes', method: 'Label tags.datadoghq.com/version: "<VERSION>", or DD_VERSION env var. OTel: service.version via OTEL_RESOURCE_ATTRIBUTES.' },
      { platform: 'Docker', method: 'DD_VERSION env var or com.datadoghq.tags.version label, set at build/deploy time from the image tag or git SHA.' },
      { platform: 'Amazon ECS', method: 'DD_VERSION env var or com.datadoghq.tags.version label in the task definition, updated by the CI/CD pipeline on every deploy.' },
      { platform: 'VM / plain host', method: 'Per-process DD_VERSION env var injected by the deploy script; no static Agent config option since it changes every release.' },
    ],
  },
  {
    key: 'team',
    description: 'Owning engineering team — must match Datadog Teams handle',
    why: 'Enables alert routing, incident ownership, and team-level SLO and cost reporting. Without it, alerts have no owner.',
    how: 'Add team:<name> to all owned resources. Value must match the Datadog Teams handle (lowercase, hyphens). Enforce via IaC templates and pod namespace labels.',
    when: 'At service/resource creation. Update immediately on team re-orgs.',
    where: 'All resources: hosts, containers, APM services, monitors, synthetics, dashboards, SLOs, service catalog.',
    exampleValues: ['payments-team', 'platform-sre', 'integrations'],
  },
  {
    key: 'owner',
    description: 'Individual or group email responsible for the resource',
    why: 'Enables direct contact during incidents without looking up the on-call rotation. Differentiates day-to-day owner from the team.',
    how: 'Add owner:<email-or-handle> to service catalog entries and monitors. Use a team alias email rather than an individual for production services.',
    when: 'At service onboarding. Update when ownership transfers.',
    where: 'Service catalog (primary), monitors, APM services.',
    exampleValues: ['platform-oncall@company.com', 'jane.doe', 'payments-oncall'],
  },
  {
    key: 'cost_center',
    description: 'Cost center code for chargeback and FinOps',
    why: 'Without cost_center you cannot generate chargeback reports or allocate cloud spend to P&L owners — the single most critical FinOps tag.',
    how: 'Add cost_center:<code> to all host extra_tags. Set as a cloud provider tag and sync via Datadog integration. Enforce in IaC templates.',
    when: 'At resource provisioning. Required before any cloud billing data is useful for attribution.',
    where: 'All resources. Priority: hosts, cloud instances, database instances.',
    exampleValues: ['CC-1234', 'eng-platform', 'finops-42'],
  },
];

// ─── Industry templates ────────────────────────────────────────────────────────

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  // ─ Generic baseline ─────────────────────────────────────────────────────────
  {
    id: 'generic',
    name: 'Generic / Baseline',
    category: 'industry',
    sector: 'General',
    description: 'Universal tagging baseline. Start here before applying any sector-specific extensions.',
    icon: '⬡',
    globalBaseline: GLOBAL_BASELINE,
    required: [],
    recommended: [
      { key: 'application', description: 'Business application grouping for microservices', why: 'Rolls up multiple microservices into one business application view for executive dashboards.', how: 'Add application:<name> to all resources in the application. Align with service catalog taxonomy.', when: 'At application onboarding.', where: 'All resources.', exampleValues: ['store-platform', 'payments', 'identity'] },
      { key: 'tier', description: 'Service criticality (0=most critical, 3=lowest)', why: 'Drives SLO targets, on-call schedules, and alert priority. Tier 0 requires 24/7 coverage.', how: 'Add tier:<0|1|2|3> to services. Define tier criteria in your runbook.', when: 'At service onboarding. Review quarterly.', where: 'APM services, monitors, SLOs.', exampleValues: ['0', '1', '2', '3'] },
      { key: 'region', description: 'Cloud or geographic region', why: 'Enables geographic performance analysis and latency attribution by region.', how: 'Auto-populated by cloud integrations or add manually via extra_tags.', when: 'At provisioning.', where: 'Hosts, cloud instances.', exampleValues: ['us-east-1', 'eu-west-1'] },
      { key: 'product_line', description: 'Product or business line grouping', why: 'Rolls services up to the product/business-line level for executive and P&L reporting independent of team structure.', how: 'Add product_line:<name> to all resources serving that product.', when: 'At service onboarding.', where: 'All resources.', exampleValues: ['core-platform', 'mobile', 'growth'] },
      { key: 'deployment_type', description: 'Deployment/rollout strategy in effect', why: 'Distinguishes steady-state resources from canary/blue-green rollout targets so anomaly detection and alerting can treat them differently.', how: 'Set from the CI/CD pipeline at deploy time based on the rollout strategy.', when: 'At deployment time.', where: 'Hosts, APM services during a rollout.', exampleValues: ['stable', 'canary', 'blue', 'green'] },
    ],
    optional: [
      { key: 'lifecycle', description: 'Resource lifecycle (active, deprecated, canary)', why: 'Enables filtering deprecated resources from health dashboards.', how: 'Add lifecycle:<state> to resources. Update as lifecycle changes.', when: 'At provisioning and during deprecation.', where: 'All resources.', exampleValues: ['active', 'deprecated', 'canary'] },
    ],
  },

  // ─ Technology / SaaS ────────────────────────────────────────────────────────
  {
    id: 'technology',
    name: 'Technology / SaaS',
    category: 'industry',
    sector: 'Technology & Software',
    description: 'For SaaS and software companies with multi-tenant architectures and fast release cycles.',
    icon: '💻',
    detectSignals: ['tenant', 'tenant_id', 'feature_flag', 'release_channel'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'application', description: 'SaaS application or product name', why: 'Groups microservices by product for reliability reporting and customer SLA tracking.', how: 'Add to all resources. Align with the service catalog.', when: 'At service creation.', where: 'All resources.', exampleValues: ['store-platform', 'identity', 'analytics'] },
      { key: 'tier', description: 'Service tier (0=critical, 3=low)', why: 'Fast release cycles require clear priority to avoid alert fatigue. Tier 0 services block releases if unhealthy.', how: 'Define tier in the service catalog and propagate to monitors and SLOs.', when: 'At service onboarding.', where: 'APM services, monitors, SLOs.', exampleValues: ['0', '1', '2', '3'] },
    ],
    recommended: [
      { key: 'tenant_id', description: 'Customer tenant identifier', why: 'Required for multi-tenant observability — isolate one customer\'s performance issues from another. Enables per-tenant SLAs.', how: 'Inject tenant_id as a span tag in APM for all multi-tenant request handlers. Propagate to logs via MDC.', when: 'At instrumentation time.', where: 'APM traces, logs.', exampleValues: ['tenant-acme', 'tenant-12345'] },
      { key: 'release_channel', description: 'Release channel (stable, beta, canary)', why: 'Enables comparison of error rates across release channels during progressive rollouts.', how: 'Inject as DD_VERSION or a custom span tag. Set in Kubernetes deployment labels.', when: 'At deployment time.', where: 'APM traces, hosts running the release.', exampleValues: ['stable', 'beta', 'canary'] },
      { key: 'feature_flag', description: 'Active feature flag for gradual rollout tracking', why: 'Correlates feature flag activation with performance changes in APM.', how: 'Inject as a custom span tag using your feature flag SDK.', when: 'When a feature flag is active for more than 10% of traffic.', where: 'APM traces.', exampleValues: ['new-checkout', 'ai-search-v2'] },
      { key: 'plan_tier', description: 'Customer subscription plan tier', why: 'Enterprise-tier customers expect stricter SLAs — plan-level dashboards let support triage by contractual commitment, not just raw severity.', how: 'Inject plan_tier from the billing/entitlements service as a span tag on request handlers.', when: 'At instrumentation time.', where: 'APM traces, logs for request-handling services.', exampleValues: ['free', 'pro', 'enterprise'] },
      { key: 'shard_id', description: 'Database or tenant shard identifier', why: 'Sharded SaaS backends need shard-level latency and saturation visibility — a single hot shard looks like noise in an aggregate view.', how: 'Inject shard_id as a span tag and DBM query tag from the shard router.', when: 'At instrumentation time.', where: 'APM traces, DBM query metrics.', exampleValues: ['shard-01', 'shard-eu-03'] },
      { key: 'onboarding_stage', description: 'Customer onboarding/lifecycle stage', why: 'New-customer traffic patterns (imports, bulk API calls) differ from steady-state usage — conflating them skews capacity planning and false-positive alerting.', how: 'Inject from the customer lifecycle/CRM system as a span tag on customer-facing services.', when: 'At instrumentation time.', where: 'APM traces for onboarding and provisioning services.', exampleValues: ['trial', 'onboarding', 'active', 'churned'] },
    ],
    optional: [
      { key: 'data_residency', description: 'Data residency region for GDPR/compliance', why: 'Required for GDPR compliance — data must not flow across residency boundaries undetected.', how: 'Tag cloud resources and database instances with their data residency region.', when: 'At provisioning for regulated data.', where: 'Database instances, cloud storage, APM services handling PII.', exampleValues: ['eu', 'us', 'apac'] },
    ],
  },

  // ─ Finance / Banking ────────────────────────────────────────────────────────
  {
    id: 'finance',
    name: 'Finance & Banking',
    category: 'industry',
    sector: 'Banking & Capital Markets',
    description: 'For financial services with compliance, audit, and risk management requirements.',
    icon: '🏦',
    detectSignals: ['pci_scope', 'trading_system', 'risk_level', 'sox_scope'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'pci_scope', description: 'PCI DSS scope (in-scope, out-of-scope, cde)', why: 'PCI DSS mandates scoping of cardholder data environments. Without this tag, compliance automation is impossible.', how: 'Apply pci_scope:in-scope to all resources in the CDE. Use cloud provider tags and sync via integration. Review scope with QSA annually.', when: 'At provisioning for any resource touching card data.', where: 'Hosts, database instances, network devices, cloud resources in the CDE.', exampleValues: ['in-scope', 'out-of-scope', 'cde'] },
      { key: 'data_classification', description: 'Data sensitivity (public, internal, confidential, restricted)', why: 'Required for regulatory compliance (GDPR, PCI) and enables automated access control based on data sensitivity.', how: 'Apply based on the data classification policy. Use in conjunction with the datatype tag.', when: 'At data store provisioning and service creation.', where: 'Database instances (DBM), hosts, APM services handling sensitive data.', exampleValues: ['public', 'internal', 'confidential', 'restricted'] },
      { key: 'risk_level', description: 'Business risk level (critical, high, medium, low)', why: 'Drives incident response priority, on-call escalation, and change management approval requirements.', how: 'Define risk levels in your risk register and apply via IaC. Map to monitor priority.', when: 'At service onboarding. Review annually with risk management.', where: 'APM services, monitors, service catalog.', exampleValues: ['critical', 'high', 'medium', 'low'] },
    ],
    recommended: [
      { key: 'regulatory_scope', description: 'Applicable regulation (SOX, PCI, Basel, MiFID)', why: 'Enables automated compliance dashboards and audit evidence collection per regulation.', how: 'Apply the applicable regulation as a tag. Resources can have multiple regulatory scope tags.', when: 'At provisioning for regulated systems.', where: 'All resources in regulated systems.', exampleValues: ['sox', 'pci-dss', 'basel-iii', 'mifid-ii'] },
      { key: 'trading_system', description: 'Flag for trading systems (yes/no)', why: 'Trading systems require ultra-low latency monitoring and stricter SLOs. This flag enables separate dashboards and alert thresholds.', how: 'Add trading_system:yes to all services and hosts in the trading path.', when: 'At service onboarding for trading infrastructure.', where: 'APM services, hosts in the trading path.', exampleValues: ['yes', 'no'] },
      { key: 'asset_class', description: 'Traded asset class', why: 'Equities, fixed income, FX, and derivatives systems have different latency profiles and market-hours dependencies — blending them into one dashboard hides asset-class-specific degradation.', how: 'Inject asset_class as a span tag in order management and execution services.', when: 'At instrumentation time.', where: 'APM spans for trading and risk services.', exampleValues: ['equities', 'fixed-income', 'fx', 'derivatives'] },
      { key: 'trading_desk', description: 'Trading desk identifier', why: 'Desk-level monitoring isolates a single desk\'s order flow issues from firm-wide trading infrastructure, and maps directly to desk-level P&L and risk ownership.', how: 'Inject trading_desk as a span tag from the order management system.', when: 'At instrumentation time.', where: 'APM spans for order management and execution services.', exampleValues: ['desk-equities-ny', 'desk-fx-london'] },
      { key: 'booking_entity', description: 'Legal booking entity for the trade', why: 'Multi-entity institutions must attribute trades to the correct legal entity for regulatory reporting (e.g. MiFID II transaction reporting) — this is an audit requirement, not just an org convenience.', how: 'Inject booking_entity from the trade booking system as a span tag.', when: 'At instrumentation time.', where: 'APM spans, database instances for trade booking.', exampleValues: ['entity-us-bank-na', 'entity-eu-sub'] },
    ],
    optional: [
      { key: 'sox_scope', description: 'SOX control scope flag', why: 'SOX requires evidence of controls over financial reporting systems.', how: 'Apply sox_scope:in-scope to all systems that contribute to financial reporting.', when: 'During SOX scoping exercises with internal audit.', where: 'Hosts, database instances, APM services in the financial reporting path.', exampleValues: ['in-scope', 'out-of-scope'] },
    ],
    complianceTags: [
      { key: 'pci_scope', standard: 'PCI DSS', note: 'Required for cardholder data environment scoping. In-scope systems must meet all 12 PCI DSS requirements.' },
      { key: 'data_classification', standard: 'GDPR/CCPA', note: 'Required for data protection impact assessments and automated access control enforcement.' },
    ],
  },

  // ─ Payments sector — sub-verticals ────────────────────────────────────────────
  // A "Payments" org can be a PSP/gateway, a bank issuing cards, a merchant-facing
  // POS vendor, or a card network — each has a different tagging profile despite
  // sharing PCI scope. One org is assigned exactly one of these (see org_tag_template).
  {
    id: 'fintech',
    name: 'Payments — PSP & Payment Gateways',
    category: 'industry',
    sector: 'Payments',
    description: 'For payment service providers, gateways, neobanks, and general fintech platforms routing transactions.',
    icon: '💳',
    detectSignals: ['pci_scope', 'transaction_type', 'payment_processor', 'fraud_scope'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'pci_scope', description: 'PCI scope indicator', why: 'Mandatory for any system handling payment card data.', how: 'See Finance & Banking template.', when: 'At provisioning.', where: 'All payment-path resources.', exampleValues: ['in-scope', 'out-of-scope'] },
      { key: 'transaction_type', description: 'Payment transaction type', why: 'Different transaction types have different SLOs and regulatory requirements. Enables per-type latency dashboards.', how: 'Inject as a span tag in APM for each payment handler.', when: 'At instrumentation time.', where: 'APM spans for payment processing services.', exampleValues: ['auth', 'capture', 'refund', 'void', 'settlement'] },
    ],
    recommended: [
      { key: 'fraud_scope', description: 'Fraud detection system flag', why: 'Fraud services require separate performance baselines and stricter latency SLOs.', how: 'Tag all fraud-path services and hosts.', when: 'At service onboarding.', where: 'APM services, hosts in the fraud detection path.', exampleValues: ['yes', 'no'] },
      { key: 'payment_processor', description: 'Payment processor or PSP name', why: 'Enables attribution of latency to specific PSPs and triggers alerts when a PSP degrades.', how: 'Inject as a span tag when calling PSP APIs.', when: 'At instrumentation time.', where: 'APM spans for PSP integrations.', exampleValues: ['stripe', 'adyen', 'braintree', 'paypal'] },
      { key: 'settlement_region', description: 'Settlement region for cross-border flows', why: 'Cross-border settlements have different latency profiles and regulatory requirements.', how: 'Add to payment processing spans based on the destination currency/region.', when: 'At instrumentation time.', where: 'APM spans, monitors for settlement SLAs.', exampleValues: ['eu', 'us', 'apac'] },
      { key: 'currency', description: 'Transaction currency', why: 'FX conversion and multi-currency settlement paths have distinct failure modes from single-currency flows — currency-blind dashboards hide currency-specific PSP or FX-provider degradation.', how: 'Inject currency as a span tag from the transaction payload in payment processing services.', when: 'At instrumentation time.', where: 'APM spans for payment and settlement services.', exampleValues: ['usd', 'eur', 'gbp'] },
      { key: 'merchant_id', description: 'Merchant or sub-merchant identifier', why: 'Platform PSPs process for many merchants — merchant-level dashboards isolate one merchant\'s integration bug or fraud spike from platform-wide health.', how: 'Inject merchant_id as a span tag from the merchant account context.', when: 'At instrumentation time.', where: 'APM spans for payment processing services.', exampleValues: ['merchant-4471', 'submerchant-acme-01'] },
    ],
    optional: [],
    complianceTags: [
      { key: 'pci_scope', standard: 'PCI DSS', note: 'Mandatory for all payment card processing systems.' },
    ],
  },
  {
    id: 'payments-banking',
    name: 'Payments — Banking & Card Issuing',
    category: 'industry',
    sector: 'Payments',
    description: 'For banks, credit unions, and issuer processors issuing cards and holding customer accounts.',
    icon: '🏦',
    detectSignals: ['bin_range', 'issuing_processor', 'account_type', 'card_program'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'pci_scope', description: 'PCI scope indicator', why: 'Mandatory for any system storing, processing, or transmitting cardholder data at issuance.', how: 'Apply pci_scope:in-scope to all systems in the card issuance and account management path. Review with QSA annually.', when: 'At provisioning.', where: 'Card management systems, ledger hosts, database instances.', exampleValues: ['in-scope', 'out-of-scope', 'cde'] },
      { key: 'account_type', description: 'Deposit or card account type', why: 'Checking, savings, credit, and prepaid accounts have different regulatory (Reg E/Reg Z) and SLO requirements.', how: 'Inject as a span tag in account-servicing APIs.', when: 'At instrumentation time.', where: 'APM spans for account services, ledger systems.', exampleValues: ['checking', 'savings', 'credit', 'prepaid'] },
      { key: 'card_program', description: 'Card program or BIN sponsor identifier', why: 'Multi-BIN issuers need per-program performance and fraud dashboards — one degraded program should not page for all of them.', how: 'Inject card_program as a span tag from the card management system.', when: 'At program launch.', where: 'APM spans for card issuance and authorization services.', exampleValues: ['program-consumer-credit', 'program-fleet-debit'] },
    ],
    recommended: [
      { key: 'bin_range', description: 'Bank Identification Number (BIN) range', why: 'BIN-level monitoring isolates authorization issues to a specific card range rather than the whole issuing platform.', how: 'Inject bin_range as a span tag in authorization and issuing services.', when: 'At instrumentation time.', where: 'APM spans for authorization services.', exampleValues: ['4-4xxxxx', '5-5xxxxx'] },
      { key: 'issuing_processor', description: 'Third-party issuer processor name', why: 'Enables attribution of authorization latency to a specific processor and alerts when a processor degrades.', how: 'Inject as a span tag when calling the issuer processor API.', when: 'At instrumentation time.', where: 'APM spans for processor integrations.', exampleValues: ['marqeta', 'galileo', 'fis', 'tsys'] },
      { key: 'ledger_system', description: 'Core banking ledger system flag', why: 'The ledger is the system of record for balances — it requires the strictest consistency SLOs of any service in the stack.', how: 'Tag all ledger and core-banking hosts/services. Set tier:0 alongside.', when: 'At service onboarding.', where: 'APM services, hosts running the core banking ledger.', exampleValues: ['yes', 'no'] },
      { key: 'currency', description: 'Account or transaction currency', why: 'Multi-currency account platforms have distinct FX and settlement dependencies per currency — a degraded FX provider only affects some currencies, not all traffic.', how: 'Inject currency as a span tag from the account/transaction context.', when: 'At instrumentation time.', where: 'APM spans for account-servicing and ledger services.', exampleValues: ['usd', 'eur', 'gbp'] },
      { key: 'core_banking_module', description: 'Core banking platform module', why: 'Core banking suites (deposits, lending, cards) are usually separate modules with independent release cycles — module-level tagging isolates one module\'s incident from the whole platform.', how: 'Tag hosts and services by the core banking module they belong to.', when: 'At service onboarding.', where: 'APM services, hosts for core banking modules.', exampleValues: ['deposits', 'lending', 'cards', 'payments'] },
    ],
    optional: [
      { key: 'fraud_scope', description: 'Fraud/AML monitoring system flag', why: 'Fraud and AML services require separate performance baselines and cannot share alert thresholds with normal transaction flow.', how: 'Tag all fraud and AML-path services and hosts.', when: 'At service onboarding.', where: 'APM services, hosts in the fraud/AML path.', exampleValues: ['yes', 'no'] },
    ],
    complianceTags: [
      { key: 'pci_scope', standard: 'PCI DSS', note: 'Required for card issuance and account data environments.' },
      { key: 'data_classification', standard: 'GLBA', note: 'Gramm-Leach-Bliley Act requires safeguarding nonpublic personal financial information.' },
    ],
  },
  {
    id: 'payments-restaurants',
    name: 'Payments — Restaurant & Hospitality Merchants',
    category: 'industry',
    sector: 'Payments',
    description: 'For restaurant POS platforms, hospitality merchants, and payment acceptance at the table or counter.',
    icon: '🍽️',
    detectSignals: ['pos_terminal_type', 'location_id', 'order_channel', 'tip_processing'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'pci_scope', description: 'PCI scope indicator', why: 'Mandatory for any POS system that accepts card payments at the table or counter.', how: 'Apply pci_scope:in-scope to POS terminals, payment gateways, and any system touching card data.', when: 'At provisioning.', where: 'POS terminals, payment gateway hosts, kiosk hosts.', exampleValues: ['in-scope', 'out-of-scope'] },
      { key: 'location_id', description: 'Restaurant or venue location identifier', why: 'Multi-location merchants need per-location uptime and transaction dashboards — a single POS outage should be scoped to one venue, not treated as systemic.', how: 'Add location_id:<code> to all POS terminals and edge hosts at that venue.', when: 'At venue onboarding.', where: 'POS terminals, edge hosts, kiosk hosts.', exampleValues: ['loc-nyc-042', 'loc-chi-shop-a'] },
      { key: 'pos_terminal_type', description: 'POS terminal or acceptance device type', why: 'Countertop terminals, tableside handhelds, and self-service kiosks have different failure modes and network dependencies.', how: 'Tag each terminal by device type from the POS fleet management system.', when: 'At terminal provisioning.', where: 'POS terminal hosts/agents.', exampleValues: ['countertop', 'handheld', 'kiosk', 'kitchen-display'] },
    ],
    recommended: [
      { key: 'order_channel', description: 'Order channel (dine-in, delivery, online, drive-thru)', why: 'Different channels route through different systems (POS vs. third-party delivery integration) with different latency and reliability expectations.', how: 'Inject order_channel as a span tag at the order-ingestion service.', when: 'At instrumentation time.', where: 'APM spans for order and payment services.', exampleValues: ['dine-in', 'delivery', 'online', 'drive-thru'] },
      { key: 'tip_processing', description: 'Tip/gratuity processing flag', why: 'Tip adjustment is a distinct payment flow (auth then later capture) that fails differently than a standard sale — worth isolating in dashboards.', how: 'Tag payment services that handle tip adjustment or pre-auth capture.', when: 'At service onboarding.', where: 'APM services for payment/tip processing.', exampleValues: ['yes', 'no'] },
      { key: 'pos_vendor', description: 'POS software/hardware vendor', why: 'Multi-vendor estates (common after M&A or franchise rollups) need per-vendor reliability comparison.', how: 'Tag terminals and integration services with the POS vendor name.', when: 'At terminal/integration onboarding.', where: 'POS terminal hosts, APM services for POS integrations.', exampleValues: ['toast', 'square', 'clover', 'micros'] },
      { key: 'region', description: 'Operating region for the merchant estate', why: 'Multi-region chains have region-specific network providers and peak-hour patterns — a regional ISP outage looks like a systemic incident without this tag.', how: 'Set region based on the venue\'s operational territory.', when: 'At venue onboarding.', where: 'POS terminals, edge hosts.', exampleValues: ['us-northeast', 'us-west', 'uk'] },
      { key: 'daypart', description: 'Meal daypart (breakfast, lunch, dinner, late-night)', why: 'Order volume and kitchen-display latency requirements shift dramatically by daypart — flat SLOs across all dayparts either over-alert at 3am or under-alert at lunch rush.', how: 'Derive daypart from local venue time at order-ingestion time and inject as a span tag.', when: 'At instrumentation time.', where: 'APM spans for order and kitchen-display services.', exampleValues: ['breakfast', 'lunch', 'dinner', 'late-night'] },
    ],
    optional: [
      { key: 'franchise_id', description: 'Franchise owner/operator identifier', why: 'Franchise-model chains need to distinguish corporate-owned from franchisee-owned locations for support prioritization.', how: 'Add franchise_id to all resources for a given franchisee\'s locations.', when: 'At franchise onboarding.', where: 'POS terminals, location-level resources.', exampleValues: ['franchise-042', 'corporate'] },
    ],
    complianceTags: [
      { key: 'pci_scope', standard: 'PCI DSS', note: 'Required for all card-present POS and kiosk payment acceptance.' },
    ],
  },
  {
    id: 'payments-ecommerce-merchants',
    name: 'Payments — E-commerce & Retail Merchants',
    category: 'industry',
    sector: 'Payments',
    description: 'For online retailers and marketplaces accepting card, wallet, and BNPL payments at checkout.',
    icon: '🛍️',
    detectSignals: ['merchant_category_code', 'checkout_flow', 'payment_method', 'gateway_provider'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'pci_scope', description: 'PCI scope indicator', why: 'Mandatory for any checkout flow that touches card data, even when tokenized/hosted fields are used.', how: 'Apply pci_scope:in-scope to checkout services and any host handling card tokens.', when: 'At provisioning.', where: 'Checkout services, gateway integration hosts.', exampleValues: ['in-scope', 'out-of-scope', 'saqa'] },
      { key: 'merchant_category_code', description: 'Merchant Category Code (MCC)', why: 'MCC drives interchange rates and network risk rules — misclassification causes billing disputes and network fines.', how: 'Set from your payment processor merchant profile, one per storefront/brand.', when: 'At merchant onboarding.', where: 'Checkout services, settlement reporting.', exampleValues: ['5411', '5812', '5734'] },
      { key: 'checkout_flow', description: 'Checkout flow or funnel variant', why: 'A/B-tested checkout flows (one-page vs. multi-step, guest vs. account) have different conversion and error-rate baselines.', how: 'Set as a RUM view/APM span tag at checkout entry.', when: 'At instrumentation time.', where: 'RUM sessions, APM spans for checkout services.', exampleValues: ['one-page', 'multi-step', 'guest', 'express'] },
    ],
    recommended: [
      { key: 'payment_method', description: 'Payment method used at checkout', why: 'Card, digital wallet, and BNPL each have distinct auth success rates and latency — blending them hides which one is actually degrading.', how: 'Inject payment_method as a span tag from the payment gateway response.', when: 'At instrumentation time.', where: 'APM spans for payment processing.', exampleValues: ['card', 'apple-pay', 'paypal', 'bnpl', 'ach'] },
      { key: 'gateway_provider', description: 'Payment gateway or PSP name', why: 'Enables attribution of checkout latency/errors to a specific gateway and alerts when a gateway degrades.', how: 'Inject as a span tag when calling the gateway API.', when: 'At instrumentation time.', where: 'APM spans for gateway integrations.', exampleValues: ['stripe', 'adyen', 'braintree', 'shopify-payments'] },
      { key: 'chargeback_risk_tier', description: 'Chargeback/fraud risk tier for the transaction', why: 'High-risk-tier transactions route through extra fraud checks — separating them from low-risk avoids skewing latency SLOs.', how: 'Inject from the fraud-scoring service response as a span tag.', when: 'At instrumentation time.', where: 'APM spans for fraud-scoring and checkout services.', exampleValues: ['low', 'medium', 'high'] },
      { key: 'currency', description: 'Checkout currency', why: 'Cross-border storefronts settle in multiple currencies with different FX and PSP-routing paths — a single-currency PSP outage should not read as a global checkout outage.', how: 'Inject currency as a span tag from the checkout session context.', when: 'At instrumentation time.', where: 'APM spans, RUM sessions for checkout.', exampleValues: ['usd', 'eur', 'gbp'] },
      { key: 'fulfillment_type', description: 'Order fulfillment method', why: 'Ship-to-home, buy-online-pickup-in-store, and marketplace-fulfilled orders hit different downstream systems with different SLAs — blending them hides which fulfillment path is actually degraded.', how: 'Inject fulfillment_type as a span tag from the order-management service at checkout completion.', when: 'At instrumentation time.', where: 'APM spans for order-management services.', exampleValues: ['ship-to-home', 'bopis', 'marketplace-fulfilled'] },
    ],
    optional: [
      { key: 'subscription_flag', description: 'Recurring/subscription billing flag', why: 'Recurring charges (card-on-file, no CVV) have different decline patterns than first-time checkout — worth a separate dashboard.', how: 'Tag subscription-billing services and their spans.', when: 'At service onboarding.', where: 'APM services/spans for recurring billing.', exampleValues: ['yes', 'no'] },
    ],
    complianceTags: [
      { key: 'pci_scope', standard: 'PCI DSS', note: 'Required for all checkout flows accepting card data, including tokenized/hosted-field implementations (reduced SAQ scope still applies).' },
    ],
  },
  {
    id: 'payments-card-networks',
    name: 'Payments — Card Networks & Issuer Processors',
    category: 'industry',
    sector: 'Payments',
    description: 'For card network operators and issuer/acquirer processors routing and clearing transactions between banks.',
    icon: '💳',
    detectSignals: ['network_scheme', 'interchange_scope', 'settlement_cycle', 'dispute_stage'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'pci_scope', description: 'PCI scope indicator', why: 'Network and processor infrastructure sits directly in the cardholder data environment for every transaction it routes.', how: 'Apply pci_scope:in-scope to all routing, clearing, and settlement systems.', when: 'At provisioning.', where: 'Routing hosts, clearing/settlement services.', exampleValues: ['in-scope', 'cde'] },
      { key: 'network_scheme', description: 'Card network/scheme', why: 'Each scheme (Visa, Mastercard, Amex, Discover, domestic schemes) has distinct message formats and mandate deadlines — routing issues are almost always scheme-specific.', how: 'Inject network_scheme as a span tag at the routing/switch layer.', when: 'At instrumentation time.', where: 'APM spans for transaction routing services.', exampleValues: ['visa', 'mastercard', 'amex', 'discover', 'unionpay'] },
      { key: 'interchange_scope', description: 'Interchange/settlement leg the system participates in', why: 'Authorization, clearing, and settlement are separate legs with separate SLAs — a slowdown in one must not be conflated with the others.', how: 'Tag services by which leg of the transaction lifecycle they process.', when: 'At service onboarding.', where: 'APM services for routing, clearing, and settlement.', exampleValues: ['authorization', 'clearing', 'settlement'] },
    ],
    recommended: [
      { key: 'settlement_cycle', description: 'Settlement batch/cycle identifier', why: 'Batch-level monitoring lets ops isolate a failed settlement run to a specific cycle instead of the whole settlement pipeline.', how: 'Inject settlement_cycle as a span tag in batch-settlement jobs.', when: 'At instrumentation time.', where: 'APM spans for settlement batch jobs.', exampleValues: ['t1', 'eod-batch-042'] },
      { key: 'dispute_stage', description: 'Chargeback/dispute lifecycle stage', why: 'Dispute processing has regulatory response-time deadlines per stage — stage-level SLOs catch deadline risk before a fine is triggered.', how: 'Inject dispute_stage as a span tag in the dispute-management service.', when: 'At instrumentation time.', where: 'APM spans for dispute/chargeback services.', exampleValues: ['first-chargeback', 'representment', 'pre-arbitration', 'arbitration'] },
      { key: 'region', description: 'Network processing region', why: 'Network routing infrastructure is regionally deployed for latency and regulatory reasons — a region-scoped incident should not be treated as a global network outage.', how: 'Tag routing and switch infrastructure by the region it serves.', when: 'At infrastructure provisioning.', where: 'Hosts and APM services for routing/switch infrastructure.', exampleValues: ['us', 'eu', 'apac'] },
      { key: 'acquirer_bin', description: 'Acquirer or issuer BIN routed through this transaction', why: 'A single misbehaving acquirer or issuer connection can look like a network-wide slowdown unless routing latency is broken out by counterparty BIN.', how: 'Inject acquirer_bin as a span tag from the routing/switch layer.', when: 'At instrumentation time.', where: 'APM spans for transaction routing services.', exampleValues: ['bin-411111', 'bin-555555'] },
    ],
    optional: [
      { key: 'tokenization_scope', description: 'Network tokenization service flag', why: 'Tokenization (e.g. Visa Token Service) is a distinct security-critical path with its own uptime mandate from the network.', how: 'Tag all tokenization vault and provisioning services.', when: 'At service onboarding.', where: 'APM services for tokenization.', exampleValues: ['yes', 'no'] },
    ],
    complianceTags: [
      { key: 'pci_scope', standard: 'PCI DSS', note: 'Required for all network/processor infrastructure in the cardholder data environment.' },
      { key: 'network_scheme', standard: 'Network Mandates', note: 'Visa/Mastercard/Amex each publish binding technical and security mandates with compliance deadlines — track by scheme.' },
    ],
  },

  // ─ Healthcare ─────────────────────────────────────────────────────────────
  {
    id: 'healthcare',
    name: 'Healthcare / Life Sciences',
    category: 'industry',
    sector: 'Healthcare & Life Sciences',
    description: 'For healthcare organizations with PHI protection and HIPAA compliance requirements.',
    icon: '🏥',
    detectSignals: ['hipaa_scope', 'phi_flag', 'clinical_system', 'data_sensitivity'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'hipaa_scope', description: 'HIPAA scope (phi-in-scope, phi-out-of-scope)', why: 'HIPAA mandates identification of covered components. All PHI-touching systems must be in scope.', how: 'Apply hipaa_scope:phi-in-scope to all resources that store, process, or transmit PHI. Review with your Privacy Officer.', when: 'At provisioning. Review annually with HIPAA compliance team.', where: 'Hosts, database instances, APM services, cloud storage handling PHI.', exampleValues: ['phi-in-scope', 'phi-out-of-scope'] },
      { key: 'data_sensitivity', description: 'PHI sensitivity level (phi, de-identified, public)', why: 'Distinguishes PHI from de-identified data — different retention, access, and audit requirements apply.', how: 'Apply based on data classification policy aligned to the HIPAA Privacy Rule.', when: 'At data store provisioning.', where: 'Database instances (DBM), hosts, APM services.', exampleValues: ['phi', 'de-identified', 'public'] },
    ],
    recommended: [
      { key: 'clinical_system', description: 'Clinical system flag (yes/no)', why: 'Clinical systems (EHR, CPOE, clinical decision support) require highest availability SLOs — patient safety depends on them.', how: 'Tag all clinical systems and set tier:0 alongside.', when: 'At service onboarding.', where: 'APM services, hosts, monitors.', exampleValues: ['yes', 'no'] },
      { key: 'facility_id', description: 'Healthcare facility or hospital identifier', why: 'Multi-facility health systems need to isolate incidents to specific facilities.', how: 'Add facility_id:<code> to all resources specific to a facility.', when: 'At provisioning.', where: 'Hosts, database instances, monitoring resources.', exampleValues: ['hosp-nyc-01', 'clinic-la-west'] },
      { key: 'ehr_system', description: 'Electronic Health Record system integration', why: 'Most incidents in health IT trace back to a specific EHR integration (Epic, Cerner, etc.) — system-level tagging isolates one integration\'s outage from platform-wide health.', how: 'Tag interface engines and integration services by the EHR system they connect to.', when: 'At integration onboarding.', where: 'APM services and hosts for EHR interface/integration engines.', exampleValues: ['epic', 'cerner', 'meditech', 'allscripts'] },
      { key: 'encounter_type', description: 'Clinical encounter type', why: 'Inpatient, outpatient, and emergency encounters have very different volume patterns and latency tolerances — an ED-specific slowdown looks like noise in an all-encounters view.', how: 'Inject encounter_type as a span tag from the encounter/ADT feed.', when: 'At instrumentation time.', where: 'APM spans for clinical and ADT services.', exampleValues: ['inpatient', 'outpatient', 'emergency', 'telehealth'] },
    ],
    optional: [
      { key: 'device_type', description: 'Medical device type for IoMT integrations', why: 'Medical devices (infusion pumps, patient monitors) need separate monitoring dashboards and alert thresholds.', how: 'Tag IoMT integration hosts with device_type.', when: 'At IoMT device onboarding.', where: 'Hosts running IoMT integrations, NDM for networked medical devices.', exampleValues: ['infusion-pump', 'patient-monitor', 'imaging'] },
    ],
    complianceTags: [
      { key: 'hipaa_scope', standard: 'HIPAA', note: 'Required for covered entity compliance. All PHI-touching components must be identified.' },
      { key: 'data_sensitivity', standard: 'HIPAA Privacy Rule', note: 'Distinguishes protected vs de-identified data — different controls apply.' },
    ],
  },

  // ─ Retail / E-commerce ───────────────────────────────────────────────────
  {
    id: 'retail',
    name: 'Retail & E-commerce',
    category: 'industry',
    sector: 'Retail & Consumer',
    description: 'For retail and e-commerce platforms focused on peak traffic, conversions, and customer journeys.',
    icon: '🛒',
    detectSignals: ['storefront', 'channel', 'campaign_id', 'customer_segment'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'application', description: 'Business application (storefront, checkout, payments)', why: 'Enables application-level reliability scoring and peak-traffic planning per business function.', how: 'Add to all services and hosts. Align with your e-commerce platform taxonomy.', when: 'At service onboarding.', where: 'All resources.', exampleValues: ['storefront', 'checkout', 'order-management'] },
      { key: 'region', description: 'Geographic region (us-east, eu, apac)', why: 'CDN and fulfillment performance varies by region. Required for regional SLO reporting and Black Friday capacity planning.', how: 'Set from cloud provider region or add manually. Ensure cloud tag syncs to Datadog.', when: 'At provisioning.', where: 'Hosts, CDN nodes, synthetics tests.', exampleValues: ['us-east', 'eu-west', 'apac'] },
    ],
    recommended: [
      { key: 'storefront', description: 'Storefront or brand identifier', why: 'Multi-brand retailers need per-storefront reliability and conversion dashboards.', how: 'Add storefront:<name> to all resources serving a specific storefront.', when: 'At service deployment.', where: 'APM services, hosts, synthetics tests, monitors.', exampleValues: ['brand-a', 'brand-b', 'marketplace'] },
      { key: 'channel', description: 'Sales channel (web, mobile, pos, api)', why: 'Different channels have different performance baselines and user expectations. Mobile users churn faster on latency.', how: 'Inject as a span tag in APM for each channel entry point. Set in RUM initialization.', when: 'At instrumentation time.', where: 'APM traces, RUM sessions, synthetics.', exampleValues: ['web', 'mobile', 'pos', 'api'] },
      { key: 'journey', description: 'User journey (checkout, search, pdp, cart)', why: 'Journey-level SLOs directly tie to conversion rates and revenue. A degraded checkout journey costs money in real time.', how: 'Set as a RUM view name and APM span tag at each journey entry point.', when: 'At RUM and APM instrumentation time.', where: 'RUM sessions, APM spans for user-facing services.', exampleValues: ['checkout', 'search', 'product-detail', 'cart', 'registration'] },
      { key: 'fulfillment_center', description: 'Warehouse or fulfillment center identifier', why: 'Order-processing latency and inventory-sync issues are frequently isolated to one fulfillment center — center-level tagging catches a single site\'s WMS degradation before it\'s misread as a platform-wide issue.', how: 'Inject fulfillment_center as a span tag from the order-management/WMS integration.', when: 'At instrumentation time.', where: 'APM spans for order-management and WMS integration services.', exampleValues: ['fc-nj-01', 'fc-tx-03'] },
      { key: 'product_category', description: 'Merchandise category', why: 'Search relevance and inventory-check latency vary by category (e.g. grocery vs. apparel) — category-blind dashboards average away category-specific regressions.', how: 'Inject product_category as a span tag from the catalog service in search and PDP request handlers.', when: 'At instrumentation time.', where: 'APM spans for search, catalog, and PDP services.', exampleValues: ['apparel', 'electronics', 'grocery', 'home'] },
    ],
    optional: [
      { key: 'campaign_id', description: 'Active marketing campaign identifier', why: 'Correlates traffic spikes from campaigns with infrastructure load and conversion rates.', how: 'Inject campaign_id as a span tag from UTM parameters at the API gateway layer.', when: 'During active marketing campaigns.', where: 'APM spans, RUM sessions.', exampleValues: ['black-friday-24', 'summer-sale'] },
      { key: 'customer_segment', description: 'Customer segment (b2c, b2b, vip)', why: 'High-value customer segments may require dedicated infrastructure and stricter SLOs.', how: 'Inject from the authentication/authorization context as a span tag.', when: 'At instrumentation time.', where: 'APM traces for customer-facing services.', exampleValues: ['b2c', 'b2b', 'vip', 'wholesale'] },
    ],
  },

  // ─ Transportation & Logistics ─────────────────────────────────────────────
  {
    id: 'transportation',
    name: 'Transportation & Logistics',
    category: 'industry',
    sector: 'Transportation & Logistics',
    description: 'For fleet management, route optimization, and logistics platforms.',
    icon: '🚚',
    detectSignals: ['fleet_id', 'route_id', 'depot', 'vehicle_type'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'region', description: 'Operating region or coverage area', why: 'Route performance and SLAs vary by region. Enables regional operations dashboards.', how: 'Set from cloud region or add manually based on operational territory.', when: 'At provisioning.', where: 'Hosts, monitoring resources.', exampleValues: ['us-northeast', 'eu-central', 'apac-south'] },
      { key: 'application', description: 'Logistics application (dispatch, tracking, routing)', why: 'Groups services by operational function for incident response.', how: 'Add application tag to all services. Align with operational domain taxonomy.', when: 'At service onboarding.', where: 'All resources.', exampleValues: ['dispatch', 'route-optimization', 'last-mile', 'tracking'] },
    ],
    recommended: [
      { key: 'fleet_id', description: 'Fleet or vehicle group identifier', why: 'Enables per-fleet performance monitoring and anomaly detection for vehicle telematics.', how: 'Inject fleet_id from the fleet management system into APM spans and host tags for edge devices.', when: 'At fleet device onboarding.', where: 'Edge hosts, APM services for fleet management, NDM for fleet network devices.', exampleValues: ['fleet-trucks-northeast', 'fleet-vans-eu'] },
      { key: 'route_id', description: 'Route or corridor identifier', why: 'Route-level SLOs enable proactive intervention when a specific route degrades. Required for on-time delivery reporting.', how: 'Inject route_id as a span tag from the routing service.', when: 'At instrumentation time in routing and dispatch services.', where: 'APM spans.', exampleValues: ['route-nyc-bos', 'route-43'] },
      { key: 'datacenter', description: 'Data center or edge location', why: 'Logistics has edge computing at depots. Monitoring must distinguish central vs. edge performance.', how: 'Add datacenter:<location> to edge hosts in depot agent config.', when: 'At edge device provisioning.', where: 'Hosts, NDM for depot network devices.', exampleValues: ['nyc-depot', 'la-hub', 'eu-dc'] },
      { key: 'mode_of_transport', description: 'Transport mode', why: 'Air, ocean, rail, and road legs have completely different tracking-update cadences and SLA definitions — mixing them into one on-time-delivery metric is meaningless.', how: 'Inject mode_of_transport as a span tag from the shipment record at each leg.', when: 'At instrumentation time.', where: 'APM spans for tracking and routing services.', exampleValues: ['air', 'ocean', 'rail', 'road'] },
      { key: 'carrier_partner', description: 'Third-party carrier used for this leg', why: 'A single underperforming partner carrier\'s API or tracking feed can look like a systemic tracking outage unless broken out by carrier.', how: 'Inject carrier_partner as a span tag when calling the carrier\'s tracking/booking API.', when: 'At instrumentation time.', where: 'APM spans for carrier integration services.', exampleValues: ['fedex', 'ups', 'maersk', 'dhl'] },
    ],
    optional: [
      { key: 'compliance_scope', description: 'Regulatory scope (DOT, FMCSA, ISO)', why: 'Transportation is heavily regulated. Tagging enables automated compliance dashboards.', how: 'Apply compliance_scope to hosts and services in regulated operational paths.', when: 'At service onboarding for regulated systems.', where: 'Hosts, APM services, database instances.', exampleValues: ['dot', 'fmcsa', 'iso-28001'] },
      { key: 'depot', description: 'Depot, terminal, or warehouse location', why: 'Depot-level monitoring enables identification of site-specific outages vs. systemic issues.', how: 'Add depot:<code> to all edge hosts and network devices at that location.', when: 'At depot equipment provisioning.', where: 'Hosts, NDM, edge devices.', exampleValues: ['depot-nyc-01', 'warehouse-la-03'] },
    ],
  },

  // ─ Media / Streaming / Gaming ────────────────────────────────────────────
  {
    id: 'media',
    name: 'Media / Streaming / Gaming',
    category: 'industry',
    sector: 'Media & Entertainment',
    description: 'For media companies, streaming platforms, and game publishers.',
    icon: '🎮',
    detectSignals: ['content_type', 'game_title', 'stream_region', 'user_segment'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'region', description: 'Streaming region or CDN PoP', why: 'Streaming quality and latency are geography-dependent. Regional SLOs require regional tags.', how: 'Auto-populated by cloud provider or set manually for CDN PoP nodes.', when: 'At provisioning.', where: 'Hosts, CDN nodes, synthetics.', exampleValues: ['us-east', 'eu-west', 'apac'] },
      { key: 'application', description: 'Platform or product (live-streaming, vod, gaming)', why: 'Different product lines have different QoS requirements and business models.', how: 'Add application tag to all services for a product. Align with the product taxonomy.', when: 'At service onboarding.', where: 'All resources.', exampleValues: ['live-streaming', 'vod', 'battle-royale', 'sports'] },
    ],
    recommended: [
      { key: 'content_type', description: 'Content type (live, vod, interactive)', why: 'Live content has much stricter latency requirements than on-demand. Separate SLOs and alert thresholds required.', how: 'Inject as a span tag in CDN and origin services.', when: 'At instrumentation time.', where: 'APM spans, CDN nodes, monitors.', exampleValues: ['live', 'vod', 'podcast', 'interactive'] },
      { key: 'user_segment', description: 'User segment (free, premium, enterprise)', why: 'Premium users expect higher QoS. Enables per-segment SLOs and priority incident response.', how: 'Inject from auth context as a span tag in user-facing services.', when: 'At instrumentation time.', where: 'APM traces, RUM sessions.', exampleValues: ['free', 'premium', 'enterprise'] },
      { key: 'platform', description: 'Client platform (web, mobile, console, smart-tv)', why: 'Performance profiles differ drastically by platform. Console users expect sub-100ms latency for real-time gaming.', how: 'Inject from the client SDK or API gateway based on User-Agent or platform parameter.', when: 'At instrumentation time.', where: 'APM spans, RUM, synthetics.', exampleValues: ['web', 'ios', 'android', 'ps5', 'xbox', 'smart-tv'] },
      { key: 'cdn_provider', description: 'CDN or edge delivery provider', why: 'Multi-CDN streaming setups fail over between providers — without this tag, a degraded CDN\'s buffering/error spike is invisible until the whole platform looks unstable.', how: 'Inject cdn_provider as a span tag from the edge/origin response headers.', when: 'At instrumentation time.', where: 'APM spans, RUM sessions for streaming delivery.', exampleValues: ['cloudfront', 'akamai', 'fastly', 'cloudflare'] },
      { key: 'drm_provider', description: 'DRM/license provider for protected content', why: 'License-acquisition failures are a top cause of playback-start failures and are provider-specific — without this tag they\'re indistinguishable from generic playback errors.', how: 'Inject drm_provider as a span tag from the license-server integration.', when: 'At instrumentation time.', where: 'APM spans for license/DRM services.', exampleValues: ['widevine', 'fairplay', 'playready'] },
    ],
    optional: [
      { key: 'game_title', description: 'Game or content title identifier', why: 'Per-title performance dashboards enable targeted optimization during launches.', how: 'Add game_title as a span tag in game-server and matchmaking services.', when: 'At game launch or content onboarding.', where: 'APM spans, game server hosts.', exampleValues: ['title-alpha', 'battle-royale-2025'] },
    ],
  },

  // ─ Telecommunications ─────────────────────────────────────────────────────
  {
    id: 'telecom',
    name: 'Telecommunications',
    category: 'industry',
    sector: 'Telecommunications',
    description: 'For carriers, ISPs, and network service providers.',
    icon: '📡',
    detectSignals: ['network_type', 'carrier', 'node_id', 'service_type'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'region', description: 'Network region or coverage area', why: 'Telecoms operate regional network infrastructure. Incidents are geographically scoped.', how: 'Set based on physical or logical network region. Use for NDM device grouping.', when: 'At device and host provisioning.', where: 'Hosts, NDM devices, monitors.', exampleValues: ['northeast', 'midwest', 'emea'] },
      { key: 'network_type', description: 'Network technology (5G, LTE, fiber, cable)', why: 'Different network technologies have different performance characteristics and troubleshooting procedures.', how: 'Add to SNMP device tags and host extra_tags for infrastructure supporting each technology.', when: 'At device provisioning.', where: 'NDM devices, hosts, monitors.', exampleValues: ['5g', 'lte', 'fiber', 'cable', 'dsl'] },
    ],
    recommended: [
      { key: 'node_id', description: 'Network node or tower identifier', why: 'Node-level monitoring enables targeted troubleshooting when a specific tower degrades.', how: 'Add node_id to SNMP device tags in NDM and to edge host extra_tags.', when: 'At network device provisioning.', where: 'NDM devices, edge hosts.', exampleValues: ['tower-nyc-001', 'node-chicago-42'] },
      { key: 'carrier', description: 'Carrier or partner network identifier', why: 'Peering and roaming issues originate from specific carrier interconnects. Required for SLA enforcement.', how: 'Tag network devices and services handling carrier interconnects.', when: 'At carrier integration provisioning.', where: 'NDM devices, APM services for carrier APIs.', exampleValues: ['at-t', 'verizon', 'tmobile'] },
      { key: 'service_type', description: 'Service type (voice, data, iot, tv)', why: 'Enables per-service-type dashboards and SLOs with appropriate thresholds (voice requires strict jitter/packet loss).', how: 'Add to hosts and network devices supporting each service type.', when: 'At provisioning.', where: 'Hosts, NDM devices, monitors.', exampleValues: ['voice', 'data', 'iot', 'tv'] },
      { key: 'spectrum_band', description: 'Radio spectrum band in use', why: 'Band-specific interference and capacity issues (e.g. a single mid-band 5G carrier) are invisible in aggregate network dashboards without this tag.', how: 'Add spectrum_band to SNMP device tags for radio access network equipment.', when: 'At RAN device provisioning.', where: 'NDM devices for radio access network equipment.', exampleValues: ['low-band', 'mid-band', 'mmwave'] },
      { key: 'subscriber_plan', description: 'Subscriber plan tier', why: 'QoS policies and throttling rules differ by plan tier — plan-blind dashboards can\'t distinguish a genuine network fault from expected throttling behavior.', how: 'Inject subscriber_plan from the billing/policy system as a span tag on session-management services.', when: 'At instrumentation time.', where: 'APM spans for session and policy-control services.', exampleValues: ['prepaid', 'postpaid-standard', 'postpaid-unlimited'] },
    ],
    optional: [],
  },

  // ─ Energy / Utilities ────────────────────────────────────────────────────
  {
    id: 'energy',
    name: 'Energy & Utilities',
    category: 'industry',
    sector: 'Energy & Utilities',
    description: 'For energy producers, utilities, and grid operators.',
    icon: '⚡',
    detectSignals: ['grid_region', 'asset_id', 'plant', 'energy_type'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'region', description: 'Grid region or operational territory', why: 'Grid performance and reliability requirements are geographically bounded.', how: 'Set based on physical grid region. Sync with SCADA/EMS system metadata.', when: 'At asset provisioning.', where: 'Hosts, NDM devices, OT systems.', exampleValues: ['neiso', 'pjm', 'ercot'] },
      { key: 'plant', description: 'Power plant or facility identifier', why: 'Plant-level monitoring enables targeted response to local generation or transmission failures.', how: 'Add plant:<id> to all hosts and devices at the facility.', when: 'At facility onboarding.', where: 'Hosts, SCADA hosts, NDM devices at the facility.', exampleValues: ['solar-az-01', 'wind-tx-farm', 'gas-plant-oh'] },
    ],
    recommended: [
      { key: 'asset_id', description: 'Physical asset identifier (turbine, transformer, meter)', why: 'Asset-level telemetry enables predictive maintenance and regulatory reporting.', how: 'Tag hosts and network devices with the asset ID from your asset management system.', when: 'At asset onboarding.', where: 'SCADA hosts, NDM for OT networks, DBM for asset data.', exampleValues: ['turbine-001', 'transformer-tx-42', 'smart-meter-123'] },
      { key: 'energy_type', description: 'Energy source (solar, wind, gas, nuclear, hydro)', why: 'Different energy sources have different performance characteristics, monitoring cadences, and regulatory requirements.', how: 'Tag all resources at generation facilities by energy type.', when: 'At provisioning.', where: 'Hosts, NDM devices, monitors.', exampleValues: ['solar', 'wind', 'gas', 'nuclear', 'hydro'] },
      { key: 'compliance_scope', description: 'Regulatory scope (NERC-CIP, FERC)', why: 'NERC CIP requires identification and hardening of critical infrastructure assets. Without this tag, compliance automation is impossible.', how: 'Apply compliance_scope:nerc-cip to all BES Cyber Systems. Reviewed by NERC compliance team.', when: 'At asset provisioning for critical infrastructure.', where: 'All critical infrastructure hosts and OT devices.', exampleValues: ['nerc-cip', 'ferc', 'iso-27001'] },
      { key: 'grid_segment', description: 'Grid segment (generation, transmission, distribution)', why: 'Each segment has different SCADA/OT monitoring cadences and regulatory bodies — a transmission fault and a distribution fault require entirely different response playbooks.', how: 'Tag SCADA and OT hosts by which grid segment they monitor/control.', when: 'At asset provisioning.', where: 'SCADA hosts, NDM devices, OT systems.', exampleValues: ['generation', 'transmission', 'distribution'] },
      { key: 'meter_type', description: 'Smart meter or metering infrastructure type', why: 'AMI (advanced metering infrastructure) fleets are large and heterogeneous — meter-type-level tagging isolates a firmware/hardware-specific fault from a systemic AMI network issue.', how: 'Tag metering data collection hosts and NDM entries by meter type/model.', when: 'At meter fleet onboarding.', where: 'NDM for AMI networks, DBM for metering data.', exampleValues: ['smart-meter-gen2', 'smart-meter-gen3', 'legacy-amr'] },
    ],
    optional: [],
    complianceTags: [
      { key: 'compliance_scope', standard: 'NERC CIP', note: 'Required for Bulk Electric System Cyber System identification.' },
    ],
  },

  // ─ Manufacturing / Supply Chain ───────────────────────────────────────────
  {
    id: 'manufacturing',
    name: 'Manufacturing & Supply Chain',
    category: 'industry',
    sector: 'Manufacturing & Industrial',
    description: 'For manufacturers, industrial operations, and supply chain platforms.',
    icon: '🏭',
    detectSignals: ['plant', 'production_line', 'asset_id', 'quality_stage'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'plant', description: 'Manufacturing plant or facility', why: 'Plant-level monitoring enables site-specific incident response. OEE and downtime tracking require plant context.', how: 'Add plant:<code> to all hosts and OT systems at the facility.', when: 'At facility onboarding.', where: 'Hosts, OT systems, NDM devices at the plant.', exampleValues: ['plant-detroit-01', 'plant-frankfurt-02'] },
      { key: 'region', description: 'Geographic region', why: 'Supply chain disruptions are regionally correlated. Regional view required for risk management.', how: 'Set from cloud region or physical location for on-premises systems.', when: 'At provisioning.', where: 'All resources.', exampleValues: ['us-midwest', 'eu-central', 'apac'] },
    ],
    recommended: [
      { key: 'production_line', description: 'Production line or assembly line identifier', why: 'Line-level monitoring enables detection of line-specific bottlenecks and quality issues.', how: 'Tag edge hosts and OT systems at each production line.', when: 'At line instrumentation.', where: 'Edge hosts, OT systems, SCADA hosts.', exampleValues: ['line-a-01', 'assembly-final'] },
      { key: 'asset_id', description: 'Manufacturing equipment identifier', why: 'Asset-level telemetry enables predictive maintenance and OEE tracking.', how: 'Tag hosts interfacing with equipment using the asset ID from ERP/MES.', when: 'At equipment onboarding.', where: 'Edge hosts, OT system hosts.', exampleValues: ['cnc-001', 'robot-arm-42', 'press-07'] },
      { key: 'quality_stage', description: 'Quality control stage (incoming, in-process, final)', why: 'Correlates system performance with quality outcomes at each production stage.', how: 'Tag systems at each QC stage of the production process.', when: 'At system provisioning.', where: 'Hosts and APM services for QC systems.', exampleValues: ['incoming', 'in-process', 'final', 'post-market'] },
      { key: 'shift', description: 'Production shift', why: 'Throughput, defect rates, and staffing-driven incidents vary by shift — shift-blind dashboards hide patterns like a recurring night-shift bottleneck.', how: 'Tag edge hosts and OT systems with the current shift from the MES shift schedule.', when: 'At line instrumentation.', where: 'Edge hosts, OT systems, SCADA hosts.', exampleValues: ['shift-1', 'shift-2', 'shift-3'] },
      { key: 'work_order_id', description: 'Active work order or production run identifier', why: 'Ties system telemetry directly to a specific production run, so a quality or downtime event can be traced back to the exact order affected — critical for customer-facing root-cause reports.', how: 'Inject work_order_id as a span tag from the MES/ERP work order feed.', when: 'At instrumentation time.', where: 'APM spans for MES and production-line services.', exampleValues: ['wo-448821', 'wo-runbatch-07'] },
    ],
    optional: [
      { key: 'supplier', description: 'Supplier or vendor identifier', why: 'Enables correlation between supplier performance metrics and supply chain disruptions.', how: 'Tag supplier integration hosts and APIs with the supplier identifier.', when: 'At supplier integration onboarding.', where: 'APM services for supplier integrations, EDI hosts.', exampleValues: ['supplier-acme', 'vendor-xyz'] },
    ],
  },

  // ─ Government / Public Sector ─────────────────────────────────────────────
  {
    id: 'government',
    name: 'Government & Public Sector',
    category: 'industry',
    sector: 'Public Sector & Government',
    description: 'For government agencies, public sector organizations, and defense contractors.',
    icon: '🏛️',
    detectSignals: ['agency', 'classification_level', 'program', 'fedramp_scope'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'agency', description: 'Government agency or department identifier', why: 'Cross-agency deployments require agency-level isolation for data and operational security.', how: 'Add agency:<code> to all resources deployed for a specific agency.', when: 'At resource provisioning under an agency contract.', where: 'All resources.', exampleValues: ['dod', 'hhs', 'dhs', 'state-dept'] },
      { key: 'compliance_scope', description: 'Compliance scope (FedRAMP, IL2, IL4, IL5, IL6)', why: 'FedRAMP and DISA IL levels mandate specific controls. Without this tag, automated compliance auditing is impossible.', how: 'Apply based on the authorized Impact Level for the system. Review with the Information System Security Officer (ISSO).', when: 'At authorization to operate (ATO) and provisioning.', where: 'All resources in the authorization boundary.', exampleValues: ['fedramp-moderate', 'fedramp-high', 'il4', 'il5', 'il6'] },
    ],
    recommended: [
      { key: 'program', description: 'Government program or contract identifier', why: 'Enables program-level cost attribution and compliance reporting per contract.', how: 'Add program:<id> to all resources under a specific government program.', when: 'At contract onboarding.', where: 'All resources.', exampleValues: ['program-alpha', 'contract-gsa-001'] },
      { key: 'classification_level', description: 'Data classification (unclassified, cui, secret, top-secret)', why: 'Mandatory for data handling compliance. Systems must be tagged to ensure classified data does not flow to unclassified systems.', how: 'Apply based on the classification authority. Restrict to authorized personnel only.', when: 'At system authorization.', where: 'All resources in classified environments.', exampleValues: ['unclassified', 'cui', 'secret', 'top-secret'] },
      { key: 'contract_vehicle', description: 'Contract vehicle the resource is billed under', why: 'Agencies often run the same system under multiple contract vehicles (GSA schedules, IDIQs) simultaneously — vehicle-level tagging is required for accurate invoicing and DCAA-compliant cost accounting.', how: 'Add contract_vehicle:<id> to all resources billed under that vehicle.', when: 'At resource provisioning under the contract.', where: 'All resources.', exampleValues: ['gsa-schedule-70', 'idiq-alpha'] },
      { key: 'data_residency', description: 'Data residency/sovereignty requirement', why: 'Some agency data must remain within specific geographic or cloud-region boundaries (e.g. GovCloud) — this is an ATO condition, not a convenience.', how: 'Tag cloud resources and database instances with their approved data residency boundary.', when: 'At provisioning for systems with a residency requirement.', where: 'Database instances, cloud storage, hosts.', exampleValues: ['us-govcloud', 'conus-only'] },
    ],
    optional: [],
    complianceTags: [
      { key: 'compliance_scope', standard: 'FedRAMP/DISA', note: 'Required for all federal cloud deployments. Determines security controls that must be implemented.' },
    ],
  },

  // ─ SaaS / Software Platforms (already above as 'technology', keeping for completeness) ─

  // ─ Insurance ──────────────────────────────────────────────────────────────
  {
    id: 'insurance',
    name: 'Insurance',
    category: 'industry',
    sector: 'Insurance',
    description: 'For insurance carriers, brokers, and insurtech platforms.',
    icon: '🛡️',
    detectSignals: ['policy_type', 'claim_system', 'risk_category'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'data_classification', description: 'Data sensitivity (pii, financial, medical, public)', why: 'Insurance handles PII and sensitive financial data subject to state and federal regulations.', how: 'Apply based on data classification policy. Map to specific regulatory requirements.', when: 'At data store provisioning.', where: 'Database instances, hosts, APM services.', exampleValues: ['pii', 'financial', 'medical', 'public'] },
      { key: 'region', description: 'Regulatory jurisdiction region', why: 'Insurance is regulated state-by-state in the US. Regional tagging enables per-jurisdiction compliance reporting.', how: 'Set based on the state or country where the policy is written or claims are processed.', when: 'At provisioning.', where: 'Hosts, APM services for regulatory reporting.', exampleValues: ['us-ny', 'us-ca', 'uk', 'eu'] },
    ],
    recommended: [
      { key: 'policy_type', description: 'Insurance policy line (auto, home, life, commercial)', why: 'Different lines of business have different processing requirements and SLOs.', how: 'Inject as a span tag in policy processing and claims services.', when: 'At instrumentation time.', where: 'APM spans for policy and claims services.', exampleValues: ['auto', 'home', 'life', 'commercial', 'cyber'] },
      { key: 'claim_system', description: 'Claims management system flag', why: 'Claims systems have the highest availability requirements — delays in claims processing create regulatory risk.', how: 'Tag all hosts and services in the claims processing path. Set tier:0.', when: 'At service onboarding.', where: 'APM services, hosts, monitors.', exampleValues: ['yes', 'no'] },
      { key: 'underwriting_system', description: 'Underwriting/rating engine flag', why: 'Quote-latency SLOs are commercially sensitive — a slow rating engine directly loses bound business to competitors, so it needs its own dashboard separate from general policy admin.', how: 'Tag all hosts and services in the underwriting/rating path.', when: 'At service onboarding.', where: 'APM services, hosts for rating and underwriting.', exampleValues: ['yes', 'no'] },
      { key: 'broker_channel', description: 'Distribution channel for the policy', why: 'Direct, broker, and MGA-sourced business flow through different integration paths — a broken broker API integration looks like a general outage without this tag.', how: 'Inject broker_channel as a span tag from the policy/quoting service.', when: 'At instrumentation time.', where: 'APM spans for policy and quoting services.', exampleValues: ['direct', 'broker', 'mga', 'aggregator'] },
    ],
    optional: [
      { key: 'risk_category', description: 'Underwriting risk category', why: 'Enables correlation between system performance and underwriting outcomes.', how: 'Inject as a span tag in underwriting services.', when: 'At instrumentation time.', where: 'APM spans.', exampleValues: ['standard', 'preferred', 'high-risk'] },
    ],
  },

  // ─ Pharma / Biotech ───────────────────────────────────────────────────────
  {
    id: 'pharma',
    name: 'Pharma & Biotech',
    category: 'industry',
    sector: 'Healthcare & Life Sciences',
    description: 'For pharmaceutical companies, biotech firms, and clinical research organizations.',
    icon: '🧬',
    detectSignals: ['trial_id', 'regulatory_phase', 'lab', 'molecule'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'regulatory_phase', description: 'Drug development phase (pre-clinical, phase-1, phase-2, phase-3, commercial)', why: 'Different phases have different data integrity and audit requirements (21 CFR Part 11, GxP).', how: 'Apply regulatory_phase to all systems supporting each phase. Sync with QMS.', when: 'At system provisioning and phase transitions.', where: 'All resources in GxP environments.', exampleValues: ['pre-clinical', 'phase-1', 'phase-2', 'phase-3', 'commercial'] },
      { key: 'compliance_scope', description: 'Regulatory scope (GxP, 21-CFR-11, EMA)', why: 'GxP systems require validated software and audit trails. Without this tag, scoping is manual and error-prone.', how: 'Apply to all systems in the validated environment. Review with QA/Regulatory Affairs.', when: 'During system validation (IQ/OQ/PQ).', where: 'All validated systems, LIMS, EDC, manufacturing execution systems.', exampleValues: ['gxp', '21-cfr-11', 'ema', 'ich-e6'] },
    ],
    recommended: [
      { key: 'trial_id', description: 'Clinical trial protocol identifier', why: 'Trial-level monitoring enables per-protocol performance tracking and audit evidence collection.', how: 'Inject trial_id from the trial management system as a span tag in EDC and CTMS services.', when: 'When the trial system is provisioned.', where: 'APM spans, database instances for trial data.', exampleValues: ['NCT-12345678', 'protocol-2024-01'] },
      { key: 'lab', description: 'Laboratory or research site identifier', why: 'Multi-site trials require site-level monitoring to detect site-specific data quality issues.', how: 'Tag all laboratory information systems at each site.', when: 'At site activation.', where: 'LIMS hosts, database instances, APM services for lab operations.', exampleValues: ['lab-boston-01', 'cro-site-42'] },
      { key: 'batch_id', description: 'Manufacturing batch or lot number', why: 'GMP requires full batch traceability — tying system telemetry to a batch ID lets a data-integrity incident be scoped to the exact lot affected instead of the whole manufacturing line.', how: 'Inject batch_id as a span tag from the MES/batch-record system.', when: 'At instrumentation time.', where: 'APM spans, database instances for manufacturing execution systems.', exampleValues: ['batch-2025-0142', 'lot-a3391'] },
      { key: 'manufacturing_site', description: 'GMP manufacturing site identifier', why: 'Multi-site manufacturers need site-level isolation for both incident response and regulatory inspection readiness — an FDA 483 finding is scoped to a specific site, not the whole network.', how: 'Add manufacturing_site:<code> to all hosts and systems at that GMP site.', when: 'At site qualification.', where: 'MES hosts, LIMS, hosts at the manufacturing site.', exampleValues: ['site-puerto-rico-01', 'site-cork-02'] },
    ],
    optional: [
      { key: 'molecule', description: 'Drug molecule or compound identifier', why: 'Enables per-molecule data lineage tracking from discovery through commercialization.', how: 'Inject as a span tag in compound management and informatics services.', when: 'At compound registration.', where: 'APM spans for informatics services.', exampleValues: ['compound-abc-123', 'mrna-vaccine-01'] },
    ],
    complianceTags: [
      { key: 'compliance_scope', standard: 'GxP/21 CFR Part 11', note: 'Required for validated systems in regulated pharmaceutical environments.' },
    ],
  },

  // ─ Automotive / Mobility ──────────────────────────────────────────────────
  {
    id: 'automotive',
    name: 'Automotive & Mobility',
    category: 'industry',
    sector: 'Automotive & Mobility',
    description: 'For automotive OEMs, connected vehicle platforms, and mobility services.',
    icon: '🚗',
    detectSignals: ['vehicle_type', 'fleet_id', 'manufacturing_site'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'region', description: 'Market region', why: 'Automotive platforms serve different regions with different regulatory and connectivity requirements.', how: 'Tag based on the geographic market served.', when: 'At deployment.', where: 'All resources.', exampleValues: ['na', 'eu', 'china', 'apac'] },
      { key: 'application', description: 'Vehicle system or mobility platform', why: 'OTA updates, telematics, and infotainment systems have different safety and performance requirements.', how: 'Add application tag to all services. Safety-critical systems must also have tier:0.', when: 'At service onboarding.', where: 'All resources.', exampleValues: ['ota-platform', 'telematics', 'infotainment', 'charging'] },
    ],
    recommended: [
      { key: 'vehicle_type', description: 'Vehicle type or model family', why: 'Different vehicle types have different telematics payloads and connectivity profiles.', how: 'Inject from vehicle registration data in telematics ingestion services.', when: 'At instrumentation time.', where: 'APM services for telematics and OTA platforms.', exampleValues: ['ev', 'phev', 'ice', 'truck', 'two-wheeler'] },
      { key: 'fleet_id', description: 'Fleet or vehicle group identifier', why: 'Fleet-level monitoring enables targeted maintenance and connectivity issue resolution.', how: 'Tag from fleet management system metadata.', when: 'At fleet onboarding.', where: 'APM services, edge hosts in vehicles.', exampleValues: ['fleet-commercial', 'fleet-consumer'] },
      { key: 'software_platform', description: 'Vehicle software platform (vxworks, linux, android-auto)', why: 'Different vehicle software platforms have different update cadences and vulnerability profiles.', how: 'Tag OTA update services and telematics hosts by target platform.', when: 'At platform onboarding.', where: 'OTA hosts, telematics APM services.', exampleValues: ['android-auto', 'linux-embedded', 'qnx'] },
      { key: 'ota_campaign_id', description: 'Over-the-air update campaign identifier', why: 'A bad OTA rollout is one of the highest-blast-radius incidents in automotive — campaign-level tagging lets you halt and roll back a specific campaign instead of guessing which update caused a fleet-wide spike.', how: 'Inject ota_campaign_id as a span tag from the OTA orchestration service for the duration of the rollout.', when: 'At campaign launch.', where: 'APM spans for OTA orchestration services.', exampleValues: ['campaign-2025-q1-infotainment', 'campaign-safety-patch-04'] },
      { key: 'connectivity_type', description: 'Vehicle connectivity technology', why: 'Cellular, Wi-Fi, and satellite links have very different latency, packet-loss, and cost profiles — connectivity-blind telematics dashboards can\'t distinguish a network problem from an application problem.', how: 'Inject connectivity_type from the telematics control unit as a span tag.', when: 'At instrumentation time.', where: 'APM spans for telematics ingestion services.', exampleValues: ['4g', '5g', 'wifi', 'satellite'] },
    ],
    optional: [
      { key: 'manufacturing_site', description: 'Vehicle manufacturing plant', why: 'Correlates software deployment issues with specific manufacturing sites.', how: 'Tag manufacturing execution systems at each plant.', when: 'At plant system provisioning.', where: 'MES hosts, assembly line systems.', exampleValues: ['plant-detroit', 'plant-wolfsburg'] },
    ],
  },

  // ─ Aerospace / Defense ────────────────────────────────────────────────────
  {
    id: 'aerospace',
    name: 'Aerospace & Defense',
    category: 'industry',
    sector: 'Aerospace & Defense',
    description: 'For aerospace manufacturers, defense contractors, and mission systems.',
    icon: '🚀',
    detectSignals: ['classification_level', 'program', 'system_type'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'program', description: 'Defense program or contract', why: 'Cost accounting and security controls must be program-specific for DCAA and CMMI compliance.', how: 'Add program:<id> to all resources under the program. Align with contract management system.', when: 'At contract initiation and resource provisioning.', where: 'All resources under the program.', exampleValues: ['program-falcon', 'contract-dod-001'] },
      { key: 'compliance_scope', description: 'Compliance framework (CMMC, NIST-800-171, IL5)', why: 'CMMC Level 2/3 requires clear scoping of covered defense information systems.', how: 'Apply based on CMMC scoping assessment. Review with CISO and program security officer.', when: 'At system authorization.', where: 'All systems in the CMMC boundary.', exampleValues: ['cmmc-l2', 'cmmc-l3', 'nist-800-171', 'il5'] },
    ],
    recommended: [
      { key: 'classification_level', description: 'Information classification (unclassified, cui, secret)', why: 'Defense information has strict handling requirements based on classification. Tagging enables automated data flow controls.', how: 'Apply based on the classification authority. Access restricted to authorized personnel.', when: 'At system authorization.', where: 'All classified systems.', exampleValues: ['unclassified', 'cui', 'secret', 'top-secret'] },
      { key: 'system_type', description: 'System type (mission, support, test)', why: 'Mission systems have the highest availability requirements. Test systems must be clearly separated from mission systems.', how: 'Tag based on system criticality and purpose. Mission systems must have tier:0.', when: 'At system provisioning.', where: 'All resources.', exampleValues: ['mission', 'support', 'test', 'training'] },
      { key: 'platform_type', description: 'Airframe or platform type', why: 'Ground support systems for different platforms have distinct telemetry schemas and maintenance schedules — platform-blind dashboards can\'t attribute an anomaly to the right airframe program.', how: 'Tag ground-support and telemetry-ingestion hosts by the platform they support.', when: 'At program onboarding.', where: 'Hosts and APM services for telemetry ingestion and ground support.', exampleValues: ['fighter-jet', 'transport', 'satellite', 'uav'] },
      { key: 'test_range', description: 'Test range or facility identifier', why: 'Flight/ground test telemetry is range-specific — range-level tagging isolates a local network or instrumentation fault at one range from a program-wide data quality issue.', how: 'Tag telemetry-ingestion hosts and instrumentation systems by test range.', when: 'At range instrumentation setup.', where: 'Hosts and APM services for test telemetry ingestion.', exampleValues: ['range-edwards', 'range-white-sands'] },
    ],
    optional: [],
    complianceTags: [
      { key: 'compliance_scope', standard: 'CMMC', note: 'Required for defense contractors handling Controlled Unclassified Information (CUI).' },
    ],
  },
];

// ─── Organizational templates ─────────────────────────────────────────────────

export const ORG_TEMPLATES: IndustryTemplate[] = [
  {
    id: 'org-engineering',
    name: 'Engineering Teams',
    category: 'org',
    description: 'Tagging model for engineering organizations with squad/tribe structures.',
    icon: '👩‍💻',
    detectSignals: ['squad', 'tribe', 'oncall_group'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'squad', description: 'Engineering squad within a tribe', why: 'Enables squad-level cost attribution and alert routing in matrix organizations.', how: 'Add squad:<name> to all resources owned by the squad alongside the team tag.', when: 'At service onboarding.', where: 'All resources.', exampleValues: ['squad-payments', 'squad-infra'] },
      { key: 'tier', description: 'Service criticality tier (0-3)', why: 'Drives on-call rotation priority and SLO targets.', how: 'Define tier in the service catalog. Map to monitor priority automatically.', when: 'At service onboarding. Review quarterly.', where: 'APM services, monitors, SLOs.', exampleValues: ['0', '1', '2', '3'] },
    ],
    recommended: [
      { key: 'oncall_group', description: 'PagerDuty or OpsGenie on-call group', why: 'Enables automated alert routing to the correct on-call rotation without manual configuration.', how: 'Add oncall_group:<handle> to monitors. Must match the PagerDuty/OpsGenie team handle exactly.', when: 'At monitor creation.', where: 'Monitors, SLOs.', exampleValues: ['oncall-payments', 'oncall-platform'] },
      { key: 'platform', description: 'Platform or infrastructure domain', why: 'Platform teams serve multiple product teams. Platform-level cost attribution requires this tag.', how: 'Add platform tag to all shared infrastructure managed by platform teams.', when: 'At infrastructure provisioning.', where: 'Hosts, Kubernetes clusters, shared services.', exampleValues: ['k8s', 'data-platform', 'cicd', 'security'] },
    ],
    optional: [
      { key: 'tribe', description: 'Engineering tribe grouping squads', why: 'Tribe-level dashboards provide rollup visibility for VPs of Engineering.', how: 'Add tribe tag at the Kubernetes namespace or AWS account level for broad coverage.', when: 'At org structure provisioning.', where: 'All resources at the tribe level.', exampleValues: ['tribe-growth', 'tribe-platform'] },
    ],
  },
  {
    id: 'org-finops',
    name: 'FinOps / Finance',
    category: 'org',
    description: 'Tagging model for FinOps teams driving cloud cost visibility and attribution.',
    icon: '💰',
    detectSignals: ['budget_owner', 'project_code', 'spend_category'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'cost_center', description: 'Cost center code from finance system', why: 'Primary key for all chargeback and showback models. Must match the GL code in your finance system.', how: 'Apply to all resources. Sync with finance system taxonomy. Enforce in IaC templates.', when: 'At provisioning. Non-negotiable — block deployments without it.', where: 'All resources.', exampleValues: ['CC-1234', 'eng-platform'] },
      { key: 'business_unit', description: 'Business unit for P&L alignment', why: 'P&L owners need business-unit-level cloud spend for budget accountability.', how: 'Add business_unit to all resources. Align with the CFO-approved BU taxonomy.', when: 'At provisioning.', where: 'All resources.', exampleValues: ['consumer', 'enterprise', 'platform'] },
    ],
    recommended: [
      { key: 'budget_owner', description: 'Budget owner (person or group email)', why: 'Enables automated budget alerts to the right person when spend exceeds thresholds.', how: 'Add budget_owner to all resources. Use a team alias rather than individual email.', when: 'At provisioning.', where: 'All resources, especially expensive ones (GPU, RDS).', exampleValues: ['jane.doe@company.com', 'platform-budget@company.com'] },
      { key: 'project_code', description: 'Project or initiative code', why: 'Project-level cost tracking enables evaluation of ROI for specific engineering initiatives.', how: 'Add project_code to resources provisioned for a specific project. Remove when the project ends.', when: 'At project initiation.', where: 'Resources provisioned for the project.', exampleValues: ['proj-ai-2025', 'initiative-k8s-migration'] },
    ],
    optional: [
      { key: 'spend_category', description: 'Spend category (compute, storage, data-transfer, saas)', why: 'Enables FinOps teams to analyze spend by category for optimization campaigns.', how: 'Tag based on primary usage. Cloud integrations may auto-populate for some resources.', when: 'At provisioning.', where: 'Cloud resources.', exampleValues: ['compute', 'storage', 'data-transfer', 'ml-training'] },
    ],
  },
  {
    id: 'org-security',
    name: 'Security & Compliance',
    category: 'org',
    description: 'Tagging model for security teams managing compliance and risk.',
    icon: '🔐',
    detectSignals: ['security_zone', 'audit_scope', 'data_classification'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'data_classification', description: 'Data classification level', why: 'Required for automated access control, DLP policies, and regulatory compliance.', how: 'Apply based on data classification policy. Use consistent values from your classification framework.', when: 'At data store and service provisioning.', where: 'Database instances, hosts, APM services.', exampleValues: ['public', 'internal', 'confidential', 'restricted'] },
      { key: 'compliance', description: 'Compliance standard(s)', why: 'Enables automated compliance dashboards and continuous control monitoring per standard.', how: 'Apply the relevant standard(s). Resources can have multiple compliance tags.', when: 'At scoping and provisioning.', where: 'All resources in scope.', exampleValues: ['pci-dss', 'sox', 'hipaa', 'gdpr', 'iso-27001'] },
    ],
    recommended: [
      { key: 'security_zone', description: 'Security zone (dmz, trusted, restricted)', why: 'Security zones enforce network segmentation policies. Without this tag, zone violations are invisible.', how: 'Apply based on network security architecture. Align with firewall zone definitions.', when: 'At host provisioning. Review during network architecture changes.', where: 'Hosts, cloud instances, network devices (NDM).', exampleValues: ['dmz', 'trusted', 'restricted', 'internet-facing'] },
      { key: 'risk_level', description: 'Risk level (critical, high, medium, low)', why: 'Drives security scan frequency, patch priority, and incident response SLAs.', how: 'Assign based on threat model and business impact analysis.', when: 'At asset classification.', where: 'All resources.', exampleValues: ['critical', 'high', 'medium', 'low'] },
    ],
    optional: [
      { key: 'audit_scope', description: 'Audit scope (yes/no or audit framework)', why: 'Enables automated collection of audit evidence for in-scope systems.', how: 'Apply to all systems in scope for internal or external audits.', when: 'During audit scoping exercises.', where: 'All in-scope systems.', exampleValues: ['yes', 'sox-audit', 'pci-audit'] },
    ],
  },
  {
    id: 'org-data',
    name: 'Data & Analytics',
    category: 'org',
    description: 'Tagging model for data engineering and analytics teams.',
    icon: '📊',
    detectSignals: ['data_domain', 'pipeline', 'dataset', 'data_owner'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'data_domain', description: 'Data domain (customer, financial, operational, product)', why: 'Enables domain-level data quality monitoring and ownership.', how: 'Add data_domain to all data pipeline hosts and services.', when: 'At pipeline onboarding.', where: 'APM services for data pipelines, database instances.', exampleValues: ['customer', 'financial', 'operational', 'product'] },
      { key: 'data_owner', description: 'Data domain owner or steward', why: 'Required for data governance — data consumers need to know who owns each dataset.', how: 'Add to pipeline services and database instances. Use a team alias.', when: 'At data asset registration.', where: 'APM services, database instances, data catalog integrations.', exampleValues: ['data-eng-team@company.com', 'analytics-team'] },
    ],
    recommended: [
      { key: 'pipeline', description: 'Data pipeline or ETL job name', why: 'Pipeline-level monitoring enables targeted alerting on specific ETL failures.', how: 'Inject pipeline:<name> as a span tag in all pipeline jobs.', when: 'At pipeline instrumentation.', where: 'APM spans for data pipeline services.', exampleValues: ['etl-clickstream', 'pipeline-revenue-daily'] },
      { key: 'dataset', description: 'Dataset or table name', why: 'Dataset-level telemetry enables data freshness SLOs and quality monitoring.', how: 'Inject dataset tag into DBM query metadata and pipeline service spans.', when: 'At instrumentation time.', where: 'DBM, APM pipeline services.', exampleValues: ['events', 'users', 'transactions'] },
    ],
    optional: [
      { key: 'sensitivity', description: 'Data sensitivity (pii, anonymous, aggregate)', why: 'Drives data access controls and masking requirements.', how: 'Apply based on data classification policy.', when: 'At data asset registration.', where: 'Database instances, APM services handling sensitive data.', exampleValues: ['pii', 'anonymous', 'aggregate'] },
    ],
  },
];

// ─── Tag policy enforcement guidance ───────────────────────────────────────────
// General best practices — not tied to a specific template. Per
// datadoghq.com/blog/tagging-best-practices and tagging-best-practices docs:
// prefer auto-imported provider tags, then layer enforcement from the point
// closest to resource creation outward, so drift is caught before it ships.
// The Datadog-native layers below map to real product surfaces (org settings
// pages, docs) rather than generic advice — see TAG_POLICY_RESOURCES for links.

export interface TagPolicyLayer {
  layer: string;
  where: string;
  mechanism: string;
  catchesAt: 'design' | 'build' | 'deploy' | 'runtime';
  /** What you get once this layer is in place — the concrete benefit, not just the mechanism. */
  outcome: string;
  /** Path (no site prefix) to append to the org's Datadog base URL for a direct "open in your org" link. */
  orgSettingsPath?: string;
}

export const TAG_POLICY_GUIDANCE: TagPolicyLayer[] = [
  {
    layer: 'Infrastructure as Code',
    where: 'Terraform / CloudFormation / Pulumi modules',
    mechanism: 'Bake required tags (env, service, version, team, cost_center) into shared IaC modules as non-optional variables with no default value, so a plan fails closed rather than shipping untagged resources. Use Sentinel/OPA (Terraform) or cfn-guard (CloudFormation) policy-as-code to block applies missing required tags.',
    catchesAt: 'design',
    outcome: 'Untagged resources never get provisioned in the first place — the cheapest possible place to fix drift, before any cost or telemetry gap exists.',
  },
  {
    layer: 'CI/CD pipeline gate',
    where: 'Build/deploy pipeline (GitHub Actions, GitLab CI, Jenkins)',
    mechanism: 'Add a pipeline step that fails the build if DD_ENV/DD_SERVICE/DD_VERSION (or the Kubernetes tags.datadoghq.com/* labels) are absent from the manifest/task definition being deployed. Cheapest place to block drift — before anything reaches production.',
    catchesAt: 'build',
    outcome: 'A missing required tag fails the build with a clear error, instead of silently shipping an untagged service that shows up as a mystery host weeks later.',
  },
  {
    layer: 'Kubernetes Admission Controller',
    where: 'Datadog Admission Controller / OPA Gatekeeper / Kyverno',
    mechanism: 'Reject Pod/Deployment admission if required labels are missing, and use the Datadog Admission Controller to auto-convert standard Kubernetes labels into DD_ENV/DD_SERVICE/DD_VERSION env vars so app teams only maintain one set of labels.',
    catchesAt: 'deploy',
    outcome: 'App teams maintain one label set (Kubernetes-native); the Agent derives Datadog UST tags automatically, so there is no second tagging system to keep in sync.',
  },
  {
    layer: 'Cloud provider tag policies',
    where: 'AWS Organizations Tag Policies / SCPs, Azure Policy, GCP Organization Policy',
    mechanism: 'Enforce an allowed-values list for tags like env and cost_center at the cloud-account level (e.g. env must be one of prod/staging/dev) so a typo\'d value never reaches Datadog in the first place — this is enforcement the app itself cannot see or override.',
    catchesAt: 'deploy',
    outcome: 'Typos and synonym drift (Production vs prod vs PROD) are rejected at the cloud API level — Datadog never even sees a malformed value.',
  },
  {
    layer: 'Monitor Tag Policies',
    where: 'Organization Settings → Monitors → Policies',
    mechanism: 'Require specific tags (e.g. team, service) on every monitor before it can be created or saved — misconfigured or newly-created monitors are blocked, not just flagged after the fact.',
    catchesAt: 'runtime',
    outcome: 'Every monitor in the org is guaranteed to carry the tags your alert-routing and on-call tooling depend on — no monitor can go live without an owner.',
    orgSettingsPath: '/monitors/settings/policies',
  },
  {
    layer: 'Synthetics Enforced Tags',
    where: 'Organization Settings → Synthetics → Enforced Tags',
    mechanism: 'Configure a list of tag keys that must be present on every new or edited synthetic test — the test cannot be saved without them.',
    catchesAt: 'runtime',
    outcome: 'Synthetic tests can never silently lose their env/service/team attribution, even as test ownership changes over time.',
    orgSettingsPath: '/organization-settings/synthetics#enforced-tags',
  },
  {
    layer: 'Resource Catalog Policies (Governance)',
    where: 'Governance → Resource Catalog Policies',
    mechanism: 'Define org-wide compliance policies that continuously check resources (services, hosts, and more) against required-tag and ownership rules, surfacing violations in one governance view instead of per-product settings pages.',
    catchesAt: 'runtime',
    outcome: 'One dashboard shows every resource across every product violating your tagging standard — no need to check each product\'s settings separately.',
    orgSettingsPath: '/governance',
  },
  {
    layer: 'Cost Allocation Tag Pipelines',
    where: 'Cost Management → Allocation → Tag Pipelines',
    mechanism: 'Derive or backfill a cost-allocation tag (e.g. cost_center, team) from existing tags/rules even when the source telemetry itself is inconsistently tagged, so chargeback reporting isn\'t blocked on fixing every producer first.',
    catchesAt: 'runtime',
    outcome: 'Chargeback/showback reporting works today, on the tags you actually have, while the upstream fixes (IaC, CI/CD gates) roll out over time.',
    orgSettingsPath: '/cost/allocate/tag-pipelines',
  },
  {
    layer: 'Org Tag Policies (Telemetry — the only mandatory layer)',
    where: 'Tag Policies API (docs.datadoghq.com/api/latest/tag-policies)',
    mechanism: 'The one enforcement mechanism that can hard-block non-conforming telemetry at ingestion, and only for Logs, Metrics, Traces, RUM, and the Event Feed — every other layer here is advisory or scoped to a single resource type (monitors, synthetics, etc.). Define required tag keys and allowed values; violating telemetry is rejected or flagged depending on policy mode.',
    catchesAt: 'runtime',
    outcome: 'The last line of defense: even if every earlier layer is skipped, non-conforming logs/metrics/traces/RUM/events are blocked at the door instead of polluting production data.',
  },
  {
    layer: 'Tag normalization pipeline',
    where: 'Log Pipelines / Metrics tag remapper processors',
    mechanism: 'For sources you don\'t control (vendor agents, legacy hosts), use a remapper/mapping processor to normalize synonyms (environment→env, application→service) at ingest instead of asking every producer to change — the last-resort catch for tags that can\'t be fixed at the source.',
    catchesAt: 'runtime',
    outcome: 'Legacy and third-party sources you can\'t modify still end up with normalized tags, without a multi-team migration project.',
  },
];

// ─── Resource-level tag enforcement matrix ─────────────────────────────────────
// Which Datadog resource types support tags at all, and — critically — which
// ones can have that tagging made MANDATORY (blocking) rather than just advisory.
// Only telemetry ingestion (Logs/Metrics/Traces/RUM/Event Feed) supports true
// mandatory enforcement today, via org-level Tag Policies; every other resource
// type supports tags but enforcement there is scoped to that product's own
// settings (e.g. Monitor Tag Policies, Synthetics Enforced Tags) rather than a
// hard org-wide block.
export interface TagEnforcementRow {
  resource: string;
  tagsSupported: string;
  mandatoryEnforcement: boolean;
  notes?: string;
  /** Path (no site prefix) to this resource's own list/settings page in the viewing
   * org — resolved against the org's actual Datadog site, same pattern as
   * TagPolicyLayer.orgSettingsPath. Omitted for the 5 telemetry types (Logs/Metrics/
   * Traces/RUM/Event Feed) since their only real enforcement surface is the Tag
   * Policies API, not a dedicated settings page — see docsUrl instead. */
  orgSettingsPath?: string;
  /** Public Datadog docs page covering tagging/configuration for this resource. */
  docsUrl?: string;
}

export const TAG_ENFORCEMENT_MATRIX: TagEnforcementRow[] = [
  { resource: 'Dashboards', tagsSupported: 'Yes', mandatoryEnforcement: false, orgSettingsPath: '/dashboard/lists', docsUrl: 'https://docs.datadoghq.com/dashboards/' },
  { resource: 'Notebooks', tagsSupported: 'Yes', mandatoryEnforcement: false, orgSettingsPath: '/notebook/list', docsUrl: 'https://docs.datadoghq.com/notebooks/' },
  { resource: 'SLOs', tagsSupported: 'Yes', mandatoryEnforcement: false, orgSettingsPath: '/slo', docsUrl: 'https://docs.datadoghq.com/service_management/service_level_objectives/' },
  { resource: 'Downtimes', tagsSupported: 'Yes', mandatoryEnforcement: false, orgSettingsPath: '/monitors/downtime', docsUrl: 'https://docs.datadoghq.com/monitors/downtimes/' },
  { resource: 'Synthetic Tests', tagsSupported: 'Yes', mandatoryEnforcement: false, notes: 'Can require specific tag keys via Organization Settings → Synthetics → Enforced Tags, but this blocks test save, not org-wide ingestion.', orgSettingsPath: '/organization-settings/synthetics#enforced-tags', docsUrl: 'https://docs.datadoghq.com/synthetics/' },
  { resource: 'CI Visibility', tagsSupported: 'Yes', mandatoryEnforcement: false, orgSettingsPath: '/ci/pipeline-executions', docsUrl: 'https://docs.datadoghq.com/continuous_integration/' },
  { resource: 'Services (APM)', tagsSupported: 'Unified Service Tagging', mandatoryEnforcement: false, notes: 'env/service/version are structural (not arbitrary tags) but nothing blocks a span from omitting them.', orgSettingsPath: '/apm/services', docsUrl: 'https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/' },
  { resource: 'Hosts', tagsSupported: 'Yes', mandatoryEnforcement: false, orgSettingsPath: '/infrastructure', docsUrl: 'https://docs.datadoghq.com/getting_started/tagging/' },
  { resource: 'Containers', tagsSupported: 'Yes', mandatoryEnforcement: false, orgSettingsPath: '/containers', docsUrl: 'https://docs.datadoghq.com/getting_started/tagging/' },
  { resource: 'Kubernetes Objects', tagsSupported: 'Yes', mandatoryEnforcement: false, orgSettingsPath: '/orchestration/overview/pod', docsUrl: 'https://docs.datadoghq.com/containers/kubernetes/tag/' },
  { resource: 'Logs', tagsSupported: 'Yes (via telemetry policies)', mandatoryEnforcement: true, notes: 'Enforced via org-level Tag Policies — non-conforming logs can be blocked/flagged at ingest.', docsUrl: 'https://docs.datadoghq.com/logs/log_configuration/pipelines/' },
  { resource: 'Metrics', tagsSupported: 'Yes (via telemetry policies)', mandatoryEnforcement: true, docsUrl: 'https://docs.datadoghq.com/metrics/custom_metrics/' },
  { resource: 'Traces', tagsSupported: 'Yes (via telemetry policies)', mandatoryEnforcement: true, docsUrl: 'https://docs.datadoghq.com/tracing/' },
  { resource: 'RUM', tagsSupported: 'Yes (via telemetry policies)', mandatoryEnforcement: true, orgSettingsPath: '/rum/list', docsUrl: 'https://docs.datadoghq.com/real_user_monitoring/' },
  { resource: 'Event Feed', tagsSupported: 'Yes (via telemetry policies)', mandatoryEnforcement: true, docsUrl: 'https://docs.datadoghq.com/service_management/events/' },
];

// ─── Public docs / product links for tag policy setup ─────────────────────────
// URLs point at app.datadoghq.com (US1); for orgs on another site, the frontend
// swaps the origin for the org's actual site when the path is org-specific.
export interface TagPolicyResource {
  title: string;
  url: string;
  type: 'product' | 'docs' | 'api';
  description: string;
}

export const TAG_POLICY_RESOURCES: TagPolicyResource[] = [
  { title: 'Monitor Tag Policies', url: 'https://app.datadoghq.com/monitors/settings/policies', type: 'product', description: 'Require tags on every monitor before it can be saved.' },
  { title: 'Synthetics Enforced Tags', url: 'https://app.datadoghq.com/organization-settings/synthetics#enforced-tags', type: 'product', description: 'Require tags on every synthetic test before it can be saved.' },
  { title: 'Governance', url: 'https://app.datadoghq.com/governance', type: 'product', description: 'Org-wide compliance and Resource Catalog policy violations in one view.' },
  { title: 'Cost Allocation — Tag Pipelines', url: 'https://app.datadoghq.com/cost/allocate/tag-pipelines', type: 'product', description: 'Derive/backfill cost-allocation tags for chargeback reporting.' },
  { title: 'Resource Catalog Policies (Docs)', url: 'https://docs.datadoghq.com/infrastructure/resource_catalog/policies/', type: 'docs', description: 'How Resource Catalog policies evaluate and report compliance.' },
  { title: 'Tag Policies API — Create a Tag Policy', url: 'https://docs.datadoghq.com/api/latest/tag-policies/create-a-tag-policy/', type: 'api', description: 'The only mechanism that can mandatorily enforce tags on Logs/Metrics/Traces/RUM/Event Feed at ingestion.' },
];

// ─── Scoring ──────────────────────────────────────────────────────────────────

export interface TemplateScore {
  industry: string;
  templateName: string;
  category: 'industry' | 'org';
  overallScore: number;
  complianceScore: number;
  baselineScore: number;
  cloudAutoScore: number;
  globalBaseline: Array<{ key: string; description: string; why: string; how: string; when: string; where: string; found: boolean; coverage: number; foundKey: string | null; platformGuides?: Array<{ platform: string; method: string }> }>;
  required: Array<{ key: string; description: string; why: string; how: string; when: string; where: string; found: boolean; coverage: number; foundKey: string | null }>;
  recommended: Array<{ key: string; description: string; found: boolean; coverage: number }>;
  optional: Array<{ key: string; description: string; found: boolean }>;
  complianceTags: Array<{ key: string; standard: string; note: string; found: boolean }>;
  /** Cloud/orchestrator auto-injected tags — scored for visibility, not counted in overallScore (they cost nothing to adopt). */
  cloudAuto: Array<CloudAutoTag & { found: boolean; coverage: number; foundKey: string | null }>;
  missingBaseline: string[];
  missingRequired: string[];
  missingRecommended: string[];
  quickWins: string[];
}

function caseFold(s: string) {
  return s.toLowerCase().replace(/[-.\s]/g, '_');
}

export function scoreAgainstTemplate(orgId: string, scanRunId: string, templateId: string): TemplateScore {
  const allTemplates = [...INDUSTRY_TEMPLATES, ...ORG_TEMPLATES];
  const template = allTemplates.find((t) => t.id === templateId) ?? INDUSTRY_TEMPLATES[0];

  const db = getDatabase();
  const tagRows = db.prepare(
    `SELECT tag_key, host_occurrence_count FROM tag_analysis WHERE org_id = ? AND scan_run_id = ?`
  ).all(orgId, scanRunId) as Array<{ tag_key: string; host_occurrence_count: number }>;

  const totalHosts = (db.prepare(
    'SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ?'
  ).get(orgId, scanRunId) as { c: number })?.c ?? 1;

  const tagMap = new Map(tagRows.map((r) => [r.tag_key, r]));
  const tagKeys = tagRows.map((r) => r.tag_key);

  function findTag(key: string): { found: boolean; coverage: number; foundKey: string | null } {
    let foundKey: string | null = tagKeys.find((k) => k === key) ?? null;
    if (!foundKey) foundKey = tagKeys.find((k) => caseFold(k) === caseFold(key)) ?? null;
    if (!foundKey) return { found: false, coverage: 0, foundKey: null };
    const row = tagMap.get(foundKey);
    const coverage = totalHosts > 0 && row ? Math.round((row.host_occurrence_count / totalHosts) * 100) : 0;
    return { found: true, coverage, foundKey };
  }

  const globalBaseline = template.globalBaseline.map((t) => ({ ...t, ...findTag(t.key) }));
  const required = template.required.map((t) => ({ ...t, ...findTag(t.key) }));
  const recommended = template.recommended.map((t) => ({ ...t, ...findTag(t.key) }));
  const optional = template.optional.map((t) => ({ ...t, found: findTag(t.key).found }));
  const complianceTags = (template.complianceTags ?? []).map((t) => ({ ...t, found: findTag(t.key).found }));
  const cloudAuto = CLOUD_AUTO_TAGS.map((t) => ({ ...t, ...findTag(t.key) }));

  const baselineFound = globalBaseline.filter((t) => t.found).length;
  const requiredFound = required.filter((t) => t.found).length;
  const recommendedFound = recommended.filter((t) => t.found).length;
  const complianceFound = complianceTags.filter((t) => t.found).length;
  const cloudAutoFound = cloudAuto.filter((t) => t.found).length;

  const baselineScore = Math.round((baselineFound / Math.max(globalBaseline.length, 1)) * 100);
  const cloudAutoScore = Math.round((cloudAutoFound / Math.max(cloudAuto.length, 1)) * 100);
  const overallScore = Math.round(
    baselineScore * 0.5 +
    (required.length > 0 ? (requiredFound / required.length) * 30 : 30) +
    (recommended.length > 0 ? (recommendedFound / recommended.length) * 15 : 15) +
    (complianceTags.length > 0 ? (complianceFound / complianceTags.length) * 5 : 5)
  );
  const complianceScore = complianceTags.length > 0
    ? Math.round((complianceFound / complianceTags.length) * 100)
    : 100;

  return {
    industry: templateId,
    templateName: template.name,
    category: template.category,
    overallScore,
    complianceScore,
    baselineScore,
    cloudAutoScore,
    globalBaseline,
    required,
    recommended,
    optional,
    complianceTags,
    cloudAuto,
    missingBaseline: globalBaseline.filter((t) => !t.found).map((t) => t.key),
    missingRequired: required.filter((t) => !t.found).map((t) => t.key),
    missingRecommended: recommended.filter((t) => !t.found).map((t) => t.key),
    quickWins: [...globalBaseline.filter((t) => !t.found).map((t) => t.key),
      ...required.filter((t) => !t.found).map((t) => t.key)].slice(0, 5),
  };
}

export function detectRecommendedTemplate(orgId: string, scanRunId: string): string {
  const db = getDatabase();
  const tagKeys = new Set(
    (db.prepare('SELECT tag_key FROM tag_analysis WHERE org_id = ? AND scan_run_id = ?')
      .all(orgId, scanRunId) as { tag_key: string }[]).map((r) => r.tag_key)
  );
  const serviceNames = (db.prepare('SELECT service_name FROM services WHERE org_id = ? AND scan_run_id = ?')
    .all(orgId, scanRunId) as { service_name: string }[]).map((r) => r.service_name.toLowerCase());

  const scores: [string, number][] = [];
  for (const t of [...INDUSTRY_TEMPLATES, ...ORG_TEMPLATES]) {
    if (!t.detectSignals) continue;
    const hits = t.detectSignals.filter((sig) =>
      tagKeys.has(sig) || serviceNames.some((s) => s.includes(sig.replace('_', '-')))
    ).length;
    scores.push([t.id, hits]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0]?.[0] ?? 'generic';
}
