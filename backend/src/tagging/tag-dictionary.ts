/**
 * Authoritative tag dictionary derived from the Datadog Tagging Best Practices reference.
 * Every entry carries what/why/how/when/where to fully inform recommendations.
 */

export type TagPriority = 'critical' | 'high' | 'moderate' | 'low';
export type TagScope = 'global' | 'apm' | 'infra' | 'rum' | 'dbm' | 'ndm' | 'cnm' | 'integrations';

export interface TagDefinition {
  key: string;
  priority: TagPriority;
  scope: TagScope[];
  exampleValues: string[];
  what: string;    // What is this tag
  why: string;     // Why you need it (business value)
  how: string;     // How to apply it (mechanics)
  when: string;    // When to apply it (timing/lifecycle)
  where: string;   // Where to apply it (resource types/products)
  aliases?: string[]; // Known synonym keys
}

export const TAG_DICTIONARY: TagDefinition[] = [
  {
    key: 'env',
    priority: 'critical',
    scope: ['global'],
    exampleValues: ['prod', 'staging', 'dev', 'qa'],
    what: 'The environment in which the service or application is running.',
    why: 'Ensures critical production telemetry can be isolated from test noise. Essential for enabling appropriate monitoring, alerting, SLO scoping, and access control. Without it, you cannot filter dashboards or alerts by environment.',
    how: 'Set DD_ENV environment variable in all application deployments. For hosts, add env:<value> to extra_tags in datadog.yaml. For Kubernetes, use the Datadog Admission Controller or pod annotations (tags.datadoghq.com/env). For monitors and synthetics, add env:<value> to the tags array.',
    when: 'Apply at resource provisioning time — before any telemetry flows. This is a Day 0 tag. Enforce it in CI/CD pipelines so no service can be deployed without it.',
    where: 'Hosts, containers, APM services (spans/traces), monitors, synthetics tests, logs (via pipeline processor), RUM sessions, service catalog entries, SLOs.',
    aliases: ['environment', 'stage', 'deploy_env', 'deployment_env'],
  },
  {
    key: 'service',
    priority: 'critical',
    scope: ['apm', 'integrations'],
    exampleValues: ['auth-server', 'middleware', 'api-gateway', 'payment-processor'],
    what: 'Defines the specific service or function being monitored. Should be descriptive, concise, and consistent across all telemetry.',
    why: 'Core UST tag — powers the Service Map, service-level SLOs, Deployment Tracking, and APM error attribution. Without it, you cannot connect infrastructure metrics to application traces, or route alerts to the correct team.',
    how: 'Set DD_SERVICE environment variable in all app runtimes. For hosts running a single service, add service:<name> to extra_tags. For Kubernetes, use pod annotations (tags.datadoghq.com/service) or the Admission Controller. For logs, use a remapper processor to set service from the application\'s log field.',
    when: 'Apply at service creation time in the service registry. Enforce via CI/CD — the service name in Datadog must match the service catalog name exactly. Never change the service name without a migration plan, as it breaks historical continuity.',
    where: 'APM spans and traces, hosts, containers, monitors, synthetics, logs, RUM sessions, service catalog. Must be identical across all surfaces for the Service Map to connect them.',
    aliases: ['app', 'application', 'service_name', 'svc', 'microservice', 'app_name'],
  },
  {
    key: 'version',
    priority: 'high',
    scope: ['apm'],
    exampleValues: ['2.1.3', 'v1.0.0', '06142ee', 'release-2024-01-15'],
    what: 'Specifies the version of the application or service being deployed. Can be semantic versioning, git SHA, or release tag.',
    why: 'Essential for Deployment Tracking — enables automatic comparison of error rates and latency between the current and previous version. Without it, you cannot determine whether a new release introduced a regression. Critical for compliance with release management practices.',
    how: 'Set DD_VERSION environment variable in the application runtime. For containers, inject the image tag or git SHA at build time via the CI/CD pipeline. For Kubernetes, use pod annotations (tags.datadoghq.com/version). Never hardcode — it must change with every deployment.',
    when: 'Apply at build time and inject during deployment. The version must be updated with every release — including hotfixes and canary deployments. Use the same value across DD_VERSION, Docker image tag, and git tag.',
    where: 'APM services (required for Deployment Tracking), hosts running the application, monitors that alert on release-specific issues. Also useful in RUM for correlating frontend errors to backend releases.',
    aliases: ['ver', 'release', 'app_version', 'release_version', 'deploy_version', 'image_tag'],
  },
  {
    key: 'team',
    priority: 'critical',
    scope: ['global'],
    exampleValues: ['integrations', 'sre', 'devops', 'platform', 'payments-team'],
    what: 'Identifies the engineering team responsible for the service or application. Should match Datadog Teams exactly.',
    why: 'Enables alert routing, incident ownership, and accountability. Facilitates communication during incidents by identifying who to page. Required for team-level SLO reporting and cost chargeback. Without it, alerts have no owner and incidents escalate without clear responsibility.',
    how: 'Add team:<name> to all resources owned by the team. The value must match the Datadog Teams handle exactly (case-insensitive, no spaces — use hyphens). Set it in agent extra_tags for infrastructure, pod annotations for Kubernetes, and explicitly in monitor and synthetics tag arrays. Use the DD_ENV block in datadog.yaml for host-level defaults.',
    when: 'Apply when a service is created and assigned to a team. Update immediately on team reorganizations. Enforce in service onboarding checklists and CI/CD pipelines. This tag must never be absent on any production resource.',
    where: 'All resources: hosts, containers, APM services, monitors (for routing to the correct notification channel), synthetics, dashboards, SLOs, service catalog entries.',
    aliases: ['squad', 'team_name', 'group', 'engineering_team'],
  },
  {
    key: 'journey',
    priority: 'critical',
    scope: ['rum', 'apm'],
    exampleValues: ['login', 'checkout', 'browsing', 'registration', 'file_upload', 'password_reset', 'order_tracking'],
    what: 'Tracks key user journeys across various application flows — login, checkout, browsing, registration, etc.',
    why: 'Ensures high reliability and performance of critical user flows. Enables correlation between RUM session errors and backend APM traces for the same journey. Without it, you cannot measure the end-to-end health of a user-facing business flow or prioritize which journeys to optimize for revenue impact.',
    how: 'In RUM, set the custom attribute view.name or use RUM Actions with the journey tag. In APM, add journey:<name> to span tags at the entry point of each user-facing operation (e.g., the controller action or API handler). Use consistent journey names across RUM and APM for proper correlation.',
    when: 'Apply when instrumenting user-facing features. Map journeys during product planning and enforce tagging in code review. Add new journey values when launching new user flows.',
    where: 'RUM sessions and views (primary), APM spans for backend operations that serve user journeys, monitors that alert on journey-level SLOs.',
  },
  {
    key: 'application',
    priority: 'critical',
    scope: ['global'],
    exampleValues: ['store-platform', 'payments', 'ads', 'identity', 'data-platform'],
    what: 'Identifies how services and resources are grouped into a larger business workload or application. Represents the internal application name — may contain multiple microservices.',
    why: 'Enables grouping, organizing, and filtering of all resources related to a large business application (microservices, hosts, containers). Powers effective monitoring, performance analysis, and alignment of applications with business goals. Without it, you cannot produce application-level scorecards or rollup dashboards.',
    how: 'Define your application taxonomy first — what counts as one "application." Add application:<name> to all resources belonging to that application in agent extra_tags, pod labels/annotations, and explicitly in monitors and dashboards. The application tag sits above the service tag in the hierarchy.',
    when: 'Apply when onboarding a new business application or workload. Update when applications are split or merged. This is a strategic tag — changes should go through architecture review.',
    where: 'All resource types: hosts, containers, APM services, monitors, dashboards, synthetics, logs, service catalog entries.',
    aliases: ['app_group', 'workload'],
  },
  {
    key: 'runtime',
    priority: 'high',
    scope: ['infra'],
    exampleValues: ['apache', 'tomcat', 'weblogic', 'nginx', 'nodejs', 'jvm', 'dotnet'],
    what: 'Names the application runtime or software stack being used on a host or container.',
    why: 'Provides insight into the technology stack for configuration management, vulnerability assessment, and resource allocation. Enables filtering dashboards by runtime type and correlating runtime-specific metrics (JVM GC, .NET CLR, etc.).',
    how: 'Add runtime:<name> to host extra_tags in datadog.yaml or via the Datadog Agent integration config. For containers, inject as a Docker label or Kubernetes annotation. The integration detection may auto-populate this for well-known runtimes.',
    when: 'Apply when provisioning infrastructure or containerizing services. Update when the runtime is upgraded.',
    where: 'Hosts and containers running application workloads. Particularly important for infrastructure metrics and APM language-specific dashboards.',
  },
  {
    key: 'role',
    priority: 'high',
    scope: ['global'],
    exampleValues: ['web', 'app', 'cache', 'api', 'worker', 'database', 'queue', 'gateway'],
    what: 'Describes the functional role of the service or component within the system architecture.',
    why: 'Essential for understanding component dependencies and enabling effective monitoring of the overall system. Allows filtering by architecture layer (e.g., all API gateways, all caches). Enables role-based dashboards and capacity planning.',
    how: 'Add role:<value> to agent extra_tags or pod annotations. Define a fixed taxonomy of roles in your tagging standards document and enforce it. For NDM devices, role (or device_purpose) describes the network function (bgp-internet-uplink, core-switch).',
    when: 'Apply at service or host provisioning time. Update when the architectural role of a component changes.',
    where: 'Global — hosts, containers, APM services, monitors. Also used in NDM (role or device_purpose for network devices) and CNM (for container network roles).',
    aliases: ['device_purpose', 'purpose', 'component_type'],
  },
  {
    key: 'tier',
    priority: 'moderate',
    scope: ['global'],
    exampleValues: ['0', '1', '2', '3'],
    what: 'Indicates the criticality or priority level of the service. Tier 0 = most critical (direct revenue/safety impact), Tier 3 = lowest priority.',
    why: 'Essential for prioritizing monitoring efforts, on-call rotations, and incident management. Allows SRE and platform teams to allocate resources and set SLOs proportionally to business criticality. Without it, all services are treated equally, leading to alert fatigue.',
    how: 'Add tier:<0|1|2|3> to all services in the service catalog and propagate to hosts, monitors, and SLOs via extra_tags or annotations. Define tier definitions in your runbook and enforce during service onboarding. Tier 0 services must have stricter SLOs and 24/7 coverage.',
    when: 'Assign tiers during service onboarding. Review and update quarterly — business criticality can change with product strategy.',
    where: 'APM services (primary), hosts, monitors (use tier in monitor tags to set appropriate priority levels), synthetics (Tier 0 services require multi-region synthetics), SLOs.',
  },
  {
    key: 'backup',
    priority: 'moderate',
    scope: ['infra', 'dbm'],
    exampleValues: ['bronze', 'silver', 'gold'],
    what: 'Classifies the backup and recovery strategy for the resource. Bronze = basic daily backup, Silver = frequent backup with short retention, Gold = continuous backup with long retention.',
    why: 'Critical for ensuring data protection and business continuity. Enables FinOps teams to correlate backup tier with cost and verify RTO/RPO commitments are being met. Without it, backup coverage gaps are invisible in dashboards.',
    how: 'Add backup:<tier> to database instances, storage volumes, and hosts with stateful workloads via agent extra_tags or cloud provider tags (which then sync to Datadog via integration). Use the same values consistently across cloud tags and Datadog tags.',
    when: 'Apply during database provisioning and storage allocation. Review when SLAs change. Update immediately if the backup policy for a resource changes.',
    where: 'Infrastructure hosts with persistent storage, database instances (DBM), cloud storage resources.',
  },
  {
    key: 'platform',
    priority: 'moderate',
    scope: ['global'],
    exampleValues: ['middleware', 'ecosystem', 'common-platform', 'cloud-native', 'legacy'],
    what: 'Specifies the underlying platform or ecosystem on which the service operates.',
    why: 'Critical for understanding infrastructure dependencies, facilitating integration, and ensuring compatibility and standardization. Enables platform-level dashboards and capacity planning across all services running on the same platform.',
    how: 'Add platform:<name> to agent extra_tags for hosts belonging to a platform, or set it as a Kubernetes cluster-wide label so it is inherited by all pods. Include in service catalog entries.',
    when: 'Apply during platform onboarding. Update when a service migrates from one platform to another.',
    where: 'All resources within a given platform — hosts, containers, APM services, monitors, dashboards.',
  },
  {
    key: 'product',
    priority: 'moderate',
    scope: ['global'],
    exampleValues: ['crm', 'cms', 'payments', 'identity', 'analytics'],
    what: 'Identifies the business product or application domain that the service supports.',
    why: 'Enables alignment of monitoring with business objectives. Allows product managers and business stakeholders to view performance dashboards per product. Supports cost attribution and P&L reporting at the product level.',
    how: 'Add product:<name> to all resources supporting the product via extra_tags. Maintain a product taxonomy in the service catalog and enforce it during service onboarding.',
    when: 'Apply when a service is created and associated with a product. Update when the service\'s product association changes.',
    where: 'APM services, hosts, monitors, dashboards, SLOs, service catalog.',
  },
  {
    key: 'network',
    priority: 'moderate',
    scope: ['infra'],
    exampleValues: ['dmz', 'internal', 'external', 'management', 'storage'],
    what: 'Describes the network segment where the service is running — DMZ, internal, external, management, etc.',
    why: 'Important for understanding network security posture, traffic patterns, and potential vulnerabilities. Enables network security teams to filter dashboards by segment and detect unexpected cross-segment communication. Required for zero-trust network architecture visibility.',
    how: 'Add network:<segment> to host extra_tags or cloud provider subnet tags (which sync via integration). For containers, add as a pod annotation or Kubernetes namespace label.',
    when: 'Apply at host provisioning time. Update if the host is moved to a different network segment.',
    where: 'Infrastructure hosts, cloud instances, containers. Correlates with NPM/CNM for network flow analysis.',
  },
  {
    key: 'compliance',
    priority: 'low',
    scope: ['infra', 'dbm'],
    exampleValues: ['pci-dss', 'non-pci', 'sox', 'fedramp', 'gdpr', 'hipaa', 'iso27001'],
    what: 'Specifies the compliance standards or regulations applicable to the service or resource.',
    why: 'Essential for scoping compliance controls, managing regulatory risk, and maintaining audit evidence. Without it, you cannot automate compliance dashboards or ensure that only approved configurations are applied to regulated resources.',
    how: 'Add compliance:<standard> as a host tag or cloud provider tag. For resources in scope for multiple standards, apply multiple compliance tags (e.g., compliance:pci-dss and compliance:sox). Sync with your asset management system to ensure consistency.',
    when: 'Apply during infrastructure provisioning when compliance scope is determined. Review annually or after regulatory audits. Update immediately when scope changes.',
    where: 'Infrastructure hosts, database instances (DBM), cloud resources in regulated environments.',
  },
  {
    key: 'datatype',
    priority: 'low',
    scope: ['dbm'],
    exampleValues: ['financial', 'phi', 'pii', 'public', 'internal'],
    what: 'Identifies the type of sensitive data handled by the service or stored in the database.',
    why: 'Critical for data classification, enabling appropriate security controls, and ensuring compliance with GDPR, HIPAA, and PCI-DSS. Without it, you cannot automate data access controls or produce data lineage reports required by regulators.',
    how: 'Add datatype:<classification> to database instances and hosts that handle sensitive data. Use consistent classification levels across your organization. Apply via cloud provider tags on RDS/Aurora instances and sync to Datadog.',
    when: 'Apply when provisioning databases or when the data classification of a resource is determined. Review annually as part of data governance processes.',
    where: 'Database instances (DBM), hosts handling sensitive data, cloud storage resources.',
  },
  {
    key: 'datacenter',
    priority: 'moderate',
    scope: ['infra', 'dbm', 'ndm', 'cnm'],
    exampleValues: ['us-east-1-dc', 'eu-west-dc', 'on-prem-nyc', 'fdc', 'mdc', 'wdc'],
    what: 'Specifies the physical or logical data center location where the service is hosted.',
    why: 'Important for latency management, disaster recovery planning, data residency compliance, and geographic performance analysis. Enables filtering by location for capacity planning and failover orchestration.',
    how: 'Add datacenter:<name> to agent extra_tags in datadog.yaml for on-premises hosts. For cloud resources, map the cloud region to your internal data center naming. For NDM, apply as a device tag to all managed network devices in that location.',
    when: 'Apply during host and device provisioning. Critical for disaster recovery scenarios — apply before DR drills so runbooks can filter by datacenter.',
    where: 'Infrastructure hosts, network devices (NDM), cloud instances, database instances (DBM), container hosts.',
    aliases: ['data_center', 'location', 'site'],
  },
  {
    key: 'location',
    priority: 'moderate',
    scope: ['ndm'],
    exampleValues: ['location1', 'nyc-hq', 'london-office', 'site-a'],
    what: 'Identifies the physical location or site of a network device. Often interchangeable with site — choose whichever makes sense for your organization.',
    why: 'Enables network admins to quickly identify the location of a device when troubleshooting in NDM dashboards. Without it, all devices appear locationless and MTTD increases during network incidents.',
    how: 'Add location:<site> to SNMP device tags in the Datadog Agent SNMP integration config or via the NDM device tagging API. Align with your network naming convention (typically aligned to if-descr or interface_alias).',
    when: 'Apply when onboarding network devices to NDM. Update when devices are physically relocated.',
    where: 'Network devices in NDM (routers, switches, firewalls). Also useful in CNM for container network topology.',
    aliases: ['site'],
  },
  {
    key: 'subnet',
    priority: 'moderate',
    scope: ['cnm', 'ndm', 'dbm'],
    exampleValues: ['10.0.1.0/24', 'subnet-prod-web', 'subnet-db-tier'],
    what: 'Identifies the logical IP subnet or network subdivision where the resource resides.',
    why: 'Makes it easier to quickly identify which subnet an issue is occurring in during network troubleshooting — significantly reducing MTTD and MTTR. Essential for CNM container flow analysis and NDM device segmentation.',
    how: 'For CNM, the Datadog Network Performance Monitoring agent auto-populates subnet from the host\'s network configuration. For NDM, add subnet:<cidr> to SNMP device tags. For DBM, add as a host-level tag on database hosts.',
    when: 'Apply at provisioning time for network devices and database hosts. For CNM, this is typically auto-detected.',
    where: 'Network devices (NDM), container flows (CNM), database hosts (DBM).',
  },
];

// Build a lookup map by key for fast access
export const TAG_DICTIONARY_MAP = new Map<string, TagDefinition>(
  TAG_DICTIONARY.map((t) => [t.key, t])
);

// Also index by alias
export const TAG_ALIAS_MAP = new Map<string, string>();
for (const def of TAG_DICTIONARY) {
  for (const alias of def.aliases ?? []) {
    TAG_ALIAS_MAP.set(alias.toLowerCase(), def.key);
  }
}

export function lookupTag(key: string): TagDefinition | undefined {
  const normalized = key.toLowerCase().replace(/[-.\s]/g, '_');
  return TAG_DICTIONARY_MAP.get(normalized)
    ?? TAG_DICTIONARY_MAP.get(TAG_ALIAS_MAP.get(normalized) ?? '');
}

export function getPriorityOrder(priority: TagPriority): number {
  return { critical: 0, high: 1, moderate: 2, low: 3 }[priority] ?? 4;
}
