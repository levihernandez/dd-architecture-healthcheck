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
  /** Concrete per-Datadog-product setup examples (RUM/Logs/APM/Agent/Integrations) for
   * this tag — surfaced in the "resource examples" modal in the frontend. Populated for
   * the shared globalBaseline tags on every template, plus select high-value required
   * tags on newer templates. */
  resourceExamples?: Array<{
    resource: 'rum' | 'logs' | 'apm' | 'agent' | 'integrations';
    example: string;
    description?: string;
  }>;
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
    resourceExamples: [
      { resource: 'rum', example: 'DD_RUM_INIT env: "production"  // datadogRum.init({ ..., env: "production" })', description: 'Set in the RUM SDK init config so every session/view carries env — filters the RUM Overview and Core Web Vitals dashboards by environment.' },
      { resource: 'logs', example: 'DD_TAGS=env:production  # or a log pipeline "Env" mapping processor on the raw log attribute', description: 'Either inject via the Agent-wide DD_TAGS env var, or use a Log Pipeline remapper/attribute processor to normalize an existing field (e.g. "environment") into the reserved env facet.' },
      { resource: 'apm', example: 'DD_ENV=production  // or tracer.init({ env: "production" }) in code', description: 'Required unified service tag — the tracer reads DD_ENV at startup and stamps it on every span; cannot be changed per-span at runtime.' },
      { resource: 'agent', example: '# datadog.yaml\nenv: production', description: 'Sets the host-level env tag applied to all Agent-collected metrics/checks on that host.' },
      { resource: 'integrations', example: 'ad.datadoghq.com/<container>.tags: \'{"env":"production"}\'', description: 'Autodiscovery annotation for per-container overrides when a single pod hosts containers from more than one environment (rare, but supported).' },
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
    resourceExamples: [
      { resource: 'rum', example: 'datadogRum.init({ ..., service: "checkout-web" })', description: 'Names the RUM application\'s underlying service so front-end sessions correlate 1:1 with the backend APM service of the same name.' },
      { resource: 'logs', example: 'DD_TAGS=service:checkout-api  # or a Service Remapper pipeline processor', description: 'A Log Pipeline "Service Remapper" processor can promote an existing log attribute (e.g. "app" or "logger_name") to the reserved service facet for sources that don\'t set DD_SERVICE directly.' },
      { resource: 'apm', example: 'DD_SERVICE=checkout-api  // tracer.init({ service: "checkout-api" })', description: 'Powers the Service Map and Service Catalog entry; must exactly match across every instance of the service — one span can only carry one service name.' },
      { resource: 'agent', example: '# datadog.yaml\ntags:\n  - service:checkout-api', description: 'Only appropriate for single-service hosts; multi-service hosts should set DD_SERVICE per-process instead so the host-level tag doesn\'t misattribute traffic.' },
      { resource: 'integrations', example: 'ad.datadoghq.com/<container>.tags: \'{"service":"checkout-api"}\'', description: 'Per-container Autodiscovery override — falls back to the tags.datadoghq.com/service pod label when not set explicitly.' },
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
    resourceExamples: [
      { resource: 'rum', example: 'datadogRum.init({ ..., version: "2.1.3" })', description: 'Enables RUM Deployment Tracking — compares Core Web Vitals and error rate between the current and previous front-end release.' },
      { resource: 'logs', example: '# Inject at build time into the structured log formatter\n{"version": "2.1.3", "msg": "..."}', description: 'No dedicated remapper — most teams emit version as a structured JSON field and let the Log Pipeline\'s standard attribute mapping pick it up as the reserved version facet.' },
      { resource: 'apm', example: 'DD_VERSION=2.1.3  // set from CI at build time, e.g. $(git rev-parse --short HEAD)', description: 'Powers APM Deployment Tracking — auto-compares error rate/latency between the current and previous version after a release.' },
      { resource: 'agent', example: '# Not a static datadog.yaml field — inject per-process\nDD_VERSION=2.1.3 /bin/my-service', description: 'Version changes every deploy, so it is set per-process at launch time rather than baked into the static Agent config.' },
      { resource: 'integrations', example: 'ad.datadoghq.com/<container>.tags: \'{"version":"2.1.3"}\'', description: 'Set by the CI/CD pipeline templating the Kubernetes manifest at deploy time, not hand-maintained.' },
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
    resourceExamples: [
      { resource: 'rum', example: 'datadogRum.init({ ..., env: "production", service: "checkout-web" });\n// then set additional context: datadogRum.setGlobalContextProperty("team", "checkout-team")', description: 'team is not a first-class RUM init field — set it as a global context property so it appears as a facet on every RUM event.' },
      { resource: 'logs', example: 'DD_TAGS=team:checkout-team  # or a pipeline processor mapping kube_namespace -> team', description: 'Most orgs derive team from kube_namespace via a Log Pipeline processor rather than asking every service to set it explicitly.' },
      { resource: 'apm', example: 'DD_TAGS=team:checkout-team  // additional custom tag alongside DD_ENV/DD_SERVICE/DD_VERSION', description: 'Not a unified service tag, but universally supported via DD_TAGS — attaches to every span, metric, and log the tracer/Agent emits from that process.' },
      { resource: 'agent', example: '# datadog.yaml\ntags:\n  - team:checkout-team', description: 'Applies to all host-level metrics and checks; container workloads should prefer the Kubernetes label below so it travels with the workload, not the host.' },
      { resource: 'integrations', example: 'tags.datadoghq.com/team: "checkout-team"  # pod/deployment label', description: 'Kubernetes label picked up automatically by the Datadog Cluster Agent and applied to pods, containers, and their metrics/logs/traces.' },
    ],
  },
  {
    key: 'owner',
    description: 'Individual or group email responsible for the resource',
    why: 'Enables direct contact during incidents without looking up the on-call rotation. Differentiates day-to-day owner from the team.',
    how: 'Add owner:<email-or-handle> to service catalog entries and monitors. Use a team alias email rather than an individual for production services.',
    when: 'At service onboarding. Update when ownership transfers.',
    where: 'Service catalog (primary), monitors, APM services.',
    exampleValues: ['platform-oncall@company.com', 'jane.doe', 'payments-oncall'],
    resourceExamples: [
      { resource: 'rum', example: 'datadogRum.setGlobalContextProperty("owner", "checkout-oncall@company.com")', description: 'Useful mainly for internal-tooling RUM applications where a specific rotation, not the whole team, is the escalation point.' },
      { resource: 'logs', example: 'DD_TAGS=owner:checkout-oncall  # rarely set at the telemetry level — usually lives in the Service Catalog entry instead', description: 'owner is most valuable as Service Catalog metadata (see service.datadog.yaml below) rather than a raw log tag on every line.' },
      { resource: 'apm', example: 'DD_TAGS=owner:checkout-oncall@company.com', description: 'Supplements team on high-tier services where the on-call contact needs to be reachable directly from a trace without checking a separate rotation lookup.' },
      { resource: 'agent', example: '# Not typically an Agent/host-level tag — set via the Service Catalog entry (service.datadog.yaml) instead', description: 'Host-level owner tagging is uncommon; ownership is almost always modeled at the service, not the host.' },
      { resource: 'integrations', example: '# service.datadog.yaml (Service Catalog / Software Catalog)\ncontacts:\n  - type: email\n    contact: checkout-oncall@company.com', description: 'The canonical place to declare owner today is the Service Catalog entry, which every product (APM, monitors, incidents) reads from.' },
    ],
  },
  {
    key: 'cost_center',
    description: 'Cost center code for chargeback and FinOps',
    why: 'Without cost_center you cannot generate chargeback reports or allocate cloud spend to P&L owners — the single most critical FinOps tag.',
    how: 'Add cost_center:<code> to all host extra_tags. Set as a cloud provider tag and sync via Datadog integration. Enforce in IaC templates.',
    when: 'At resource provisioning. Required before any cloud billing data is useful for attribution.',
    where: 'All resources. Priority: hosts, cloud instances, database instances.',
    exampleValues: ['CC-1234', 'eng-platform', 'finops-42'],
    resourceExamples: [
      { resource: 'rum', example: '// Not applicable — RUM/browser telemetry has no direct cloud billing line item to allocate', description: 'Cost allocation is a cloud-resource and host/container concern; RUM sessions don\'t individually incur billable infra cost, so cost_center is generally omitted here.' },
      { resource: 'logs', example: '# Usually attributed indirectly via host/service tags rather than set per-log-line', description: 'Log ingestion cost is more often allocated via Cost Management\'s tag pipelines against the source host/service\'s cost_center than a per-log tag.' },
      { resource: 'apm', example: 'DD_TAGS=cost_center:CC-1234', description: 'Attaches trace-level cost allocation for orgs doing granular chargeback of APM ingestion by service, on top of host-level allocation.' },
      { resource: 'agent', example: '# datadog.yaml\ntags:\n  - cost_center:CC-1234', description: 'The primary place to set this — host-level cost_center rolls up compute, and most Datadog product usage, to a chargeback code.' },
      { resource: 'integrations', example: '# Usually synced automatically from the cloud provider\'s own cost_center tag via the AWS/GCP/Azure integration rather than set at the container level', description: 'Reuse the cloud account/resource-level tag your FinOps team already applies for billing — avoid a second manual tag that can drift from the source of truth.' },
    ],
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

  // ─ Travel & Hospitality sector ────────────────────────────────────────────
  {
    id: 'hospitality-hotels',
    name: 'Hotels & Resorts',
    category: 'industry',
    sector: 'Travel & Hospitality',
    description: 'For hotel chains, resorts, and property management platforms handling reservations, guest services, and multi-property operations.',
    icon: '🏨',
    detectSignals: ['property_id', 'pms_system', 'booking_channel', 'guest_tier'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'property_id', description: 'Individual hotel property or resort identifier', why: 'Multi-property chains need per-property uptime and booking-funnel visibility — a single property\'s PMS or Wi-Fi outage should be scoped to that property, not read as a chain-wide incident.', how: 'Add property_id:<code> to all systems and edge devices deployed at that property (PMS terminals, kiosks, in-room tech).', when: 'At property onboarding.', where: 'PMS hosts, front-desk terminals, in-room technology, edge network devices.', exampleValues: ['prop-nyc-042', 'resort-maui-01'],
        resourceExamples: [
          { resource: 'rum', example: 'datadogRum.setGlobalContextProperty("property_id", "prop-nyc-042")', description: 'Scopes guest-facing booking-widget or in-room portal RUM sessions to the specific property, so a single hotel\'s Wi-Fi/portal issue doesn\'t skew chain-wide Core Web Vitals.' },
          { resource: 'logs', example: 'DD_TAGS=property_id:prop-nyc-042  # set on PMS interface hosts at that property', description: 'Applied at the PMS/edge host level so all logs from that property\'s systems carry consistent scoping.' },
          { resource: 'apm', example: 'DD_TAGS=property_id:prop-nyc-042', description: 'Lets reservation and folio-payment spans be filtered per property without needing a separate service per hotel.' },
          { resource: 'agent', example: '# datadog.yaml on the property\'s PMS/edge host\ntags:\n  - property_id:prop-nyc-042', description: 'Set once per property\'s on-prem or edge host — every check/metric from that host inherits it.' },
          { resource: 'integrations', example: 'ad.datadoghq.com/<container>.tags: \'{"property_id":"prop-nyc-042"}\'', description: 'For containerized PMS integration services running per-property, e.g. in a property-local edge cluster.' },
        ] },
      { key: 'pci_scope', description: 'PCI scope indicator', why: 'Front-desk check-in, folio payment, and F&B point-of-sale all touch card data — mandatory for any system in that path.', how: 'Apply pci_scope:in-scope to PMS payment modules, POS terminals, and booking-engine payment pages.', when: 'At provisioning.', where: 'PMS payment modules, POS terminals, booking engine.', exampleValues: ['in-scope', 'out-of-scope'] },
    ],
    recommended: [
      { key: 'brand', description: 'Hotel brand or flag', why: 'Multi-brand operators (a management company running several flags) need brand-level reliability and guest-satisfaction reporting distinct from any single property.', how: 'Add brand:<name> to all resources serving properties under that brand.', when: 'At property onboarding.', where: 'PMS hosts, booking engine, loyalty services.', exampleValues: ['brand-luxury-collection', 'brand-select-service'] },
      { key: 'booking_channel', description: 'Reservation channel (direct, OTA, GDS, call-center)', why: 'Direct-booking and OTA (Expedia, Booking.com) traffic route through very different integration paths with different latency and rate-limit behavior — a degraded OTA channel integration looks like a general booking-engine outage without this tag.', how: 'Inject booking_channel as a span tag at the reservation-creation service based on the request source.', when: 'At instrumentation time.', where: 'APM spans for reservation and booking-engine services.', exampleValues: ['direct', 'ota', 'gds', 'call-center'] },
      { key: 'pms_system', description: 'Property Management System (PMS) vendor/integration', why: 'PMS integrations (Opera, Infor HMS, Cloudbeds) are frequently the root cause of check-in/check-out and folio incidents — vendor-level tagging isolates one integration\'s outage from platform-wide health.', how: 'Tag PMS integration services and interface hosts with the PMS vendor name.', when: 'At PMS integration onboarding.', where: 'APM services and hosts for PMS integrations.', exampleValues: ['opera', 'infor-hms', 'cloudbeds', 'protel'] },
      { key: 'guest_tier', description: 'Loyalty/guest tier', why: 'Elite loyalty tiers expect faster service recovery and dedicated support paths — tier-level dashboards let support triage by contractual/loyalty commitment during an incident, not just raw severity.', how: 'Inject guest_tier from the loyalty/CRM system as a span tag on guest-facing services.', when: 'At instrumentation time.', where: 'APM spans, RUM sessions for guest-facing booking and loyalty services.', exampleValues: ['standard', 'silver', 'gold', 'diamond'] },
    ],
    optional: [
      { key: 'room_type', description: 'Room/inventory category', why: 'Inventory-availability and rate-shopping latency can vary by room category during high-demand searches — useful for capacity-planning the booking engine\'s search path.', how: 'Inject room_type as a span tag from the availability/rate-shopping service.', when: 'At instrumentation time.', where: 'APM spans for availability and rate-shopping services.', exampleValues: ['standard', 'suite', 'accessible', 'all-inclusive'] },
    ],
    complianceTags: [
      { key: 'pci_scope', standard: 'PCI DSS', note: 'Required for all front-desk, folio, and POS payment acceptance across properties.' },
    ],
  },
  {
    id: 'hospitality-cruise',
    name: 'Cruise Lines',
    category: 'industry',
    sector: 'Travel & Hospitality',
    description: 'For cruise operators managing shipboard systems, guest services, and itinerary operations across a fleet, with satellite-constrained connectivity.',
    icon: '🛳️',
    detectSignals: ['vessel_id', 'fleet', 'itinerary', 'deck_system', 'port_of_call'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'vessel_id', description: 'Individual ship identifier', why: 'Each vessel is effectively its own isolated network segment at sea — vessel-level tagging is required to distinguish a single ship\'s connectivity or system incident from a fleet-wide platform issue.', how: 'Add vessel_id:<name> to all onboard systems, edge hosts, and satellite gateway devices for that ship.', when: 'At vessel commissioning or system onboarding.', where: 'Onboard hosts, edge network devices, satellite gateway systems.', exampleValues: ['vessel-horizon-01', 'vessel-odyssey-03'],
        resourceExamples: [
          { resource: 'rum', example: 'datadogRum.setGlobalContextProperty("vessel_id", "vessel-horizon-01")', description: 'Scopes guest-facing onboard portal/entertainment-system RUM sessions to the ship, so a single vessel\'s satellite-link degradation doesn\'t skew fleet-wide RUM metrics.' },
          { resource: 'logs', example: 'DD_TAGS=vessel_id:vessel-horizon-01  # set on the onboard Agent/gateway host', description: 'Applied once on the ship\'s onboard log-forwarding gateway so every onboard system\'s logs inherit it before transmission over the satellite link.' },
          { resource: 'apm', example: 'DD_TAGS=vessel_id:vessel-horizon-01', description: 'Lets guest-services and POS spans be filtered per vessel for both incident response and fleet-wide performance comparison.' },
          { resource: 'agent', example: '# datadog.yaml on the onboard Agent host\ntags:\n  - vessel_id:vessel-horizon-01', description: 'Set once on the vessel\'s onboard Agent/gateway host — batches and forwards telemetry over the satellite uplink with this tag already attached.' },
          { resource: 'integrations', example: 'ad.datadoghq.com/<container>.tags: \'{"vessel_id":"vessel-horizon-01"}\'', description: 'For containerized onboard services (POS, entertainment platform) running on the ship\'s local edge compute.' },
        ] },
      { key: 'deck_system', description: 'Shipboard operational system category', why: 'Guest-facing systems (POS, entertainment, Wi-Fi) and safety/navigation systems have completely different criticality and monitoring requirements — conflating them risks either under-alerting on safety-adjacent systems or drowning them in guest-Wi-Fi noise.', how: 'Tag onboard hosts and services by the deck system category they belong to; safety-adjacent systems should also carry tier:0.', when: 'At system provisioning.', where: 'Onboard hosts and services.', exampleValues: ['guest-wifi', 'pos-retail', 'entertainment', 'navigation-support', 'galley-ops'] },
    ],
    recommended: [
      { key: 'fleet', description: 'Fleet or brand grouping within a cruise operator', why: 'Multi-brand cruise operators (running several fleets under one parent company) need brand-level rollups distinct from any single vessel\'s performance.', how: 'Add fleet:<name> to all resources tied to vessels in that fleet.', when: 'At vessel/fleet onboarding.', where: 'Fleet management services, shore-side systems tracking fleet-wide data.', exampleValues: ['fleet-premium', 'fleet-family'] },
      { key: 'itinerary', description: 'Current voyage/itinerary identifier', why: 'System load and guest activity patterns shift dramatically between sea days and port days on a given itinerary — itinerary-level context helps distinguish expected load shifts from genuine anomalies.', how: 'Inject itinerary as a tag from the voyage-management system, updated at the start of each sailing.', when: 'At voyage start.', where: 'Onboard guest-services APM spans, shore-side voyage tracking.', exampleValues: ['itin-caribbean-7night', 'itin-mediterranean-10night'] },
      { key: 'connectivity_link', description: 'Satellite/maritime connectivity link type in use', why: 'VSAT and low-earth-orbit satellite links have very different latency, bandwidth, and weather-related outage profiles than shore-side connectivity — link-blind dashboards can\'t distinguish "the ship\'s satellite link degraded" from an application-level problem.', how: 'Inject connectivity_link as a tag from the onboard network gateway\'s active-link status.', when: 'At instrumentation time, continuously updated as the active link changes.', where: 'Onboard network gateway hosts, NDM for shipboard network equipment.', exampleValues: ['vsat', 'leo-satellite', 'port-wifi-uplink'] },
      { key: 'port_of_call', description: 'Current or upcoming port of call', why: 'Connectivity, POS transaction volume (shore excursions, port shopping), and guest disembarkation-system load are all port-specific — port-level context distinguishes expected in-port load spikes from genuine incidents.', how: 'Inject port_of_call as a tag from the voyage-management system based on the ship\'s current position/schedule.', when: 'At each port call.', where: 'Onboard guest-services APM spans, shore-excursion booking services.', exampleValues: ['port-nassau', 'port-cozumel', 'port-barcelona'] },
    ],
    optional: [
      { key: 'muster_station_system', description: 'Safety/muster-station tracking system flag', why: 'Passenger safety and muster-drill tracking systems carry maritime safety-regulation weight and should never share alert thresholds or maintenance windows with entertainment/guest-Wi-Fi systems.', how: 'Tag muster-station and safety-drill tracking hosts/services; set tier:0.', when: 'At system provisioning.', where: 'Onboard safety-system hosts.', exampleValues: ['yes', 'no'] },
    ],
    // Deliberately omitted: cruise safety regulation is real (e.g. SOLAS-derived flag-state
    // and class-society requirements) but the specific compliance tag/standard names vary by
    // flag state and class society, so no complianceTags list is fabricated here — track
    // that mapping with your safety/regulatory team rather than a guessed tag taxonomy.
  },
  {
    id: 'maritime-shipping',
    name: 'Maritime & Shipping / Logistics',
    category: 'industry',
    sector: 'Travel & Hospitality',
    description: 'For cargo shipping lines, freight operators, and port logistics platforms tracking vessels, cargo, and fleet operations — distinct from passenger cruise operations.',
    icon: '🚢',
    detectSignals: ['vessel_id', 'route', 'cargo_type', 'port', 'fleet_operator'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'vessel_id', description: 'Individual cargo vessel identifier', why: 'Vessel-level tracking and telemetry is the core unit of freight operations — a single vessel\'s system or connectivity incident must be isolated from fleet-wide dashboards to avoid mis-scoped incident response.', how: 'Add vessel_id:<name-or-imo> to all onboard systems and shore-side tracking records for that vessel. Prefer the vessel\'s IMO number for cross-system consistency.', when: 'At vessel onboarding or system provisioning.', where: 'Onboard hosts, shore-side fleet-tracking services, NDM for vessel network equipment.', exampleValues: ['vessel-imo-9321483', 'vessel-pacific-trader'],
        resourceExamples: [
          { resource: 'rum', example: '// Not applicable — cargo vessels have no guest-facing web/app surface to instrument with RUM', description: 'Freight/logistics operations have no consumer-facing browser or mobile surface analogous to guest-facing hospitality apps.' },
          { resource: 'logs', example: 'DD_TAGS=vessel_id:vessel-imo-9321483  # set on the onboard log-forwarding gateway', description: 'Applied once on the vessel\'s onboard gateway host so all onboard telemetry inherits it before transmission over the satellite link.' },
          { resource: 'apm', example: 'DD_TAGS=vessel_id:vessel-imo-9321483', description: 'Lets shore-side voyage-tracking and cargo-manifest spans be filtered per vessel across the fleet-tracking platform.' },
          { resource: 'agent', example: '# datadog.yaml on the onboard Agent/gateway host\ntags:\n  - vessel_id:vessel-imo-9321483', description: 'Set once on the vessel\'s onboard Agent host for all onboard system telemetry.' },
          { resource: 'integrations', example: 'ad.datadoghq.com/<container>.tags: \'{"vessel_id":"vessel-imo-9321483"}\'', description: 'For containerized onboard/edge services running fleet-tracking or reefer-monitoring agents.' },
        ] },
      { key: 'route', description: 'Shipping route or trade lane', why: 'Route-level on-time performance is the primary commercial metric in freight shipping — route-blind system monitoring can\'t be tied back to the SLAs that actually matter to customers.', how: 'Inject route as a tag from the voyage-planning system, at voyage assignment.', when: 'At voyage assignment.', where: 'Shore-side voyage-tracking and route-planning services.', exampleValues: ['route-transpacific', 'route-asia-europe'] },
    ],
    recommended: [
      { key: 'cargo_type', description: 'Cargo category carried', why: 'Container, bulk, tanker, and refrigerated (reefer) cargo have distinct monitoring needs — reefer cargo in particular requires continuous temperature-telemetry monitoring with much stricter alerting than dry cargo.', how: 'Inject cargo_type as a tag from the cargo-manifest system per voyage or per container.', when: 'At cargo loading / manifest creation.', where: 'Cargo-tracking services, reefer-monitoring systems.', exampleValues: ['container', 'bulk', 'tanker', 'reefer'] },
      { key: 'port', description: 'Port of departure, arrival, or transshipment', why: 'Port-side systems (terminal operating systems, customs integration) are a frequent source of delay-causing incidents — port-level tagging isolates a single port\'s integration issue from a route-wide delay pattern.', how: 'Inject port as a tag from the voyage-tracking system at each port call.', when: 'At each port call.', where: 'Shore-side voyage tracking, terminal-operating-system integrations.', exampleValues: ['port-shanghai', 'port-rotterdam', 'port-los-angeles'] },
      { key: 'fleet_operator', description: 'Fleet operator or charterer', why: 'Chartered/leased vessels operated on behalf of another company need clear operator-level attribution for both cost allocation and incident ownership — a vessel\'s owner and its operator are frequently different entities.', how: 'Tag vessel records with the current operating entity from the charter agreement.', when: 'At charter assignment.', where: 'Shore-side fleet-management services.', exampleValues: ['operator-maersk', 'operator-msc', 'operator-cosco'] },
      { key: 'connectivity_link', description: 'Satellite/maritime connectivity link type in use', why: 'As with cruise vessels, cargo ships rely on VSAT or satellite links with distinct latency and outage characteristics from shore-side connectivity — necessary context for distinguishing a link outage from an application fault when telemetry gaps appear.', how: 'Inject connectivity_link as a tag from the onboard network gateway\'s active-link status.', when: 'At instrumentation time, continuously updated.', where: 'Onboard network gateway hosts, NDM for vessel network equipment.', exampleValues: ['vsat', 'leo-satellite', 'port-wifi-uplink'] },
    ],
    optional: [
      { key: 'container_tracking_provider', description: 'IoT/container-tracking telemetry provider', why: 'Container-level GPS/temperature tracking is frequently outsourced to a third-party IoT provider — provider-level tagging isolates a vendor-side telemetry gap from a genuine cargo incident.', how: 'Tag container-tracking ingestion services with the telemetry provider name.', when: 'At integration onboarding.', where: 'APM services for container-tracking ingestion.', exampleValues: ['tracker-vendor-a', 'tracker-vendor-b'] },
    ],
  },
  {
    id: 'travel-airlines',
    name: 'Airlines',
    category: 'industry',
    sector: 'Travel & Hospitality',
    description: 'For airline carriers with reservation, check-in, and flight-operations systems. More specific than the general Transportation & Logistics template: covers passenger/booking-class economics and airport/flight-leg operational structure rather than fleet dispatch and freight routing.',
    icon: '✈️',
    detectSignals: ['flight_route', 'fleet_type', 'airport_code', 'booking_class'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'flight_route', description: 'Origin-destination flight route/city pair', why: 'Reservation-system and check-in load, plus weather/ATC-driven disruption, are fundamentally route-scoped — route-blind dashboards can\'t distinguish a single lane\'s disruption from a systemic reservation-system outage.', how: 'Inject flight_route as a span tag from the reservation and check-in services based on the itinerary segment.', when: 'At instrumentation time.', where: 'APM spans for reservation, check-in, and flight-operations services.', exampleValues: ['jfk-lhr', 'ord-lax', 'sfo-nrt'],
        resourceExamples: [
          { resource: 'rum', example: 'datadogRum.setGlobalContextProperty("flight_route", "jfk-lhr")', description: 'Scopes booking-site and mobile check-in RUM sessions to the route being searched/booked, useful for spotting route-specific search-latency regressions.' },
          { resource: 'logs', example: 'DD_TAGS=flight_route:jfk-lhr  # injected as a structured field by the reservation service, not set at the Agent level', description: 'Set programmatically by the reservation/check-in service per request rather than statically per host.' },
          { resource: 'apm', example: 'DD_TAGS=flight_route:jfk-lhr', description: 'Injected per-span from the itinerary context; enables route-level latency and error-rate comparison across the reservation and check-in services.' },
          { resource: 'agent', example: '# Not a host-level tag — flight_route is per-request, set by the application, not the Agent config', description: 'Route varies per request on the same hosts, so it is injected in application code rather than statically in datadog.yaml.' },
          { resource: 'integrations', example: '# Not an Autodiscovery-level tag — set in application code from the request/itinerary context', description: 'Route-level tagging happens inside the reservation service\'s own instrumentation, not via container-level annotations.' },
        ] },
      { key: 'airport_code', description: 'Airport (IATA/ICAO) code for airport-side systems', why: 'Kiosk, gate, and baggage-handling systems are deployed per-airport — airport-level tagging is required to isolate a single station\'s outage (e.g. a local network issue at one airport) from an airline-wide systems incident.', how: 'Add airport_code:<IATA> to all kiosk, gate-system, and baggage-handling hosts at that station.', when: 'At station system provisioning.', where: 'Kiosk hosts, gate-system hosts, baggage-handling systems.', exampleValues: ['jfk', 'lhr', 'ord', 'nrt'] },
    ],
    recommended: [
      { key: 'booking_class', description: 'Fare/booking class', why: 'Premium cabin and elite-tier passengers have different rebooking/service-recovery SLAs during irregular operations (IROPs) — class-blind dashboards can\'t prioritize the passenger segments with the tightest contractual expectations.', how: 'Inject booking_class as a span tag from the reservation system at booking or check-in.', when: 'At instrumentation time.', where: 'APM spans for reservation and check-in services.', exampleValues: ['economy', 'premium-economy', 'business', 'first'] },
      { key: 'fleet_type', description: 'Aircraft type/fleet family', why: 'Different aircraft types have different in-flight connectivity systems (IFE, Wi-Fi) and turnaround-time profiles at the gate — fleet-blind dashboards average away fleet-specific connectivity or ground-ops regressions.', how: 'Inject fleet_type as a tag from the flight-operations system based on the assigned aircraft.', when: 'At flight assignment.', where: 'Flight-operations services, in-flight-connectivity monitoring.', exampleValues: ['a320', 'b737', 'b777', 'a350'] },
      { key: 'distribution_channel', description: 'Booking distribution channel (direct, OTA, GDS, travel-agent)', why: 'GDS (Sabre/Amadeus/Travelport) and OTA integrations have very different latency and rate-limit profiles than the airline\'s own direct-booking site — a degraded GDS connection looks like a reservation-system-wide outage without this tag.', how: 'Inject distribution_channel as a span tag at the reservation-creation service based on the request source.', when: 'At instrumentation time.', where: 'APM spans for reservation services.', exampleValues: ['direct', 'ota', 'gds', 'travel-agent'] },
      { key: 'irregular_ops_flag', description: 'Irregular operations (IROPs) status flag', why: 'During IROPs (weather, ATC ground stops, mechanical issues), rebooking and customer-service system load spikes by an order of magnitude in a way that is entirely expected — this flag lets on-call teams distinguish expected IROPs-driven load from a genuine application regression.', how: 'Set irregular_ops_flag from the flight-operations system when a disruption event is declared, cleared when resolved.', when: 'During declared IROPs events.', where: 'Reservation, rebooking, and customer-service APM spans during the event window.', exampleValues: ['yes', 'no'] },
    ],
    optional: [
      { key: 'codeshare_partner', description: 'Codeshare/alliance partner airline for the flight', why: 'Codeshare flights operated by a partner airline route through interline system integrations with distinct failure modes from the airline\'s own operated flights.', how: 'Inject codeshare_partner as a tag from the flight-operations system when the flight is a codeshare.', when: 'At instrumentation time for codeshare flights.', where: 'APM spans for reservation and flight-operations services handling codeshares.', exampleValues: ['partner-star-alliance', 'partner-oneworld'] },
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
  {
    id: 'org-devops',
    name: 'DevOps / Platform Teams',
    category: 'org',
    description: 'Tagging model for DevOps and platform-operations teams centered on pipelines, deployment automation, and infrastructure-as-code.',
    icon: '🔧',
    detectSignals: ['pipeline', 'deployment_group', 'on_call_team', 'iac_module'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'pipeline', description: 'CI/CD pipeline name that built/deployed the resource', why: 'Ties every deployed resource back to the exact pipeline that shipped it — essential for tracing a bad deploy to its build and for pipeline-level DORA metrics (deployment frequency, change failure rate).', how: 'Inject pipeline:<name> from the CI/CD system as a tag on the deployment event and propagate it to the resulting hosts/containers via IaC variables.', when: 'At every deployment. Should be automatic, not hand-typed.', where: 'CI Visibility spans, hosts, containers, deployment events.', exampleValues: ['pipeline-checkout-deploy', 'pipeline-infra-terraform-apply'],
        resourceExamples: [
          { resource: 'rum', example: '// Not applicable directly — correlate via deployment markers instead:\ndatadogRum.init({ ..., version: "<pipeline-run-sha>" })', description: 'RUM has no native pipeline tag; teams typically encode the pipeline run\'s output version and cross-reference it against CI Visibility separately.' },
          { resource: 'logs', example: 'DD_TAGS=pipeline:pipeline-checkout-deploy  # set by the deploy step, on the deployed process/container', description: 'Injected by the CI/CD job itself as a runtime env var on the artifact it deploys, not set by hand on the log source.' },
          { resource: 'apm', example: 'DD_TAGS=pipeline:pipeline-checkout-deploy', description: 'A custom tag (not a unified service tag) that lets a bad-deploy investigation filter APM error spikes by the exact pipeline run that shipped the regression.' },
          { resource: 'agent', example: '# Set by the CI/CD job at deploy time, not a static datadog.yaml field\nDD_TAGS=pipeline:pipeline-checkout-deploy', description: 'Applied per-deploy from the pipeline\'s own context, analogous to how version is injected.' },
          { resource: 'integrations', example: '# CI Visibility auto-tags pipeline runs — see docs.datadoghq.com/continuous_integration', description: 'CI Visibility is the native product surface for pipeline-level tagging; propagate the same pipeline name to deployed resources for cross-product correlation.' },
        ] },
      { key: 'deployment_group', description: 'Deployment/release group or wave', why: 'Progressive delivery (canary waves, ring deployments) needs group-level rollback scope — without this tag, a bad rollout can only be rolled back all-or-nothing.', how: 'Set from the deployment orchestrator (Argo Rollouts, Spinnaker, custom pipeline) at rollout time as a host/pod label.', when: 'At deployment time, for every progressive rollout.', where: 'Hosts, Kubernetes pods, APM services during a rollout window.', exampleValues: ['wave-1', 'ring-canary', 'ring-broad'] },
    ],
    recommended: [
      { key: 'on_call_team', description: 'On-call team responsible for pipeline/infra incidents', why: 'DevOps/platform incidents (a broken pipeline, a bad Terraform apply) often need a different on-call rotation than the application team that owns the affected service.', how: 'Add on_call_team:<handle> to CI/CD infrastructure, IaC state-management systems, and shared platform hosts. Must match the PagerDuty/OpsGenie handle.', when: 'At platform service onboarding.', where: 'CI/CD infrastructure, IaC runners, shared platform hosts, monitors.', exampleValues: ['oncall-platform-infra', 'oncall-cicd'] },
      { key: 'iac_module', description: 'Infrastructure-as-code module or stack that provisioned the resource', why: 'When a Terraform/Pulumi module misbehaves (wrong instance size, missing security group), module-level tagging finds every resource it touched without re-reading the whole state file.', how: 'Inject iac_module:<name> as a default_tags block (Terraform) or resource tag (Pulumi/CloudFormation) at the module level.', when: 'At resource provisioning via IaC.', where: 'All cloud resources provisioned via IaC.', exampleValues: ['module-eks-cluster', 'module-rds-postgres', 'stack-networking-vpc'] },
      { key: 'runner_pool', description: 'CI/CD runner pool or agent fleet', why: 'Flaky or slow builds are frequently isolated to one self-hosted runner pool (e.g. a specific instance type or availability zone) — pool-level tagging catches that before blaming the pipeline definition itself.', how: 'Tag self-hosted runner hosts/containers with the pool they belong to at provisioning time.', when: 'At runner fleet provisioning.', where: 'Hosts and containers running CI/CD runners/agents.', exampleValues: ['runner-pool-linux-arm64', 'runner-pool-gpu'] },
      { key: 'deployment_strategy', description: 'Rollout strategy in effect', why: 'Blue-green, canary, and rolling deployments fail differently and need different anomaly-detection sensitivity during the rollout window — a strategy-blind alert either fires too often on canaries or misses a slow-burning blue-green regression.', how: 'Set from the CI/CD pipeline or deployment orchestrator at rollout time.', when: 'At deployment time.', where: 'Hosts, APM services during a rollout.', exampleValues: ['canary', 'blue-green', 'rolling', 'recreate'] },
    ],
    optional: [
      { key: 'terraform_workspace', description: 'Terraform workspace or state file identifier', why: 'Multi-workspace Terraform setups (per-env or per-team state) benefit from tracing a resource back to the exact state file managing it, especially during drift investigations.', how: 'Add terraform_workspace as a default tag in the workspace\'s provider block.', when: 'At workspace creation.', where: 'Cloud resources managed by that workspace.', exampleValues: ['ws-prod-us-east', 'ws-staging'] },
    ],
  },
  {
    id: 'org-sre',
    name: 'Site Reliability Engineering (SRE)',
    category: 'org',
    description: 'Tagging model for SRE teams centered on error budgets, SLO ownership, and incident escalation.',
    icon: '🛰️',
    detectSignals: ['slo_target', 'error_budget_policy', 'escalation_tier', 'runbook'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'slo_target', description: 'SLO target this service is measured against', why: 'SRE\'s core discipline is managing to an explicit reliability target — without a tagged target, dashboards can show uptime but not whether it meets the commitment that was actually made.', how: 'Add slo_target:<percentage> to services tied to a defined SLO. Keep in sync with the actual Datadog SLO object definition.', when: 'At SLO definition and whenever it is renegotiated.', where: 'APM services, SLOs, monitors.', exampleValues: ['99.9', '99.95', '99.99'],
        resourceExamples: [
          { resource: 'rum', example: 'datadogRum.setGlobalContextProperty("slo_target", "99.9")', description: 'Lets a front-end availability/Core Web Vitals SLO be filtered and compared against its own committed target directly from RUM data.' },
          { resource: 'logs', example: 'DD_TAGS=slo_target:99.9', description: 'Rarely set per-log-line; more useful attached to the service context so log-based SLI queries can be scoped per target tier.' },
          { resource: 'apm', example: 'DD_TAGS=slo_target:99.9', description: 'Complements the Datadog SLO object (which defines the target formally) by making the target queryable as a facet directly on spans for ad hoc analysis.' },
          { resource: 'agent', example: '# Not a host-level concept — set on the owning APM service/SLO object instead', description: 'SLO targets are service-scoped, not host-scoped; avoid duplicating this at the infrastructure layer.' },
          { resource: 'integrations', example: '# Define formally as a Datadog SLO object via Service Management → SLOs, then mirror the target as a service tag', description: 'The Datadog SLO object is the source of truth for alerting on burn rate; the tag is a convenience facet layered on top.' },
        ] },
      { key: 'error_budget_policy', description: 'Error budget policy/action tier in effect', why: 'What happens when a budget is exhausted (freeze releases, page a VP, require an incident review) is a documented policy, not a judgment call — tagging it makes escalation automation possible instead of relying on someone remembering the runbook.', how: 'Set error_budget_policy from the SLO error-budget policy document as a tag on the SLO and its owning service.', when: 'At SLO definition.', where: 'SLOs, APM services with a defined error budget.', exampleValues: ['freeze-releases', 'page-lead', 'standard-review'] },
    ],
    recommended: [
      { key: 'escalation_tier', description: 'Incident escalation tier', why: 'SRE on-call structures typically have a primary/secondary/manager escalation chain — tagging the tier lets paging automation and incident tooling route correctly without a separate lookup table.', how: 'Add escalation_tier to monitors and services, matching the PagerDuty/OpsGenie escalation policy tier.', when: 'At on-call rotation setup.', where: 'Monitors, SLOs, service catalog.', exampleValues: ['primary', 'secondary', 'manager-escalation'] },
      { key: 'runbook', description: 'Link or identifier for the incident runbook', why: 'Time-to-mitigate during an incident depends on the responder finding the right runbook immediately — attaching it as a tag on the monitor/service puts it one click away from the alert itself.', how: 'Add runbook:<url-or-id> to monitors and service catalog entries. Keep the underlying doc current — a stale runbook is worse than none.', when: 'At monitor creation and service onboarding.', where: 'Monitors, service catalog.', exampleValues: ['runbook-checkout-latency', 'https://wiki.company.com/runbooks/checkout'] },
      { key: 'toil_category', description: 'Category of recurring operational toil this resource generates', why: 'SRE teams track toil explicitly to justify automation investment — tagging the category on recurring manual-intervention alerts turns "we keep doing this by hand" into a quantifiable backlog item.', how: 'Tag monitors/runbooks that represent known manual-intervention toil with a category from your toil taxonomy.', when: 'When a recurring manual intervention is identified.', where: 'Monitors representing known toil sources.', exampleValues: ['manual-restart', 'manual-scaling', 'manual-failover'] },
      { key: 'slo_consumer', description: 'Downstream team or service consuming this SLO as a dependency', why: 'When an upstream SLO is breached, knowing exactly which downstream teams depend on it turns a vague "who does this affect" incident question into an immediate, accurate stakeholder list.', how: 'Tag the SLO with each known downstream consumer as it\'s onboarded as a dependency.', when: 'When a new consumer takes a dependency on the SLO.', where: 'SLOs.', exampleValues: ['consumer-checkout', 'consumer-mobile-api'] },
    ],
    optional: [
      { key: 'blameless_postmortem_id', description: 'Linked postmortem/incident-review document identifier', why: 'Traces a service\'s current mitigations directly back to the incident that produced them, useful when re-evaluating whether a fix is still relevant.', how: 'Add after an incident review is published, linking the affected service or monitor to the postmortem doc.', when: 'After a postmortem is completed.', where: 'Service catalog entries, monitors with a known incident history.', exampleValues: ['pm-2025-041', 'pm-checkout-outage-q1'] },
    ],
  },
  {
    id: 'org-platform-engineering',
    name: 'Platform Engineering / Internal Developer Platform',
    category: 'org',
    description: 'Tagging model for internal developer platform (IDP) teams offering self-service infrastructure and golden paths.',
    icon: '🧩',
    detectSignals: ['platform_team', 'service_tier', 'golden_path', 'scaffold_template'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'platform_team', description: 'Platform team providing the underlying capability', why: 'IDPs are built and run by a distinct platform org from the product teams consuming them — this tag separates "who owns the golden path" from "who owns the service built on it" so incidents route to the right owner.', how: 'Add platform_team:<name> to shared platform infrastructure (the IDP control plane, shared clusters, self-service provisioning services).', when: 'At platform capability launch.', where: 'IDP control-plane services, shared Kubernetes clusters, provisioning APIs.', exampleValues: ['platform-team-core', 'platform-team-data-infra'] },
      { key: 'service_tier', description: 'Service tier as declared in the platform\'s service catalog/scaffolding', why: 'IDPs typically gate capabilities (production access, higher quotas, on-call requirements) by declared tier at scaffold time — this tag is the source of truth the platform used to make those decisions, not a duplicate of a manually-set tier elsewhere.', how: 'Populate service_tier automatically from the scaffolding tool/service catalog entry at service creation — never hand-edit after the fact without updating the catalog.', when: 'At service scaffolding.', where: 'Service catalog entries, APM services, monitors.', exampleValues: ['tier-1', 'tier-2', 'tier-3'],
        resourceExamples: [
          { resource: 'rum', example: 'datadogRum.setGlobalContextProperty("service_tier", "tier-1")', description: 'Surfaces the platform-declared tier on front-end telemetry so RUM alert thresholds can match the same tier-based policy as backend services.' },
          { resource: 'logs', example: 'DD_TAGS=service_tier:tier-1  # set automatically by the scaffolding tool\'s generated deployment manifest', description: 'Propagated from the catalog entry into the generated manifest, not typed manually per log source.' },
          { resource: 'apm', example: 'DD_TAGS=service_tier:tier-1', description: 'Lets Service Catalog and APM Service pages both reflect the same platform-declared tier without a second source of truth drifting out of sync.' },
          { resource: 'agent', example: '# datadog.yaml (templated by the scaffolding tool)\ntags:\n  - service_tier:tier-1', description: 'Generated as part of the scaffolded service\'s Agent config, not hand-maintained.' },
          { resource: 'integrations', example: 'ad.datadoghq.com/<container>.tags: \'{"service_tier":"tier-1"}\'', description: 'Templated into the Kubernetes manifest produced by the scaffolding CLI at generation time.' },
        ] },
    ],
    recommended: [
      { key: 'golden_path', description: 'Golden path/paved-road template the service was created from', why: 'Services built from the same golden path share failure modes and upgrade needs — when a platform team patches a golden path (e.g. a security fix in the base image), this tag finds every service that needs the same fix applied.', how: 'Inject golden_path:<name> automatically at scaffold time from the internal developer portal (Backstage, Port, custom IDP).', when: 'At service scaffolding.', where: 'Service catalog entries, hosts, APM services.', exampleValues: ['golden-path-node-service', 'golden-path-python-worker'] },
      { key: 'scaffold_template', description: 'Exact scaffolding template version used to generate the service', why: 'Distinguishes services on an outdated scaffold version from ones on the latest — critical for tracking golden-path migration/deprecation campaigns and for security patch rollout.', how: 'Set scaffold_template:<name>@<version> automatically by the scaffolding CLI/portal at generation time.', when: 'At service scaffolding, and updated when the service upgrades its template.', where: 'Service catalog entries.', exampleValues: ['node-service@v3.2.0', 'python-worker@v1.8.1'] },
      { key: 'self_service_provisioned', description: 'Flag for infrastructure provisioned through the self-service platform (vs. manually)', why: 'IDP adoption metrics depend on distinguishing self-service-provisioned resources from legacy manually-provisioned ones — without this tag, adoption reporting requires manual reconciliation against ticket history.', how: 'Set self_service_provisioned:yes automatically for any resource created through the IDP\'s provisioning API/UI.', when: 'At resource provisioning.', where: 'Cloud resources, Kubernetes namespaces, databases provisioned via the platform.', exampleValues: ['yes', 'no'] },
      { key: 'capability', description: 'Self-service platform capability consumed (database, queue, cache, etc.)', why: 'Platform teams need capability-level reliability and cost data (e.g. "the managed Postgres capability" across every consuming team) to prioritize platform investment — service-level tags alone can\'t answer "how is this shared capability doing overall."', how: 'Tag provisioned resources with the capability name from the platform\'s service catalog.', when: 'At resource provisioning via the platform.', where: 'Databases, queues, caches, and other platform-provisioned resources.', exampleValues: ['managed-postgres', 'managed-kafka', 'managed-redis'] },
    ],
    optional: [
      { key: 'backstage_entity_ref', description: 'Backstage (or equivalent) catalog entity reference', why: 'Provides a direct, unambiguous link back to the developer-portal entity for a resource, useful for cross-referencing ownership and documentation without a separate lookup.', how: 'Set from the entity\'s catalog-info.yaml annotations at registration time.', when: 'At service catalog registration.', where: 'Service catalog entries.', exampleValues: ['component:default/checkout-api', 'component:default/payments-worker'] },
    ],
  },
  {
    id: 'org-product-led',
    name: 'Product-Led / Squad & Pod Structure',
    category: 'org',
    description: 'Tagging model for organizations structured around product pods/squads mapped to feature areas rather than technical layers.',
    icon: '🧭',
    detectSignals: ['product_area', 'feature_team', 'squad', 'pod'],
    globalBaseline: GLOBAL_BASELINE,
    required: [
      { key: 'product_area', description: 'Product area or business capability the resource serves', why: 'Product-led orgs report reliability and cost by product area to product leadership, not by technical team — without this tag, an engineering-org rollup (team) can\'t answer a product-org question (how is Search doing?).', how: 'Add product_area:<name> to all resources serving that product area, aligned with the product roadmap taxonomy.', when: 'At service onboarding.', where: 'All resources.', exampleValues: ['search', 'checkout', 'recommendations', 'onboarding'],
        resourceExamples: [
          { resource: 'rum', example: 'datadogRum.init({ ..., service: "checkout-web" });\ndatadogRum.setGlobalContextProperty("product_area", "checkout")', description: 'Lets product leadership view front-end Core Web Vitals and error rate rolled up by product area rather than by technical service name.' },
          { resource: 'logs', example: 'DD_TAGS=product_area:checkout  # or a pipeline processor mapping service -> product_area via a lookup table', description: 'Often derived via a Log Pipeline lookup-table processor mapping known service names to their product area, so individual services don\'t need to set it by hand.' },
          { resource: 'apm', example: 'DD_TAGS=product_area:checkout', description: 'Enables product-area rollup dashboards and SLOs distinct from the technical service/team view already provided by the Service Map.' },
          { resource: 'agent', example: '# datadog.yaml\ntags:\n  - product_area:checkout', description: 'Reasonable for hosts dedicated to a single product area; multi-tenant hosts should set it per-process instead.' },
          { resource: 'integrations', example: 'ad.datadoghq.com/<container>.tags: \'{"product_area":"checkout"}\'', description: 'Set via Autodiscovery annotation, typically templated by the service\'s Kubernetes manifest from its Service Catalog entry.' },
        ] },
      { key: 'pod', description: 'Cross-functional pod (eng + product + design) owning the resource', why: 'Pods are the actual unit of ownership and on-call in a pod-based org — team alone is often too coarse (multiple pods can share one "team" label in the org chart) to route an alert to the right daily standup.', how: 'Add pod:<name> to all resources a pod owns, alongside (not instead of) team.', when: 'At service onboarding and pod re-formation.', where: 'All resources.', exampleValues: ['pod-search-relevance', 'pod-checkout-conversion'] },
    ],
    recommended: [
      { key: 'feature_team', description: 'Feature team within a larger product area', why: 'Large product areas (e.g. Checkout) often split into multiple feature teams (payments, shipping, promotions) — this tag gives finer-grained ownership than product_area alone without requiring a full pod re-tagging exercise.', how: 'Add feature_team:<name> to resources owned by a specific feature team within a product area.', when: 'At service onboarding.', where: 'All resources.', exampleValues: ['feature-team-payments', 'feature-team-shipping'] },
      { key: 'squad', description: 'Squad grouping within a pod/tribe model', why: 'In Spotify-style squad/tribe structures, squad is the smallest addressable ownership unit — needed for squad-level velocity and reliability metrics that roll up into tribe/pod-level executive reporting.', how: 'Add squad:<name> to all resources owned by the squad.', when: 'At service onboarding.', where: 'All resources.', exampleValues: ['squad-search-ranking', 'squad-checkout-payments'] },
      { key: 'okr_alignment', description: 'Company/product OKR this resource\'s work is aligned to', why: 'Product-led orgs frequently need to show which infrastructure investment ties to which OKR for roadmap prioritization conversations — this tag makes that traceable without a separate spreadsheet.', how: 'Tag resources built specifically to support an active OKR initiative; remove or update when the OKR cycle ends.', when: 'At project kickoff for OKR-aligned initiatives.', where: 'Resources built for a specific OKR initiative.', exampleValues: ['okr-2025-q3-checkout-conversion', 'okr-2025-q3-search-latency'] },
      { key: 'experiment_id', description: 'Active product experiment/A-B test identifier', why: 'Product-led teams run frequent experiments — correlating system performance and error rates with the specific experiment variant serving traffic is essential to avoid attributing a bug to "the checkout flow" when it\'s really one experiment arm.', how: 'Inject experiment_id as a span/RUM tag from the experimentation platform SDK.', when: 'At instrumentation time, for services participating in experiments.', where: 'APM spans, RUM sessions.', exampleValues: ['exp-checkout-onepage-v2', 'exp-search-ranking-ml'] },
    ],
    optional: [
      { key: 'tribe', description: 'Tribe grouping multiple pods/squads around a broader mission', why: 'Provides the top-level rollup above pod/squad for VP-level product-org reporting, mirroring the tribe concept already used in org-engineering but scoped to product missions rather than technical domains.', how: 'Add tribe tag at the shared-infrastructure or namespace level covering multiple pods.', when: 'At org structure provisioning.', where: 'Shared resources spanning multiple pods within the tribe.', exampleValues: ['tribe-growth', 'tribe-core-shopping'] },
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
  {
    layer: 'Configuration Management (Ansible / Puppet / Chef)',
    where: 'Ansible playbooks, Puppet manifests, or Chef cookbooks that manage the Datadog Agent',
    mechanism: 'Set required tags through the Agent\'s `tags:` config list (or `DD_TAGS` env var) as a mandatory role/playbook variable with no default, and re-run the play across the fleet whenever the tag set changes — the standard hard-tagging path for hosts that aren\'t provisioned by cloud-native IaC.',
    catchesAt: 'deploy',
    outcome: 'Hosts managed by traditional config-management tooling get the same enforced, no-default tagging guarantee as cloud-provisioned resources, without needing a Terraform migration first.',
  },
  {
    layer: 'On-Prem Fleet Management (SCOM)',
    where: 'Microsoft SCOM (System Center Configuration Manager) management packs',
    mechanism: 'Map SCOM custom properties/object attributes for each managed Windows host to the Datadog Agent\'s `tags:` configuration (or `DD_TAGS`) via a management pack, then push a configuration refresh to affected hosts — the practical hard-tagging path for on-prem Windows estates that predate cloud/container tooling.',
    catchesAt: 'deploy',
    outcome: 'On-prem Windows hosts inherit tags from the same asset data SCOM already tracks, instead of requiring a separate manual tagging process.',
  },
  {
    layer: 'Datadog Fleet Automation',
    where: 'Fleet Automation → Configuration Management',
    mechanism: 'Push an updated Agent configuration (including the `tags:` list) to some or all Agents in the fleet directly from Datadog, in bulk, without touching each host\'s config file or waiting for a redeploy pipeline.',
    catchesAt: 'runtime',
    outcome: 'Tag gaps across an existing fleet can be closed in one action, independent of whichever provisioning tool (or none) originally stood the host up.',
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

export async function scoreAgainstTemplate(orgId: string, scanRunId: string, templateId: string): Promise<TemplateScore> {
  const allTemplates = [...INDUSTRY_TEMPLATES, ...ORG_TEMPLATES];
  const template = allTemplates.find((t) => t.id === templateId) ?? INDUSTRY_TEMPLATES[0];

  const db = getDatabase();
  const tagRows = await db<{ org_id: string; scan_run_id: string; tag_key: string; host_occurrence_count: number }>('tag_analysis')
    .select('tag_key', 'host_occurrence_count')
    .where({ org_id: orgId, scan_run_id: scanRunId });

  const totalHostsRow = await db('hosts')
    .count({ c: '*' })
    .where({ org_id: orgId, scan_run_id: scanRunId })
    .first() as { c: number | string } | undefined;
  const totalHosts = Number(totalHostsRow?.c ?? 1) || 1;

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

export async function detectRecommendedTemplate(orgId: string, scanRunId: string): Promise<string> {
  const db = getDatabase();
  const tagKeyRows = await db<{ org_id: string; scan_run_id: string; tag_key: string }>('tag_analysis')
    .select('tag_key')
    .where({ org_id: orgId, scan_run_id: scanRunId });
  const tagKeys = new Set(tagKeyRows.map((r) => r.tag_key));

  const serviceNameRows = await db<{ org_id: string; scan_run_id: string; service_name: string }>('services')
    .select('service_name')
    .where({ org_id: orgId, scan_run_id: scanRunId });
  const serviceNames = serviceNameRows.map((r) => r.service_name.toLowerCase());

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
