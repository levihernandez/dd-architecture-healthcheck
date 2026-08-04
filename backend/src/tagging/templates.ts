import { getDatabase } from '../db/database';

export interface TemplateTag {
  key: string;
  description: string;
  why: string;
  how: string;
  when: string;
  where: string;
  exampleValues?: string[];
}

export interface IndustryTemplate {
  id: string;
  name: string;
  category: 'industry' | 'org';
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
  },
  {
    key: 'service',
    description: 'Logical service name — must match APM service identifier exactly',
    why: 'Powers the Service Map, service-level SLOs, and Deployment Tracking. Enables alert routing to the right team.',
    how: 'Set DD_SERVICE in all app runtimes. For hosts, add service:<name> to extra_tags. For K8s, use pod annotations. For logs, use a remapper processor to normalize the service field.',
    when: 'At service creation time. The name must never change without a migration plan — historical continuity breaks.',
    where: 'APM spans, hosts, containers, monitors, synthetics, logs, RUM, service catalog.',
    exampleValues: ['auth-server', 'api-gateway', 'payment-processor'],
  },
  {
    key: 'version',
    description: 'Application version, git SHA, or release tag',
    why: 'Required for Deployment Tracking — auto-compares error rates between current and previous release. Mandated by most change management processes.',
    how: 'Set DD_VERSION in all app runtimes. Inject the Docker image tag or git SHA at build time. The value must update with every deployment, including hotfixes.',
    when: 'At build time. Use the CI/CD pipeline to inject automatically so it is never forgotten.',
    where: 'APM traces (required for Deployment Tracking), hosts running the app, RUM sessions.',
    exampleValues: ['2.1.3', 'v1.0.0', '06142ee'],
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
    description: 'Universal tagging baseline. Start here before applying any sector-specific extensions.',
    icon: '⬡',
    globalBaseline: GLOBAL_BASELINE,
    required: [],
    recommended: [
      { key: 'application', description: 'Business application grouping for microservices', why: 'Rolls up multiple microservices into one business application view for executive dashboards.', how: 'Add application:<name> to all resources in the application. Align with service catalog taxonomy.', when: 'At application onboarding.', where: 'All resources.', exampleValues: ['store-platform', 'payments', 'identity'] },
      { key: 'tier', description: 'Service criticality (0=most critical, 3=lowest)', why: 'Drives SLO targets, on-call schedules, and alert priority. Tier 0 requires 24/7 coverage.', how: 'Add tier:<0|1|2|3> to services. Define tier criteria in your runbook.', when: 'At service onboarding. Review quarterly.', where: 'APM services, monitors, SLOs.', exampleValues: ['0', '1', '2', '3'] },
      { key: 'region', description: 'Cloud or geographic region', why: 'Enables geographic performance analysis and latency attribution by region.', how: 'Auto-populated by cloud integrations or add manually via extra_tags.', when: 'At provisioning.', where: 'Hosts, cloud instances.', exampleValues: ['us-east-1', 'eu-west-1'] },
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
    ],
    optional: [
      { key: 'sox_scope', description: 'SOX control scope flag', why: 'SOX requires evidence of controls over financial reporting systems.', how: 'Apply sox_scope:in-scope to all systems that contribute to financial reporting.', when: 'During SOX scoping exercises with internal audit.', where: 'Hosts, database instances, APM services in the financial reporting path.', exampleValues: ['in-scope', 'out-of-scope'] },
    ],
    complianceTags: [
      { key: 'pci_scope', standard: 'PCI DSS', note: 'Required for cardholder data environment scoping. In-scope systems must meet all 12 PCI DSS requirements.' },
      { key: 'data_classification', standard: 'GDPR/CCPA', note: 'Required for data protection impact assessments and automated access control enforcement.' },
    ],
  },

  // ─ FinTech / Payments ────────────────────────────────────────────────────────
  {
    id: 'fintech',
    name: 'FinTech / Payments',
    category: 'industry',
    description: 'For payment processors, neobanks, and financial technology platforms.',
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
    ],
    optional: [],
    complianceTags: [
      { key: 'pci_scope', standard: 'PCI DSS', note: 'Mandatory for all payment card processing systems.' },
    ],
  },

  // ─ Healthcare ─────────────────────────────────────────────────────────────
  {
    id: 'healthcare',
    name: 'Healthcare / Life Sciences',
    category: 'industry',
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
    ],
    optional: [],
  },

  // ─ Energy / Utilities ────────────────────────────────────────────────────
  {
    id: 'energy',
    name: 'Energy & Utilities',
    category: 'industry',
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

// ─── Scoring ──────────────────────────────────────────────────────────────────

export interface TemplateScore {
  industry: string;
  templateName: string;
  category: 'industry' | 'org';
  overallScore: number;
  complianceScore: number;
  baselineScore: number;
  globalBaseline: Array<{ key: string; description: string; why: string; how: string; when: string; where: string; found: boolean; coverage: number; foundKey: string | null }>;
  required: Array<{ key: string; description: string; why: string; how: string; when: string; where: string; found: boolean; coverage: number; foundKey: string | null }>;
  recommended: Array<{ key: string; description: string; found: boolean; coverage: number }>;
  optional: Array<{ key: string; description: string; found: boolean }>;
  complianceTags: Array<{ key: string; standard: string; note: string; found: boolean }>;
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

  const baselineFound = globalBaseline.filter((t) => t.found).length;
  const requiredFound = required.filter((t) => t.found).length;
  const recommendedFound = recommended.filter((t) => t.found).length;
  const complianceFound = complianceTags.filter((t) => t.found).length;

  const baselineScore = Math.round((baselineFound / Math.max(globalBaseline.length, 1)) * 100);
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
    globalBaseline,
    required,
    recommended,
    optional,
    complianceTags,
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
