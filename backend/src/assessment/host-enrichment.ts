// Shared per-host raw_json parsing + product-recommendation heuristics.
// Used by the Instrumentation Gaps analysis (host-gaps.ts) and the Inventory
// Explorer hosts table, so both surfaces read cloud metadata and installed
// checks the same way.

// Mirrors infrastructure.collector.ts's CLOUD_SOURCE_MAP — duplicated locally
// (rather than imported) since that map is a collector implementation detail,
// not a shared contract. Kept in sync manually if the collector's map changes.
const CLOUD_SOURCE_MAP: Record<string, string> = {
  'amazon web services': 'aws', 'amazon ec2': 'aws', 'aws': 'aws',
  'google cloud platform': 'gcp', 'google compute engine': 'gcp', 'gcp': 'gcp',
  'azure': 'azure', 'microsoft azure': 'azure',
  'kubernetes': 'kubernetes', 'kubernetes-labels': 'kubernetes', 'kubernetes-annotations': 'kubernetes',
  'docker': 'docker',
};

// Common cloud-provider tag keys carrying region/AZ/instance-type — best-effort,
// since Datadog doesn't expose these as first-class host fields, only as tags.
const REGION_KEYS = ['region', 'aws:region'];
const AZ_KEYS = ['availability-zone', 'availability_zone', 'zone'];
const INSTANCE_TYPE_KEYS = ['instance-type', 'instance_type'];

interface RawHost {
  tags_by_source?: Record<string, string[]>;
  apps?: string[];
}

export function parseTagsFlat(tags: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of tags) {
    const i = tag.indexOf(':');
    if (i === -1) continue;
    const key = tag.slice(0, i).toLowerCase().trim();
    const value = tag.slice(i + 1).trim();
    if (!map.has(key)) map.set(key, value); // first value wins, mirrors typical single-value tags
  }
  return map;
}

export interface ParsedHostMeta {
  cloudProvider: string;
  region: string | null;
  availabilityZone: string | null;
  instanceType: string | null;
  envTag: string | null;
  serviceTag: string | null;
  installedChecks: string[];
}

export function parseHostRawJson(rawJson: string | null): ParsedHostMeta {
  let raw: RawHost = {};
  try { raw = rawJson ? JSON.parse(rawJson) as RawHost : {}; } catch { /* malformed snapshot */ }

  const flatTags = Object.values(raw.tags_by_source ?? {}).flat();
  const tagMap = parseTagsFlat(flatTags);

  let cloudProvider = 'on-prem/unknown';
  for (const source of Object.keys(raw.tags_by_source ?? {})) {
    const mapped = CLOUD_SOURCE_MAP[source.toLowerCase()];
    if (mapped && mapped !== 'kubernetes' && mapped !== 'docker') { cloudProvider = mapped; break; }
    if (mapped && cloudProvider === 'on-prem/unknown') cloudProvider = mapped;
  }

  return {
    cloudProvider,
    region: REGION_KEYS.map((k) => tagMap.get(k)).find(Boolean) ?? null,
    availabilityZone: AZ_KEYS.map((k) => tagMap.get(k)).find(Boolean) ?? null,
    instanceType: INSTANCE_TYPE_KEYS.map((k) => tagMap.get(k)).find(Boolean) ?? null,
    envTag: tagMap.get('env') ?? null,
    serviceTag: tagMap.get('service') ?? null,
    installedChecks: (raw.apps ?? []).map((a) => a.toLowerCase().trim()),
  };
}

export interface ProductRecommendation {
  product: string;
  icon: string;
  reason: string;
}

// Datadog's Hosts API has no per-host boolean for "is CSPM/CWS/NPM enabled" —
// those are Agent-side modules, not entries in the installed-checks ("apps")
// list, so their presence can't be detected directly. The heuristic below
// mirrors how a Datadog SE would triage a host: an un-traced or unidentified
// host needs APM before anything else; a host that's already traced is a
// natural next candidate for the products that layer on top of it.
export function recommendProductsForHost(hasApm: boolean, isBlindSpot: boolean): ProductRecommendation[] {
  if (isBlindSpot) {
    return [{
      product: 'APM Tracing', icon: '🔵',
      reason: 'No env/service tag or trace signal on this host — instrument it before layering on other products.',
    }];
  }
  if (!hasApm) {
    return [{
      product: 'APM Tracing', icon: '🔵',
      reason: 'Tagged but not traced — add the ddtrace library for request-level visibility.',
    }];
  }
  return [
    { product: 'Cloud Security (CSPM)', icon: '🛡️', reason: 'Already traced — CSPM adds misconfiguration scanning with no code changes.' },
    { product: 'Workload Security (CWS)', icon: '🔒', reason: 'Already traced — CWS adds kernel-level runtime threat detection.' },
    { product: 'Network Monitoring (NPM)', icon: '🌐', reason: 'Already traced — NPM adds network path visibility to this host\'s dependencies.' },
  ];
}
