import { useState } from 'react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { taggingApi } from '../../services/api';
import { useOrgAndScanFilters } from '../../hooks/useFilters';
import type { MaturityAssessmentResult, RemediationExecutionResult } from '../../types';

interface ContextTag {
  key: string;
  description: string;
  example: string;
}

type Source = 'cloud' | 'agent' | 'datacenter' | 'unified' | 'industry';

interface TimelineStep {
  step: number;
  source: Source;
  title: string;
  when: string;
  description: string;
  namingNote?: string;
  example: string;
}

const SOURCE_COLOR: Record<Source, string> = {
  cloud: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  agent: 'border-violet-500/30 bg-violet-500/10 text-violet-400',
  datacenter: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  unified: 'border-green-500/30 bg-green-500/10 text-green-400',
  industry: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
};

// Hex equivalents of the classes above — canvas/SVG export can't read Tailwind
// utility classes, so the rasterized graph needs its own literal color table.
const SOURCE_SVG_COLOR: Record<Source, { bg: string; stroke: string; text: string }> = {
  cloud: { bg: 'rgba(59,130,246,0.12)', stroke: '#3b82f6', text: '#60a5fa' },
  agent: { bg: 'rgba(139,92,246,0.12)', stroke: '#8b5cf6', text: '#a78bfa' },
  datacenter: { bg: 'rgba(245,158,11,0.12)', stroke: '#f59e0b', text: '#fbbf24' },
  unified: { bg: 'rgba(34,197,94,0.12)', stroke: '#22c55e', text: '#4ade80' },
  industry: { bg: 'rgba(244,63,94,0.12)', stroke: '#f43f5e', text: '#fb7185' },
};

const SOURCE_LABEL: Record<Source, string> = {
  cloud: 'Cloud provider (automatic)',
  agent: 'Datadog Agent (you configure)',
  datacenter: 'Datacenter / on-prem (you configure)',
  unified: 'Unified tagging (you enforce)',
  industry: 'Industry template (this org)',
};

// Detects whichever tag in the *currently selected* industry template
// identifies a physical instance/site — a cruise line has "ship", retail has
// "store", healthcare has "clinic", banking might have "branch", and so on.
// This must stay driven by industryTags (not hardcoded) so switching the
// template actually changes the examples shown below.
const INSTANCE_KEY_PATTERN = /ship|vessel|store|branch|site|facility|location|plant|property|hotel|restaurant|clinic|hospital|campus|terminal|warehouse|fleet|device|dealership|unit_id/i;

function humanizeInstanceLabel(key: string): string {
  return key.replace(/_id$/i, '').replace(/_/g, ' ').trim() || 'location';
}

// Everything provider-specific in the examples below (auto-tags, hybrid
// hardware naming, serverless/DB product names) is driven off this config so
// switching the pill actually changes the copy instead of assuming AWS.
type CloudProvider = 'aws' | 'azure' | 'gcp';

interface ProviderConfig {
  label: string;
  cloudProviderTag: string;
  region: string;
  az: string;
  rawEnvExample: string;
  hybridHardwareName: string;
  hybridIdTagKey: string;
  hybridIdExample: string;
  serverlessProduct: string;
  serverlessIdTag: string;
  serverlessIdExample: string;
  databaseProduct: string;
  dbIdTag: string;
  dbIdExample: string;
}

const PROVIDER_CONFIG: Record<CloudProvider, ProviderConfig> = {
  aws: {
    label: 'AWS', cloudProviderTag: 'aws', region: 'us-east-1', az: 'us-east-1a', rawEnvExample: 'Environment:prod',
    hybridHardwareName: 'AWS Outposts', hybridIdTagKey: 'outpost_id', hybridIdExample: 'op-1234abcd5678efghi',
    serverlessProduct: 'AWS Lambda function', serverlessIdTag: 'functionname', serverlessIdExample: 'checkout-webhook',
    databaseProduct: 'Managed DB (RDS)', dbIdTag: 'dbinstanceidentifier', dbIdExample: 'checkout-db',
  },
  azure: {
    label: 'Azure', cloudProviderTag: 'azure', region: 'eastus', az: '1', rawEnvExample: 'Environment:prod',
    hybridHardwareName: 'Azure Stack HCI', hybridIdTagKey: 'stamp_id', hybridIdExample: 'stamp-nyc1-01',
    serverlessProduct: 'Azure Function', serverlessIdTag: 'functionapp_name', serverlessIdExample: 'checkout-webhook',
    databaseProduct: 'Managed DB (Azure SQL)', dbIdTag: 'server_name', dbIdExample: 'checkout-db',
  },
  gcp: {
    label: 'GCP', cloudProviderTag: 'gcp', region: 'us-east1', az: 'us-east1-b', rawEnvExample: 'environment:prod',
    hybridHardwareName: 'Google Distributed Cloud', hybridIdTagKey: 'gdc_cluster_id', hybridIdExample: 'gdc-nyc1-01',
    serverlessProduct: 'Cloud Function', serverlessIdTag: 'function_name', serverlessIdExample: 'checkout-webhook',
    databaseProduct: 'Managed DB (Cloud SQL)', dbIdTag: 'database_id', dbIdExample: 'checkout-db',
  },
};

const CLOUD_PROVIDERS: CloudProvider[] = ['aws', 'azure', 'gcp'];

function buildSteps(industryName: string | undefined, industryTags: ContextTag[], provider: CloudProvider): TimelineStep[] {
  const industryLine = industryTags.length > 0 ? industryTags.map((t) => `${t.key}:${t.example}`).join('  ') : '';
  const p = PROVIDER_CONFIG[provider];
  return [
    {
      step: 1,
      source: 'cloud',
      title: 'Cloud integration auto-tags the infrastructure layer',
      when: `Day 1 — as soon as the ${p.label} integration is connected`,
      description:
        `The moment you connect a cloud account integration, Datadog pulls provider-native tags for free — no agent config needed. These describe where a resource lives, not what it does, so never hand-write these; just make sure the ${p.label} integration is on.`,
      namingNote:
        `Naming pitfall: cloud providers don't use Datadog's key names. ${p.label} resource tags are often spelled "${p.rawEnvExample.split(':')[0]}" (no fixed standard across accounts) — that never auto-becomes Datadog's env key. For a resource tag to inherit into env, either the source key must literally be env, or you add a mapping in the integration's "Automatically Import Tags" / custom tag config. Skip this step and your ${p.label} host shows ${p.rawEnvExample} as a separate, unrelated tag from env:prod on everything else.`,
      example: `cloud_provider:${p.cloudProviderTag}  region:${p.region}  availability-zone:${p.az}  ${p.rawEnvExample}`,
    },
    {
      step: 2,
      source: 'agent',
      title: 'The Agent adds unified service tagging on top',
      when: 'Day 1-2 — when you install/configure the Agent, containers, or serverless',
      description:
        'On top of the free cloud tags, you set the three Unified Service Tagging keys (env, service, version) via DD_ENV/DD_SERVICE/DD_VERSION or Agent config/labels. These are what tie APM traces, logs, and metrics for the same service together — this is the tagging strategy\'s backbone.',
      example: 'env:prod  service:checkout  version:1.4.2  team:payments',
    },
    {
      step: 3,
      source: 'datacenter',
      title: 'On-prem / datacenter hosts get the same keys, manually',
      when: 'Whenever a workload runs outside a cloud provider (bare metal, private DC, colo)',
      description:
        'There is no cloud integration to auto-tag these hosts, so every tag is manual — usually via the Agent\'s datadog.yaml `tags:` block or DD_TAGS env var. The critical rule: reuse the exact same key names as your cloud-tagged services (env, service, version), and add a source-identifying tag since cloud metadata won\'t exist here.',
      example: 'env:prod  service:checkout  version:1.4.2  datacenter:dc-nyc1  host_group:on-prem',
    },
    ...(industryTags.length > 0
      ? [
          {
            step: 4,
            source: 'industry' as Source,
            title: `${industryName ?? 'Your template'} adds sector-specific tags on both sides`,
            when: 'Same rollout — applied wherever the resource runs, cloud or datacenter',
            description:
              `These come from your "${industryName}" tagging policy. They ride alongside env/service/version — set them the same way (Agent config, DD_TAGS, or your deploy pipeline), on every resource whether it's cloud-hosted or on-prem, so a query can slice by them regardless of where the data came from.`,
            example: industryLine,
          },
        ]
      : []),
    {
      step: industryTags.length > 0 ? 5 : 4,
      source: 'unified',
      title: 'Normalize into one mixed-environment view',
      when: 'Ongoing — once both sources are reporting',
      description:
        'With matching keys across cloud and datacenter hosts, a single monitor, dashboard, or APM service page spans both, regardless of where the data originated. This is the payoff: query by service:checkout and see prod traffic whether it\'s in AWS or the NYC datacenter, one line, one tag schema.',
      example: 'service:checkout  →  47 hosts (32 aws, 15 datacenter)  |  env:prod  →  100% coverage both sides',
    },
    {
      step: industryTags.length > 0 ? 6 : 5,
      source: 'unified',
      title: 'Lock it in so it stays consistent',
      when: 'After the rollout — ongoing enforcement',
      description:
        'Tags drift once more engineers start onboarding services. Use the Tag Policy Enforcement section below to require env/service/version at ingestion time (Logs/Metrics/Traces), so a service can\'t report data without the baseline tags this hierarchy depends on.',
      example: 'Org Settings → Tag Policies → require: env, service, version' + (industryTags.length > 0 ? `, ${industryTags[0].key}` : ''),
    },
  ];
}

interface WaterfallTier {
  source: Source;
  label: string;
  tags: string[];
}

function buildWaterfall(industryName: string | undefined, industryTags: ContextTag[], provider: CloudProvider): WaterfallTier[] {
  const p = PROVIDER_CONFIG[provider];
  const tiers: WaterfallTier[] = [
    { source: 'cloud', label: 'Cloud provider raw tags', tags: [`cloud_provider:${p.cloudProviderTag}`, `region:${p.region}`, `${p.rawEnvExample} (raw, unmapped)`] },
    { source: 'cloud', label: 'Normalized to Datadog keys', tags: ['env:prod', 'account:123456789'] },
    { source: 'agent', label: 'Agent-added service tags', tags: ['service:checkout', 'version:1.4.2', 'team:payments'] },
    { source: 'datacenter', label: 'Datacenter tags (mirrored manually)', tags: ['datacenter:dc-nyc1', 'host_group:on-prem'] },
  ];
  if (industryTags.length > 0) {
    tiers.push({
      source: 'industry',
      label: `${industryName ?? 'Industry'} template tags`,
      tags: industryTags.map((t) => `${t.key}:${t.example}`),
    });
  }
  tiers.push({
    source: 'unified',
    label: 'Merged host — one tag schema',
    tags: [
      'env:prod', 'service:checkout', 'version:1.4.2', 'team:payments',
      ...(industryTags.length > 0 ? [industryTags[0].key + ':' + industryTags[0].example] : []),
      '+ source-specific tags',
    ],
  });
  return tiers;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildWaterfallSvg(tiers: WaterfallTier[]): { svg: string; width: number; height: number } {
  const width = 720;
  const padding = 20;
  const innerWidth = width - padding * 2;
  const lineHeight = 17;
  let y = padding;
  const parts: string[] = [];
  tiers.forEach((tier, i) => {
    const boxWidth = Math.max(220, (Math.min(100, 100 - i * 9) / 100) * innerWidth);
    const x = (width - boxWidth) / 2;
    const boxHeight = 34 + tier.tags.length * lineHeight;
    const color = SOURCE_SVG_COLOR[tier.source];
    parts.push(`<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="10" fill="${color.bg}" stroke="${color.stroke}" stroke-width="1.5" />`);
    parts.push(`<text x="${width / 2}" y="${y + 19}" text-anchor="middle" font-family="monospace" font-size="11" font-weight="700" fill="${color.text}" letter-spacing="0.5">${escapeXml(tier.label.toUpperCase())}</text>`);
    tier.tags.forEach((t, ti) => {
      parts.push(`<text x="${width / 2}" y="${y + 35 + ti * lineHeight}" text-anchor="middle" font-family="monospace" font-size="11" fill="${color.text}">${escapeXml(t)}</text>`);
    });
    y += boxHeight;
    if (i < tiers.length - 1) {
      parts.push(`<text x="${width / 2}" y="${y + 16}" text-anchor="middle" font-size="14" fill="#888888">&#8595;</text>`);
      y += 26;
    } else {
      y += padding;
    }
  });
  const height = y;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#14141c" />${parts.join('')}</svg>`;
  return { svg, width, height };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function exportGraphPng(tiers: WaterfallTier[], filename: string) {
  const { svg, width, height } = buildWaterfallSvg(tiers);
  const svgDataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to render graph'));
    img.src = svgDataUri;
  });
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  const pngUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = pngUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Mirrors buildWaterfall's tier sequence and colors exactly, but instead of one
// example host, shows what each tier's KEY looks like once every instance is
// reporting — a key with many values, the shape Tag Explorer actually shows.
// Read side-by-side with the single-host graph: same steps, "one instance"
// on the left becomes "every value we've seen" on the right.
function buildAggregateWaterfall(industryName: string | undefined, industryTags: ContextTag[], instanceKey: string, instanceExample: string, provider: CloudProvider): WaterfallTier[] {
  const otherIndustryTags = industryTags.filter((t) => t.key !== instanceKey).slice(0, 2);
  const instanceLabel = humanizeInstanceLabel(instanceKey);
  const p = PROVIDER_CONFIG[provider];
  const otherProviders = CLOUD_PROVIDERS.filter((c) => c !== provider).map((c) => PROVIDER_CONFIG[c].cloudProviderTag);
  const tiers: WaterfallTier[] = [
    { source: 'cloud', label: 'Cloud provider raw tags (aggregate)', tags: [`cloud_provider → ${p.cloudProviderTag}, ${otherProviders.join(', ')}`, `region → ${p.region}, ...`, `${p.rawEnvExample.split(':')[0]} (raw) → Prod, PROD, production`] },
    { source: 'cloud', label: 'Normalized to Datadog keys (aggregate)', tags: ['env → prod, staging, dev'] },
    { source: 'agent', label: 'Agent-added service tags (aggregate)', tags: ['service → checkout, payments, search, notifications', 'version → 1.4.2, 2.0.1, 0.9.3', 'team → payments, platform, growth'] },
    { source: 'datacenter', label: 'Datacenter tags (aggregate)', tags: ['datacenter → dc-nyc1, dc-miami', 'host_group → on-prem'] },
  ];
  tiers.push({
    source: 'industry',
    label: `${industryName ?? 'Industry'} template tags (aggregate)`,
    tags: [
      `${instanceKey} → ${instanceExample}, ... (one per ${instanceLabel})`,
      ...otherIndustryTags.map((t) => `${t.key} → ${t.example}, ...`),
    ],
  });
  tiers.push({
    source: 'unified',
    label: 'Tag Explorer — one facet per key',
    tags: ['service (multiple values)', `${instanceKey} (multiple values)`, 'env (3 values)', 'Filter any combination — no new keys as the fleet grows'],
  });
  return tiers;
}

interface ResourceTagItem {
  tag: string;
  required: boolean;
}

interface ResourceCard {
  category: string;
  name: string;
  tags: ResourceTagItem[];
}

function req(tag: string): ResourceTagItem { return { tag, required: true }; }
function sug(tag: string): ResourceTagItem { return { tag, required: false }; }

// Only the instance-identifying tag (whichever key the selected industry
// template uses — ship, store, branch, ...) is generically relevant across
// every resource type below ("which instance is this"). Other industry tags
// are specific to a particular resource and would be misleading attached to
// an unrelated one (a checkout log pipeline has no deck system).
//
// "Required" = the unified service tagging backbone (env/service, plus
// whatever that product can't function without — RUM's application_id,
// APM's version). "Suggested" = everything else: auto-injected identifiers,
// peer/downstream hints, and the instance tag — useful, not load-bearing.
function buildResourceCards(industryTags: ContextTag[], instanceKey: string, provider: CloudProvider): ResourceCard[] {
  const instanceTag = industryTags.find((t) => t.key === instanceKey);
  const instanceExtra = instanceTag ? [sug(`${instanceTag.key}:${instanceTag.example}`)] : [];
  const p = PROVIDER_CONFIG[provider];
  return [
    { category: 'APM', name: 'API service (Node.js/Java/Go)', tags: [req('service:checkout'), req('env:prod'), req('version:1.4.2'), sug('peer.service:payment-gateway'), ...instanceExtra] },
    { category: 'RUM', name: 'Web/mobile application', tags: [req('service:web-storefront'), req('env:prod'), req('application_id:a1b2c3'), ...instanceExtra] },
    { category: 'Logs', name: 'Log pipeline (microservice)', tags: [req('service:checkout'), req('env:prod'), sug('source:java'), ...instanceExtra] },
    { category: 'Kubernetes', name: 'Pod / Deployment', tags: [req('service:checkout'), req('kube_namespace:checkout'), sug('kube_deployment:checkout-api'), sug('pod_name:checkout-7f9d2'), ...instanceExtra] },
    { category: 'Serverless', name: p.serverlessProduct, tags: [req('service:checkout'), req('env:prod'), sug(`${p.serverlessIdTag}:${p.serverlessIdExample}`)] },
    { category: 'Database', name: p.databaseProduct, tags: [req('service:checkout-db'), req('env:prod'), sug(`${p.dbIdTag}:${p.dbIdExample}`), ...instanceExtra] },
    { category: 'Messaging', name: 'Queue / event stream', tags: [req('service:checkout'), req('env:prod'), sug('queue:checkout-events')] },
    { category: 'Synthetics', name: 'API / browser test', tags: [req('service:checkout'), req('env:prod'), sug('test_name:checkout-api-health')] },
    { category: 'Host', name: 'VM / bare-metal host', tags: [req('service:checkout'), req('env:prod'), sug('host:checkout-web-04'), ...instanceExtra] },
  ];
}

// ── Accumulated tags per layer (Cloud / Datacenter / Mix) ───────────────────

type Mode = 'cloud' | 'datacenter' | 'mix';

interface AccumulationLayer {
  source: Source;
  label: string;
  newTags: string[];
}

function keyOf(tag: string): string {
  return tag.split(':')[0];
}

// A "datacenter" resource isn't automatically cloud-free — AWS Outposts, Azure
// Stack, and Google Distributed Cloud are vendor hardware racked in your own
// site that still reports through the normal cloud integration. Bare-metal
// (no vendor relationship at all) is the only case with zero cloud auto-tags.
type DcVariant = 'bare-metal' | 'hybrid-cloud';

function dcVariantLabel(v: DcVariant, provider: CloudProvider): string {
  return v === 'bare-metal' ? 'Bare-metal (no cloud vendor)' : `Hybrid cloud hardware (e.g. ${PROVIDER_CONFIG[provider].hybridHardwareName})`;
}

function buildTrackLayers(
  track: 'cloud' | 'datacenter',
  industryName: string | undefined,
  industryTags: ContextTag[],
  dcVariant: DcVariant = 'bare-metal',
  provider: CloudProvider = 'aws',
): AccumulationLayer[] {
  const p = PROVIDER_CONFIG[provider];
  const industryLayer: AccumulationLayer[] = industryTags.length > 0
    ? [{ source: 'industry', label: `+ ${industryName ?? 'industry'} template tags`, newTags: industryTags.map((t) => `${t.key}:${t.example}`) }]
    : [];
  if (track === 'cloud') {
    return [
      { source: 'cloud', label: 'Layer 1 — Cloud provider (auto)', newTags: [`cloud_provider:${p.cloudProviderTag}`, `region:${p.region}`, `availability-zone:${p.az}`] },
      { source: 'agent', label: 'Layer 2 — DD Agent + Cloud (unified service tagging)', newTags: ['env:prod', 'service:checkout', 'version:1.4.2', 'team:payments'] },
      ...industryLayer,
    ];
  }
  if (dcVariant === 'hybrid-cloud') {
    return [
      { source: 'cloud', label: `Layer 1 — Cloud provider (auto, even though it's racked in your site — ${p.hybridHardwareName})`, newTags: [`cloud_provider:${p.cloudProviderTag}`, `${p.hybridIdTagKey}:${p.hybridIdExample}`, 'datacenter:dc-nyc1'] },
      { source: 'agent', label: 'Layer 2 — DD Agent + Cloud (unified service tagging)', newTags: ['env:prod', 'service:checkout', 'version:1.4.2', 'team:payments'] },
      ...industryLayer,
    ];
  }
  return [
    { source: 'datacenter', label: 'Layer 1 — DD Agent only (no cloud vendor at all)', newTags: ['env:prod', 'service:checkout', 'version:1.4.2', 'team:payments', 'datacenter:dc-nyc1', 'host_group:on-prem'] },
    ...industryLayer,
  ];
}

function AccumulationTrack({ layers }: { layers: AccumulationLayer[] }) {
  let cumulative: string[] = [];
  return (
    <div className="space-y-3">
      {layers.map((layer, i) => {
        const inherited = cumulative;
        cumulative = [...cumulative, ...layer.newTags];
        return (
          <div key={layer.label} className={`rounded-lg border p-2.5 ${SOURCE_COLOR[layer.source]}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-[10px] font-bold shrink-0">
                {i + 1}
              </span>
              <span className="text-xs font-semibold">{layer.label}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {inherited.map((t) => (
                <code
                  key={`inh-${t}`}
                  title="Inherited from the layer above"
                  className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-border bg-surface-sunken text-ink-faint"
                >
                  {t}
                </code>
              ))}
              {layer.newTags.map((t) => (
                <code
                  key={`new-${t}`}
                  title="New at this layer"
                  className="text-[11px] font-mono px-1.5 py-0.5 rounded border-2 border-current bg-surface font-semibold"
                >
                  {t}
                </code>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const MODE_LABEL: Record<Mode, string> = { cloud: 'Cloud', datacenter: 'Datacenter', mix: 'Mix' };

// Bird's-eye view sitting above the mode toggle: one canopy ("Unified in
// Datadog") with two ribs fanning down to the Cloud and Datacenter paths —
// visualizing that both accumulate independently but converge on one schema.
function LayerUmbrellaDiagram({ cloudLayers, dcLayers, sharedKeys }: {
  cloudLayers: AccumulationLayer[]; dcLayers: AccumulationLayer[]; sharedKeys: string[];
}) {
  const cloudCount = cloudLayers.reduce((n, l) => n + l.newTags.length, 0);
  const dcCount = dcLayers.reduce((n, l) => n + l.newTags.length, 0);
  return (
    <div className="mb-4">
      <div className="flex justify-center">
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 text-green-400 px-4 py-2 text-center">
          <div className="text-xs font-semibold uppercase tracking-wide">Unified in Datadog</div>
          <div className="text-[10px] text-ink-faint mt-0.5">{sharedKeys.join(', ') || 'shared keys'}</div>
        </div>
      </div>
      <div className="flex justify-center gap-20 text-ink-faint text-xl leading-none my-1">
        <span>╱</span>
        <span>╲</span>
      </div>
      <div className="flex justify-center gap-6">
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400 px-3 py-1.5 text-center">
          <div className="text-xs font-semibold">☁ Cloud path</div>
          <div className="text-[10px] text-ink-faint">{cloudCount} tags accumulated</div>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 px-3 py-1.5 text-center">
          <div className="text-xs font-semibold">🖥 Datacenter path</div>
          <div className="text-[10px] text-ink-faint">{dcCount} tags accumulated</div>
        </div>
      </div>
    </div>
  );
}

function DcVariantToggle({ dcVariant, setDcVariant, provider }: { dcVariant: DcVariant; setDcVariant: (v: DcVariant) => void; provider: CloudProvider }) {
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <span className="text-xs text-ink-faint shrink-0">Is this datacenter hardware cloud vendor equipment?</span>
      <div className="flex gap-1 bg-surface-sunken rounded-full p-0.5">
        {(['bare-metal', 'hybrid-cloud'] as DcVariant[]).map((v) => (
          <button
            key={v}
            onClick={() => setDcVariant(v)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors ${
              dcVariant === v ? 'bg-amber-600 text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {dcVariantLabel(v, provider)}
          </button>
        ))}
      </div>
    </div>
  );
}

function TagAccumulationCard({ industryName, industryTags, provider }: { industryName?: string; industryTags: ContextTag[]; provider: CloudProvider }) {
  const [mode, setMode] = useState<Mode>('cloud');
  const [dcVariant, setDcVariant] = useState<DcVariant>('hybrid-cloud');
  const cloudLayers = buildTrackLayers('cloud', industryName, industryTags, undefined, provider);
  const dcLayers = buildTrackLayers('datacenter', industryName, industryTags, dcVariant, provider);
  const cloudKeys = new Set(cloudLayers.flatMap((l) => l.newTags).map(keyOf));
  const dcKeys = new Set(dcLayers.flatMap((l) => l.newTags).map(keyOf));
  const sharedKeys = [...cloudKeys].filter((k) => dcKeys.has(k));
  const cloudOnlyKeys = [...cloudKeys].filter((k) => !dcKeys.has(k));
  const dcOnlyKeys = [...dcKeys].filter((k) => !cloudKeys.has(k));

  return (
    <section className="mt-6">
      <div className="card">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-ink">Tags accumulated at each layer</h3>
          <div className="flex gap-1 bg-surface-sunken rounded-full p-0.5">
            {(['cloud', 'datacenter', 'mix'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                  mode === m ? 'bg-violet-600 text-white' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        <LayerUmbrellaDiagram cloudLayers={cloudLayers} dcLayers={dcLayers} sharedKeys={sharedKeys} />

        <p className="text-xs text-ink-muted mb-3">
          {mode === 'cloud' && 'Cloud-hosted resource: what the integration auto-adds, then what the Agent layers on top. Faded pills are inherited from the layer above; bordered pills are new here.'}
          {mode === 'datacenter' && '"Datacenter" doesn\'t automatically mean "no cloud tags" — AWS Outposts, Azure Stack, and Google Distributed Cloud are vendor hardware racked in your own site that still report through the normal cloud integration. Pick which kind of hardware this is:'}
          {mode === 'mix' && 'Both paths side by side. Whether or not the datacenter side has real cloud hardware, both write the same env/service/version keys — so Datadog treats them as one queryable schema regardless.'}
        </p>

        {(mode === 'datacenter' || mode === 'mix') && (
          <DcVariantToggle dcVariant={dcVariant} setDcVariant={setDcVariant} provider={provider} />
        )}

        {mode === 'mix' ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-semibold text-blue-400 mb-2">☁ Cloud path</div>
                <AccumulationTrack layers={cloudLayers} />
              </div>
              <div>
                <div className="text-xs font-semibold text-amber-400 mb-2">
                  🖥 Datacenter path <span className="text-ink-faint font-normal">({dcVariantLabel(dcVariant, provider)})</span>
                </div>
                <AccumulationTrack layers={dcLayers} />
              </div>
            </div>
            <div className="mt-3 card bg-green-500/10 border-green-500/30">
              <div className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-2">Unified in Datadog</div>
              <div className="space-y-1.5 text-xs">
                <div>
                  <span className="text-ink-muted">Shared keys (query across both): </span>
                  {sharedKeys.map((k) => <code key={k} className="ml-1 font-mono text-green-400">{k}</code>)}
                </div>
                {cloudOnlyKeys.length > 0 && (
                  <div>
                    <span className="text-ink-muted">Cloud-only: </span>
                    {cloudOnlyKeys.map((k) => <code key={k} className="ml-1 font-mono text-blue-400">{k}</code>)}
                  </div>
                )}
                {dcOnlyKeys.length > 0 && (
                  <div>
                    <span className="text-ink-muted">Datacenter-only: </span>
                    {dcOnlyKeys.map((k) => <code key={k} className="ml-1 font-mono text-amber-400">{k}</code>)}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <AccumulationTrack layers={mode === 'cloud' ? cloudLayers : dcLayers} />
        )}
      </div>
    </section>
  );
}

function buildConfigExamples(industryTags: ContextTag[], instanceKey: string): { datadogYaml: string; confYaml: string; kubernetesYaml: string } {
  const instanceTag = industryTags.find((t) => t.key === instanceKey);
  // Each document nests its tags: list at a different depth (2 spaces at the
  // host level, 6 spaces under instances[0].tags), so the appended line must
  // match whichever list it's actually joining — a single shared indent here
  // previously landed the instance tag as a sibling of `instances:` itself
  // instead of inside that instance's own tags: list.
  const datadogInstanceLine = instanceTag ? `\n  - ${instanceTag.key}:${instanceTag.example}` : '';
  const confInstanceLine = instanceTag ? `\n      - ${instanceTag.key}:${instanceTag.example}` : '';
  const datadogYaml = `# /etc/datadog-agent/datadog.yaml — host-level tags, every check inherits these
env: prod
tags:
  - service:checkout
  - version:1.4.2
  - team:payments
  - datacenter:dc-nyc1${datadogInstanceLine}`;
  const confYaml = `# /etc/datadog-agent/conf.d/postgres.d/conf.yaml — check-specific, added on top of datadog.yaml
instances:
  - host: localhost
    port: 5432
    tags:
      - env:prod
      - service:checkout-db${confInstanceLine}`;
  const kubernetesYaml = `# Kubernetes Deployment — unified service tagging via labels + env vars
metadata:
  labels:
    tags.datadoghq.com/env: "prod"
    tags.datadoghq.com/service: "checkout"
    tags.datadoghq.com/version: "1.4.2"
spec:
  template:
    spec:
      containers:
        - name: checkout
          env:
            - name: DD_ENV
              value: "prod"
            - name: DD_SERVICE
              value: "checkout"
            - name: DD_VERSION
              value: "1.4.2"`;
  return { datadogYaml, confYaml, kubernetesYaml };
}

function ConfigExamplesSection({ industryTags, instanceKey }: { industryTags: ContextTag[]; instanceKey: string }) {
  const { datadogYaml, confYaml, kubernetesYaml } = buildConfigExamples(industryTags, instanceKey);
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-ink mb-1">How to actually set these tags</h3>
      <p className="text-xs text-ink-muted mb-3">
        Three common places these layers get configured — pick whichever matches where a resource runs.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs font-semibold text-ink mb-1">Agent host tags — datadog.yaml</div>
          <pre className="bg-surface-sunken border border-border rounded-lg p-2.5 text-[10.5px] font-mono text-ink overflow-x-auto whitespace-pre">{datadogYaml}</pre>
        </div>
        <div>
          <div className="text-xs font-semibold text-ink mb-1">Integration check tags — conf.yaml</div>
          <pre className="bg-surface-sunken border border-border rounded-lg p-2.5 text-[10.5px] font-mono text-ink overflow-x-auto whitespace-pre">{confYaml}</pre>
        </div>
        <div>
          <div className="text-xs font-semibold text-ink mb-1">Kubernetes — labels + env vars</div>
          <pre className="bg-surface-sunken border border-border rounded-lg p-2.5 text-[10.5px] font-mono text-ink overflow-x-auto whitespace-pre">{kubernetesYaml}</pre>
        </div>
      </div>
    </section>
  );
}

interface KeyEquivalent {
  ddKey: string;
  aws: string;
  azure: string;
  gcp: string;
  datacenterNote: string;
}

const KEY_EQUIVALENTS: KeyEquivalent[] = [
  { ddKey: 'env', aws: 'Environment / Env', azure: 'Environment', gcp: 'environment (lowercase only)', datacenterNote: 'Declare directly as env — you own the config here, so skip spelling variants entirely.' },
  { ddKey: 'service', aws: 'Application / App', azure: 'Application', gcp: 'app', datacenterNote: 'Declare directly as service — no remapping step exists off-cloud, so there\'s nothing to get wrong.' },
  { ddKey: 'version', aws: 'Version', azure: 'Version', gcp: 'version', datacenterNote: 'Declare directly as version, ideally the same semver/build id your CI already stamps on the artifact.' },
  { ddKey: 'team', aws: 'Owner / Team', azure: 'Owner', gcp: 'team', datacenterNote: 'Declare directly as team — match whatever key your cloud services already use for on-call ownership.' },
];

function KeyEquivalentsTable() {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-ink mb-1">Tag name equivalents — is "Environment" the same as "env"?</h3>
      <p className="text-xs text-ink-muted mb-3">
        Short answer: not automatically. Cloud providers don't standardize tag key spelling, so a resource tagged
        <code className="mx-1 text-ink font-mono">Environment:prod</code> in the AWS console won't join
        <code className="mx-1 text-ink font-mono">env:prod</code> from everything else unless the key is remapped
        on import. On a datacenter host there's no such import step at all — you're writing the Agent config
        yourself, so there's nothing to remap; just type the Datadog-canonical key directly and it matches by
        construction.
      </p>
      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-subtle text-xs text-ink-muted uppercase tracking-wide">
              <th className="text-left px-3 py-2">Datadog key</th>
              <th className="text-left px-3 py-2">AWS tag (typical)</th>
              <th className="text-left px-3 py-2">Azure tag (typical)</th>
              <th className="text-left px-3 py-2">GCP label (typical)</th>
              <th className="text-left px-3 py-2">Datacenter / on-prem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {KEY_EQUIVALENTS.map((k) => (
              <tr key={k.ddKey}>
                <td className="px-3 py-2"><code className="font-mono font-medium text-ink">{k.ddKey}</code></td>
                <td className="px-3 py-2 text-ink-muted">{k.aws}</td>
                <td className="px-3 py-2 text-ink-muted">{k.azure}</td>
                <td className="px-3 py-2 text-ink-muted">{k.gcp}</td>
                <td className="px-3 py-2 text-green-400">{k.datacenterNote}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TaggingPitfallExample({ instanceKey, instanceExample, provider }: { instanceKey: string; instanceExample: string; provider: CloudProvider }) {
  const label = humanizeInstanceLabel(instanceKey);
  const cloudTag = PROVIDER_CONFIG[provider].cloudProviderTag;
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-ink mb-1">The #1 beginner mistake: one tag trying to answer two questions</h3>
      <p className="text-xs text-ink-muted mb-3">
        Say your <strong>Checkout</strong> service runs at every {label}, and you need to know which {label} each
        instance belongs to. The natural instinct is to squeeze both facts — "which app" and "which {label}" —
        into one made-up value. Don't.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card border-red-500/30 bg-red-500/10">
          <div className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">✗ Don't: mash two facts into one value</div>
          <div className="space-y-1 mb-2">
            <code className="block text-xs font-mono text-ink bg-surface-sunken border border-border rounded px-2 py-1">{instanceKey}:{instanceExample}_{cloudTag}</code>
            <code className="block text-xs font-mono text-ink bg-surface-sunken border border-border rounded px-2 py-1">application:{instanceExample}_checkout</code>
          </div>
          <p className="text-xs text-ink-muted">
            Each value secretly encodes two answers at once. There is no single tag that just means
            "Checkout" — so you can never ask "show me every {label} running Checkout" in one query.
            Every new {label} means inventing yet another one-off string.
          </p>
        </div>
        <div className="card border-green-500/30 bg-green-500/10">
          <div className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-2">✓ Do: one key per question</div>
          <div className="space-y-1 mb-2">
            <code className="block text-xs font-mono text-ink bg-surface-sunken border border-border rounded px-2 py-1">service:checkout</code>
            <code className="block text-xs font-mono text-ink bg-surface-sunken border border-border rounded px-2 py-1">{instanceKey}:{instanceExample}</code>
            <code className="block text-xs font-mono text-ink bg-surface-sunken border border-border rounded px-2 py-1">cloud_provider:{cloudTag} <span className="text-ink-faint">(already automatic)</span></code>
          </div>
          <p className="text-xs text-ink-muted">
            "Which app?" and "which {label}?" are two different questions, so they get two different keys.
            Query <code className="mx-1 text-ink">service:checkout</code> for everything, or{' '}
            <code className="mx-1 text-ink">{instanceKey}:{instanceExample}</code> for one {label}, or both
            together for one exact instance. A new {label} is just one new value on{' '}
            <code className="mx-1 text-ink">{instanceKey}</code> — nothing else to invent or maintain.
          </p>
        </div>
      </div>
    </section>
  );
}

const ENV_UMBRELLA_SERVICES = ['checkout', 'payments', 'search', 'notifications', 'inventory'];

function EnvUmbrellaSection() {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-ink mb-1">env is an umbrella, not a per-team label</h3>
      <p className="text-xs text-ink-muted mb-3">
        A related mistake, specific to <code className="mx-1 text-ink font-mono">env</code>: folding the team or
        service into the environment value itself — <code className="mx-1 text-ink font-mono">env:payments_prod</code>,{' '}
        <code className="mx-1 text-ink font-mono">env:nonprod-utilities</code>. It feels more precise, but it
        quietly breaks the one job env has: letting every interrelated service be filtered, alerted on, and
        correlated together as "production," regardless of which team owns it.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="card border-red-500/30 bg-red-500/10">
          <div className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">✗ Don't: one env value per team</div>
          <div className="space-y-1 mb-2">
            <code className="block text-xs font-mono text-ink bg-surface-sunken border border-border rounded px-2 py-1">env:payments_prod</code>
            <code className="block text-xs font-mono text-ink bg-surface-sunken border border-border rounded px-2 py-1">env:checkout-prod</code>
            <code className="block text-xs font-mono text-ink bg-surface-sunken border border-border rounded px-2 py-1">env:nonprod-utilities</code>
          </div>
          <p className="text-xs text-ink-muted">
            Now no single value means "production." Every dashboard filter, monitor, and notification rule that
            assumes one <code className="mx-1 text-ink">env:prod</code> has to special-case each team's spelling —
            or, more often, silently misses them.
          </p>
        </div>
        <div className="card border-green-500/30 bg-green-500/10">
          <div className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-2">✓ Do: a small shared vocabulary</div>
          <div className="space-y-1 mb-2">
            <code className="block text-xs font-mono text-ink bg-surface-sunken border border-border rounded px-2 py-1">env:prod</code>
            <code className="block text-xs font-mono text-ink bg-surface-sunken border border-border rounded px-2 py-1">env:staging</code>
            <code className="block text-xs font-mono text-ink bg-surface-sunken border border-border rounded px-2 py-1">env:dev</code>
          </div>
          <p className="text-xs text-ink-muted">
            Every team uses the same handful of values. "Which team, which service" is a separate question,
            answered by <code className="mx-1 text-ink">service</code> and <code className="mx-1 text-ink">team</code> — not by env.
          </p>
        </div>
      </div>

      <div className="card py-4 mb-4">
        <div className="text-center mb-3">
          <div className="inline-block rounded-lg border border-green-500/30 bg-green-500/10 text-green-400 px-4 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide">env:prod</div>
            <div className="text-[10px] text-ink-faint mt-0.5">one shared umbrella — every interrelated service sits under it</div>
          </div>
        </div>
        <div className="text-ink-faint text-sm text-center mb-2">↓ ↓ ↓ ↓ ↓</div>
        <div className="flex flex-wrap justify-center gap-2">
          {ENV_UMBRELLA_SERVICES.map((s) => (
            <code key={s} className="text-xs font-mono bg-surface-sunken border border-border text-ink px-2 py-1 rounded">
              service:{s}
            </code>
          ))}
        </div>
      </div>

      <p className="text-xs font-semibold text-ink-muted mb-2">Why this umbrella matters:</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card py-2.5">
          <div className="text-xs font-semibold text-blue-400 mb-1">📊 Dashboards</div>
          <p className="text-xs text-ink-muted">
            One <code className="text-ink">$env</code> template variable drives every dashboard org-wide. Fragment
            env and a "Production Overview" dashboard silently excludes any team that spelled it differently.
          </p>
        </div>
        <div className="card py-2.5">
          <div className="text-xs font-semibold text-amber-400 mb-1">🔔 Monitors & notifications</div>
          <p className="text-xs text-ink-muted">
            One monitor scoped to <code className="text-ink">env:prod</code>, and one on-call escalation policy,
            can cover every service. Fragmented env means either N near-duplicate monitors, or alerts that never fire.
          </p>
        </div>
        <div className="card py-2.5">
          <div className="text-xs font-semibold text-violet-400 mb-1">🤖 Bits AI Root Cause</div>
          <p className="text-xs text-ink-muted">
            Root cause analysis correlates traces, logs, and deploys across every service sharing an environment to
            find blast radius. A private env value per team turns each team into an island Bits AI can't cross.
          </p>
        </div>
      </div>
    </section>
  );
}

const CATEGORY_COLOR: Record<string, string> = {
  APM: 'bg-violet-500/15 text-violet-400',
  RUM: 'bg-blue-500/15 text-blue-400',
  Logs: 'bg-amber-500/15 text-amber-400',
  Kubernetes: 'bg-green-500/15 text-green-400',
  Serverless: 'bg-rose-500/15 text-rose-400',
  Database: 'bg-blue-500/15 text-blue-400',
  Messaging: 'bg-violet-500/15 text-violet-400',
  Synthetics: 'bg-amber-500/15 text-amber-400',
  Host: 'bg-green-500/15 text-green-400',
};

function TagPills({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-1 mt-1.5">
      {tags.map((t) => (
        <code key={t} className="text-[11px] bg-surface-sunken border border-border text-ink px-1.5 py-0.5 rounded font-mono">
          {t}
        </code>
      ))}
    </div>
  );
}

function InheritanceWaterfall({ tiers, title, subtitle, filename }: {
  tiers: WaterfallTier[]; title: string; subtitle: string; filename: string;
}) {
  const widths = tiers.map((_, i) => Math.max(46, 100 - i * 9));
  return (
    <div className="card py-4">
      <div className="flex items-center justify-between mb-1 gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <button
          onClick={() => exportGraphPng(tiers, filename)}
          className="btn-ghost text-xs shrink-0"
          title="Download this diagram as a PNG image"
        >
          🖼 Export PNG
        </button>
      </div>
      <p className="text-xs text-ink-muted mb-4">{subtitle}</p>
      <div className="flex flex-col items-center">
        {tiers.map((tier, i) => (
          <div key={tier.label} className="w-full flex flex-col items-center">
            <div
              className={`rounded-lg border py-2.5 px-3 text-center ${SOURCE_COLOR[tier.source]}`}
              style={{ width: `${widths[i]}%` }}
            >
              <div className="text-[10px] uppercase tracking-wide font-semibold">{tier.label}</div>
              <TagPills tags={tier.tags} />
            </div>
            {i < tiers.length - 1 && <div className="text-ink-faint text-sm leading-none my-1">↓</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepCard({ s }: { s: TimelineStep }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div className={`absolute -left-8 top-0 w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold ${SOURCE_COLOR[s.source]}`}>
        {s.step}
      </div>
      <div className="card py-3">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium border ${SOURCE_COLOR[s.source]}`}>
            {SOURCE_LABEL[s.source]}
          </span>
          <span className="text-xs text-ink-faint">{s.when}</span>
        </div>
        <h3 className="text-sm font-semibold text-ink mb-2">{s.title}</h3>
        <pre className="bg-surface-sunken border border-border rounded-lg p-2.5 text-xs font-mono text-ink overflow-x-auto whitespace-pre-wrap break-words mb-2">
          {s.example}
        </pre>
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-xs text-violet-400 hover:text-violet-300 hover:underline"
        >
          {open ? '▲ Hide details' : '▼ Why / how'}
        </button>
        {open && (
          <div className="mt-2 pt-2 border-t border-border space-y-2">
            <p className="text-xs text-ink-muted">{s.description}</p>
            {s.namingNote && (
              <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
                {s.namingNote}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResourceCardView({ r }: { r: ResourceCard }) {
  return (
    <div className="card py-2.5">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium shrink-0 ${CATEGORY_COLOR[r.category] ?? 'bg-surface-sunken text-ink-muted'}`}>
          {r.category}
        </span>
        <span className="text-sm font-medium text-ink truncate">{r.name}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {r.tags.map((t) => (
          <code
            key={t.tag}
            title={t.required ? 'Required — this product needs it to work' : 'Suggested — adds value, not load-bearing'}
            className={
              t.required
                ? 'text-[11px] px-1.5 py-0.5 rounded font-mono font-semibold border-2 border-violet-500/60 bg-violet-500/10 text-violet-400'
                : 'text-[11px] px-1.5 py-0.5 rounded font-mono border border-border bg-surface-sunken text-ink-muted'
            }
          >
            {t.tag}
          </code>
        ))}
      </div>
    </div>
  );
}

// ── Print / PDF export ──────────────────────────────────────────────────────
// Printing the on-screen dark-themed modal directly would carry the app's
// stylesheet (dark backgrounds, colored borders, buttons) into the PDF. Instead
// this builds a fully self-contained, light, print-optimized HTML document —
// no app CSS involved — and opens it in a new tab for the browser's native
// print-to-PDF dialog.
function layerTableHtml(title: string, layers: AccumulationLayer[]): string {
  let cumulative: string[] = [];
  const rows = layers.map((layer, i) => {
    const inherited = cumulative;
    cumulative = [...cumulative, ...layer.newTags];
    const inheritedHtml = inherited.length
      ? inherited.map((t) => `<span class="tag tag-inherited">${escapeHtml(t)}</span>`).join(' ')
      : '<span class="muted">—</span>';
    const newHtml = layer.newTags.map((t) => `<span class="tag tag-new">${escapeHtml(t)}</span>`).join(' ');
    return `
      <tr>
        <td class="col-num">${i + 1}</td>
        <td><strong>${escapeHtml(layer.label)}</strong></td>
        <td>${inheritedHtml}</td>
        <td>${newHtml}</td>
      </tr>`;
  }).join('');
  return `
    <h3>${escapeHtml(title)}</h3>
    <table class="layer-table">
      <thead><tr><th>#</th><th>Layer</th><th>Inherited from above</th><th>New at this layer</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildPrintableHtml(opts: {
  industryName?: string;
  industryTags: ContextTag[];
  instanceKey: string;
  instanceExample: string;
  provider: CloudProvider;
  steps: TimelineStep[];
  resources: ResourceCard[];
  maturityAssessment?: { industry: string; promptText: string; hasScanData: boolean };
  remediationExecution?: { industry: string; promptText: string; hasScanData: boolean };
}): string {
  const { industryName, industryTags, instanceKey, instanceExample, provider, steps, resources, maturityAssessment, remediationExecution } = opts;
  const instanceLabel = humanizeInstanceLabel(instanceKey);
  const cloudTag = PROVIDER_CONFIG[provider].cloudProviderTag;
  const generatedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const stepsHtml = steps.map((s) => `
    <div class="step">
      <div class="step-head">
        <span class="badge">${s.step}</span>
        <span class="step-title">${escapeHtml(s.title)}</span>
      </div>
      <div class="muted small">${escapeHtml(s.when)}</div>
      <pre class="code">${escapeHtml(s.example)}</pre>
      <p>${escapeHtml(s.description)}</p>
      ${s.namingNote ? `<p class="note">${escapeHtml(s.namingNote)}</p>` : ''}
    </div>`).join('');

  const equivalentsRows = KEY_EQUIVALENTS.map((k) => `
    <tr>
      <td><code>${escapeHtml(k.ddKey)}</code></td>
      <td>${escapeHtml(k.aws)}</td>
      <td>${escapeHtml(k.azure)}</td>
      <td>${escapeHtml(k.gcp)}</td>
      <td>${escapeHtml(k.datacenterNote)}</td>
    </tr>`).join('');

  const resourcesHtml = resources.map((r) => `
    <div class="resource-card">
      <div class="resource-head"><span class="chip">${escapeHtml(r.category)}</span><strong>${escapeHtml(r.name)}</strong></div>
      <div>${r.tags.map((t) => `<span class="tag ${t.required ? 'tag-required' : ''}">${escapeHtml(t.tag)}</span>`).join(' ')}</div>
    </div>`).join('');

  const cloudLayers = buildTrackLayers('cloud', industryName, industryTags, undefined, provider);
  const dcBareMetalLayers = buildTrackLayers('datacenter', industryName, industryTags, 'bare-metal', provider);
  const dcHybridLayers = buildTrackLayers('datacenter', industryName, industryTags, 'hybrid-cloud', provider);
  const cloudKeysSet = new Set(cloudLayers.flatMap((l) => l.newTags).map(keyOf));
  const dcKeysSet = new Set(dcHybridLayers.flatMap((l) => l.newTags).map(keyOf));
  const sharedKeysList = [...cloudKeysSet].filter((k) => dcKeysSet.has(k)).join(', ');
  const umbrellaHtml = `
    <div style="text-align:center; margin: 10px 0 18px;">
      <div style="display:inline-block; border:1.5px solid #22c55e; background:#eafbf0; color:#166534; border-radius:8px; padding:8px 16px;">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em;">Unified in Datadog</div>
        <div style="font-size:10.5px; color:#4b6b57; margin-top:2px;">${escapeHtml(sharedKeysList || 'shared keys')}</div>
      </div>
      <div style="font-size:16px; color:#999; margin: 2px 0;">╱&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;╲</div>
      <div>
        <span style="display:inline-block; border:1px solid #3b82f6; background:#eef4ff; color:#1d4ed8; border-radius:8px; padding:6px 14px; font-size:11px; margin-right:12px;">☁ Cloud path</span>
        <span style="display:inline-block; border:1px solid #f59e0b; background:#fff8ea; color:#92620a; border-radius:8px; padding:6px 14px; font-size:11px;">🖥 Datacenter path</span>
      </div>
    </div>`;
  const { datadogYaml, confYaml, kubernetesYaml } = buildConfigExamples(industryTags, instanceKey);
  const configExamplesHtml = `
    <h3>How to actually set these tags</h3>
    <div class="config-grid">
      <div><div class="config-label">Agent host tags — datadog.yaml</div><pre class="code">${escapeHtml(datadogYaml)}</pre></div>
      <div><div class="config-label">Integration check tags — conf.yaml</div><pre class="code">${escapeHtml(confYaml)}</pre></div>
      <div><div class="config-label">Kubernetes — labels + env vars</div><pre class="code">${escapeHtml(kubernetesYaml)}</pre></div>
    </div>`;

  const industryBannerHtml = industryName && industryTags.length > 0 ? `
    <div class="callout callout-industry">
      <strong>Showing examples for: ${escapeHtml(industryName)}</strong>
      <p>This is your organization's tagging policy. Its tags are woven into the examples below.</p>
      <div>${industryTags.map((t) => `<span class="tag">${escapeHtml(t.key)}</span>`).join(' ')}</div>
    </div>` : '';

  const maturityPromptHtml = maturityAssessment ? `
    <h2>7. Bits AI tagging maturity assessment prompt</h2>
    <p>Paste this into Bits AI to score this org's Unified Service Tagging maturity, using the industry-specific tags above.</p>
    <p class="small muted">Industry: ${escapeHtml(maturityAssessment.industry)}${maturityAssessment.hasScanData ? '' : ' · no Architecture Health Check scan on file yet for this org'}</p>
    <pre class="code">${escapeHtml(maturityAssessment.promptText)}</pre>` : '';

  const remediationPromptHtml = remediationExecution ? `
    <h2>8. Bits AI tagging remediation execution prompt</h2>
    <p>Paste this into Bits AI to have it actually apply the tag fixes via the Datadog UI, not just report on them.</p>
    <p class="small muted">Industry: ${escapeHtml(remediationExecution.industry)}${remediationExecution.hasScanData ? '' : ' · no Architecture Health Check scan on file yet for this org'}</p>
    <pre class="code">${escapeHtml(remediationExecution.promptText)}</pre>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>How Tagging Works — Cloud, Datacenter & Mixed Environments</title>
<style>
  @page { margin: 22mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; font-size: 13px; line-height: 1.5; max-width: 900px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #111; }
  h2 { font-size: 16px; margin: 32px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #632ca6; color: #111; page-break-after: avoid; }
  h3 { font-size: 13px; margin: 18px 0 8px; color: #111; page-break-after: avoid; }
  p { margin: 6px 0; color: #333; }
  .subtitle { color: #555; margin: 0 0 4px; }
  .meta { color: #777; font-size: 11px; margin-bottom: 18px; }
  .muted { color: #777; }
  .small { font-size: 11px; }
  code { font-family: 'SF Mono', Consolas, monospace; background: #f2f2f5; padding: 1px 4px; border-radius: 3px; }
  .code { font-family: 'SF Mono', Consolas, monospace; background: #f6f6f9; border: 1px solid #e2e2ea; border-radius: 6px; padding: 8px 10px; font-size: 11px; white-space: pre-wrap; word-break: break-word; margin: 6px 0; }
  .tag { display: inline-block; font-family: 'SF Mono', Consolas, monospace; font-size: 10.5px; background: #f2f2f5; border: 1px solid #ddd; border-radius: 4px; padding: 1px 6px; margin: 2px 3px 2px 0; }
  .tag-inherited { color: #999; background: #fafafa; }
  .tag-new, .tag-required { border: 1.5px solid #632ca6; color: #632ca6; font-weight: 600; background: #f8f2fc; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 4px; page-break-inside: avoid; }
  th, td { text-align: left; padding: 6px 8px; border: 1px solid #e2e2ea; vertical-align: top; font-size: 11.5px; }
  th { background: #f6f6f9; text-transform: uppercase; letter-spacing: 0.02em; font-size: 10px; color: #555; }
  .layer-table .col-num { width: 24px; text-align: center; color: #999; }
  .step { border: 1px solid #e2e2ea; border-radius: 8px; padding: 10px 12px; margin: 10px 0; page-break-inside: avoid; }
  .step-head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
  .badge { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 999px; border: 1.5px solid #632ca6; color: #632ca6; font-weight: 700; font-size: 11px; flex-shrink: 0; }
  .step-title { font-weight: 600; }
  .note { background: #fdf6e8; border: 1px solid #f0dfa8; border-radius: 6px; padding: 8px 10px; font-size: 11.5px; color: #6b5410; }
  .callout { border-radius: 8px; padding: 10px 14px; margin: 10px 0 18px; page-break-inside: avoid; }
  .callout-industry { background: #fbeef1; border: 1px solid #eec4cf; }
  .callout-takeaway { background: #f2ecfb; border: 1px solid #d9c8f0; }
  .config-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin: 8px 0 16px; }
  .config-grid .code { font-size: 9.5px; }
  .config-label { font-size: 10.5px; font-weight: 600; margin-bottom: 4px; color: #333; }
  .resource-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .resource-card { border: 1px solid #e2e2ea; border-radius: 8px; padding: 8px 10px; page-break-inside: avoid; }
  .resource-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .chip { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.03em; background: #ece5f7; color: #632ca6; border-radius: 4px; padding: 1px 6px; font-weight: 600; }
  .pitfall-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; page-break-inside: avoid; }
  .pitfall-bad, .pitfall-good { border-radius: 8px; padding: 10px 12px; }
  .pitfall-bad { background: #fdecec; border: 1px solid #f2b8b8; }
  .pitfall-good { background: #eaf7ee; border: 1px solid #b7e2c4; }
  .pitfall-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; margin-bottom: 6px; }
  .pitfall-bad .pitfall-label { color: #b23636; }
  .pitfall-good .pitfall-label { color: #2c8a4b; }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e2e2ea; color: #999; font-size: 10.5px; }
  @media print { a { color: inherit; text-decoration: none; } }
</style>
</head>
<body>
  <h1>How Tagging Works: Cloud, Datacenter &amp; Mixed Environments</h1>
  <p class="subtitle">A reference guide to Datadog tagging for engineers new to the concept.</p>
  <div class="meta">Generated ${escapeHtml(generatedOn)}${industryName ? ` · Template: ${escapeHtml(industryName)}` : ''}</div>

  ${industryBannerHtml}

  <h2>1. The #1 beginner mistake</h2>
  <p>Say a <strong>Checkout</strong> service runs at every ${escapeHtml(instanceLabel)}, and each instance also needs to be identified by ${escapeHtml(instanceLabel)}. The instinct is to squeeze both facts into one made-up tag value — don't.</p>
  <div class="pitfall-grid">
    <div class="pitfall-bad">
      <div class="pitfall-label">✗ Don't: mash two facts into one value</div>
      <div><span class="tag">${escapeHtml(instanceKey)}:${escapeHtml(instanceExample)}_${escapeHtml(cloudTag)}</span></div>
      <div><span class="tag">application:${escapeHtml(instanceExample)}_checkout</span></div>
      <p class="small">Every new ${escapeHtml(instanceLabel)} means inventing another one-off string, and there's no single tag that just means "Checkout."</p>
    </div>
    <div class="pitfall-good">
      <div class="pitfall-label">✓ Do: one key per question</div>
      <div><span class="tag">service:checkout</span></div>
      <div><span class="tag">${escapeHtml(instanceKey)}:${escapeHtml(instanceExample)}</span></div>
      <div><span class="tag">cloud_provider:${escapeHtml(cloudTag)} (already automatic)</span></div>
      <p class="small">"Which app?" and "which ${escapeHtml(instanceLabel)}?" are different questions, so they get different keys. A new ${escapeHtml(instanceLabel)} is just one new value — nothing else to maintain.</p>
    </div>
  </div>

  <h2>2. env is an umbrella, not a per-team label</h2>
  <p>Folding the team or service into the environment value — <code>env:payments_prod</code>, <code>env:nonprod-utilities</code> — feels more precise, but breaks the one job env has: letting every interrelated service be filtered, alerted on, and correlated together as "production," regardless of which team owns it.</p>
  <div class="pitfall-grid">
    <div class="pitfall-bad">
      <div class="pitfall-label">✗ Don't: one env value per team</div>
      <div><span class="tag">env:payments_prod</span></div>
      <div><span class="tag">env:checkout-prod</span></div>
      <div><span class="tag">env:nonprod-utilities</span></div>
      <p class="small">No single value means "production" anymore — every filter, monitor, and notification rule has to special-case each team's spelling, or silently misses them.</p>
    </div>
    <div class="pitfall-good">
      <div class="pitfall-label">✓ Do: a small shared vocabulary</div>
      <div><span class="tag">env:prod</span></div>
      <div><span class="tag">env:staging</span></div>
      <div><span class="tag">env:dev</span></div>
      <p class="small">"Which team, which service" is a separate question, answered by service and team — not folded into env.</p>
    </div>
  </div>
  <table>
    <thead><tr><th>Impact area</th><th>Why a shared env matters</th></tr></thead>
    <tbody>
      <tr><td><strong>Dashboards</strong></td><td>One $env template variable drives every dashboard org-wide. Fragment env and a "Production Overview" dashboard silently excludes any team that spelled it differently.</td></tr>
      <tr><td><strong>Monitors &amp; notifications</strong></td><td>One monitor scoped to env:prod, and one on-call escalation policy, can cover every service. Fragmented env means either N near-duplicate monitors, or alerts that never fire.</td></tr>
      <tr><td><strong>Bits AI Root Cause</strong></td><td>Root cause analysis correlates traces, logs, and deploys across every service sharing an environment to find blast radius. A private env value per team turns each team into an island Bits AI can't cross.</td></tr>
    </tbody>
  </table>

  <h2>3. Rollout timeline</h2>
  ${stepsHtml}

  <h2>4. Tags accumulated at each layer</h2>
  ${umbrellaHtml}
  ${layerTableHtml('Cloud-hosted resource', cloudLayers)}
  ${layerTableHtml('Datacenter — bare-metal (no cloud vendor)', dcBareMetalLayers)}
  ${layerTableHtml(`Datacenter — hybrid cloud hardware (e.g. ${PROVIDER_CONFIG[provider].hybridHardwareName})`, dcHybridLayers)}
  <p class="small muted">Faint tags are inherited from the layer above; bordered tags are newly added at that layer.</p>
  ${configExamplesHtml}

  <h2>5. Tag name equivalents</h2>
  <p>Cloud providers don't standardize tag key spelling. On a datacenter host there's no import step at all — write the Datadog-canonical key directly and it matches by construction.</p>
  <table>
    <thead><tr><th>Datadog key</th><th>AWS (typical)</th><th>Azure (typical)</th><th>GCP (typical)</th><th>Datacenter / on-prem</th></tr></thead>
    <tbody>${equivalentsRows}</tbody>
  </table>

  <h2>6. Apps &amp; resources instrumented — example tag sets</h2>
  <p class="small muted"><span class="tag tag-required">bordered</span> = required · <span class="tag">plain</span> = suggested</p>
  <div class="resource-grid">${resourcesHtml}</div>

  <div class="callout callout-takeaway" style="margin-top: 24px;">
    <strong>Key takeaway</strong>
    <p>Cloud tags describe <em>where</em>; env/service/version describe <em>what</em>. The cloud provider gives you the "where" tags for free — you only ever hand-write the "what" tags, and you write them identically whether the host is in AWS or your own datacenter.</p>
  </div>

  ${maturityPromptHtml}
  ${remediationPromptHtml}

  <footer>How Tagging Works — Cloud, Datacenter &amp; Mixed Environments</footer>
</body>
</html>`;
}

// Markdown-safe: escapes pipe characters so tag values/labels containing them
// (rare, but tag values are free text) don't break table row parsing.
function escapeMdCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

// A fenced block's opening/closing ``` must sit directly against its content
// lines (no blank line between fence and code) — this keeps that single-string
// invariant instead of joining fence + lines with the same '\n\n' used for
// paragraph spacing elsewhere, which would otherwise leave blank lines inside the block.
function fence(content: string, lang = ''): string {
  return `\`\`\`${lang}\n${content}\n\`\`\``;
}

// Mermaid labels sit inside "..." quotes — escape the one character that
// would terminate the quote early, and turn newlines into <br/> since mermaid
// node labels are single-line unless HTML-broken.
function escapeMermaidLabel(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/\n/g, '<br/>');
}

// Same five sources InheritanceWaterfall/SOURCE_SVG_COLOR use on-screen,
// translated to hex classDefs so the exported diagram reads as the same
// color language as the app (blue=cloud, violet=agent, amber=datacenter,
// green=unified, rose=industry) instead of mermaid's default gray boxes.
const MERMAID_SOURCE_CLASSDEFS = [
  'classDef cloud fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a,stroke-width:2px;',
  'classDef agent fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95,stroke-width:2px;',
  'classDef datacenter fill:#fef3c7,stroke:#f59e0b,color:#78350f,stroke-width:2px;',
  'classDef unified fill:#dcfce7,stroke:#22c55e,color:#14532d,stroke-width:2px;',
  'classDef industry fill:#ffe4e6,stroke:#f43f5e,color:#881337,stroke-width:2px;',
].join('\n');

function layerFlowchartMermaid(title: string, layers: AccumulationLayer[]): string {
  const nodeLines = layers.map((layer, i) => {
    const label = [layer.label, ...layer.newTags].map(escapeMermaidLabel).join('<br/>');
    return `    L${i + 1}["${label}"]:::${layer.source}`;
  });
  const edgeLines = layers.slice(1).map((_, i) => `    L${i + 1} --> L${i + 2}`);
  return [
    `#### ${title}`,
    fence(['flowchart TD', ...nodeLines, ...edgeLines, MERMAID_SOURCE_CLASSDEFS].join('\n'), 'mermaid'),
  ].join('\n\n');
}

// Mirrors the HTML export's "umbrella" diagram (cloud path + datacenter path
// merging into one Datadog view) as an actual flowchart instead of a static
// icon row, since that merge is the single idea this whole guide builds to.
function unifiedPathMermaid(sharedKeys: string[]): string {
  const sharedLabel = escapeMermaidLabel(sharedKeys.length ? sharedKeys.join(', ') : 'shared keys');
  return fence([
    'flowchart LR',
    '    cloudPath("☁ Cloud path<br/>auto cloud tags"):::cloud',
    '    dcPath("🖥 Datacenter path<br/>manually configured tags"):::datacenter',
    `    unified(["Unified in Datadog<br/>${sharedLabel}"]):::unified`,
    '    cloudPath --> unified',
    '    dcPath --> unified',
    MERMAID_SOURCE_CLASSDEFS,
  ].join('\n'), 'mermaid');
}

// GitHub-flavored alert blockquotes (`> [!WARNING]` etc.) only render with
// color on viewers that specifically support that GFM extension — plenty of
// Markdown viewers (including VS Code's built-in preview) just show the
// literal "[!WARNING]" text with no styling. Raw inline-styled HTML is the one
// thing virtually every Markdown renderer passes through unchanged, so these
// color cards use the PDF's exact `.pitfall-*`/`.callout-*` hex values instead,
// guaranteeing the same red/green/rose/violet boxes regardless of viewer.
const CARD_PALETTE = {
  red: { bg: '#fdecec', border: '#f2b8b8', text: '#b23636' },
  green: { bg: '#eaf7ee', border: '#b7e2c4', text: '#2c8a4b' },
  rose: { bg: '#fbeef1', border: '#eec4cf', text: '#b2325a' },
  violet: { bg: '#f2ecfb', border: '#d9c8f0', text: '#632ca6' },
  blue: { bg: '#eef4ff', border: '#b8d0f2', text: '#1d4ed8' },
  amber: { bg: '#fdf6e8', border: '#f0dfa8', text: '#6b5410' },
} as const;

// Raw HTML blocks in CommonMark are passed through verbatim — no inline
// Markdown (backticks, **bold**) gets processed inside them — so card bodies
// must be built from real HTML tags (<code>, <strong>, <pre>) rather than
// Markdown syntax, and any user-facing text needs escapeHtml.
function colorCard(kind: keyof typeof CARD_PALETTE, titleHtml: string, bodyHtml: string): string {
  const p = CARD_PALETTE[kind];
  return `<div style="background:${p.bg};border:1px solid ${p.border};border-radius:8px;padding:10px 14px;margin:10px 0;">\n<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;color:${p.text};margin-bottom:6px;">${titleHtml}</div>\n${bodyHtml}\n</div>`;
}

function htmlPre(content: string): string {
  return `<pre style="background:#f6f6f9;border:1px solid #e2e2ea;border-radius:6px;padding:8px 10px;font-size:12px;margin:6px 0;overflow-x:auto;"><code>${escapeHtml(content)}</code></pre>`;
}

function htmlP(content: string): string {
  return `<div style="font-size:12px;color:#333;">${content}</div>`;
}

function htmlCode(s: string): string {
  return `<code style="background:#f2f2f5;padding:1px 4px;border-radius:3px;">${escapeHtml(s)}</code>`;
}

// Mirrors InheritanceWaterfall's tier stack (WaterfallTier: source/label/tags)
// as a flowchart — same data buildWaterfall/buildAggregateWaterfall feed the
// on-screen "One instance, tagged" and "Whole fleet, aggregated" cards.
function waterfallMermaid(tiers: WaterfallTier[]): string {
  const nodeLines = tiers.map((tier, i) => {
    const label = [tier.label, ...tier.tags].map(escapeMermaidLabel).join('<br/>');
    return `    W${i + 1}["${label}"]:::${tier.source}`;
  });
  const edgeLines = tiers.slice(1).map((_, i) => `    W${i + 1} --> W${i + 2}`);
  return fence(['flowchart TD', ...nodeLines, ...edgeLines, MERMAID_SOURCE_CLASSDEFS].join('\n'), 'mermaid');
}

// Mirrors EnvUmbrellaSection's fan-out visual (one env:prod canopy over every
// interrelated service) as a flowchart instead of a static "↓ ↓ ↓ ↓ ↓" row.
function envUmbrellaFanoutMermaid(): string {
  return fence([
    'flowchart TD',
    '    envprod(["env:prod<br/>one shared umbrella — every interrelated service sits under it"]):::unified',
    ...ENV_UMBRELLA_SERVICES.map((s, i) => `    svc${i}["service:${s}"]:::agent`),
    ...ENV_UMBRELLA_SERVICES.map((_, i) => `    envprod --> svc${i}`),
    MERMAID_SOURCE_CLASSDEFS,
  ].join('\n'), 'mermaid');
}

function buildPrintableMarkdown(opts: {
  industryName?: string;
  industryTags: ContextTag[];
  instanceKey: string;
  instanceExample: string;
  provider: CloudProvider;
  steps: TimelineStep[];
  resources: ResourceCard[];
  tiers: WaterfallTier[];
  aggregateTiers: WaterfallTier[];
  maturityAssessment?: { industry: string; promptText: string; hasScanData: boolean };
  remediationExecution?: { industry: string; promptText: string; hasScanData: boolean };
}): string {
  const { industryName, industryTags, instanceKey, instanceExample, provider, steps, resources, tiers, aggregateTiers, maturityAssessment, remediationExecution } = opts;
  const instanceLabel = humanizeInstanceLabel(instanceKey);
  const cloudTag = PROVIDER_CONFIG[provider].cloudProviderTag;
  const generatedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const industryBannerMd = industryName && industryTags.length > 0
    ? colorCard('rose', `Showing examples for: ${escapeHtml(industryName)}`, [
        htmlP("This is your organization's tagging policy. Its tags are woven into the examples below."),
        `<div>${industryTags.map((t) => htmlCode(t.key)).join(' ')}</div>`,
      ].join('\n'))
    : '';

  const stepsMd = steps.map((s) => [
    `#### Step ${s.step}: ${s.title}`,
    `_${s.when}_`,
    fence(s.example),
    s.description,
    s.namingNote ? `> ${s.namingNote}` : '',
  ].filter(Boolean).join('\n\n')).join('\n\n');

  const cloudLayers = buildTrackLayers('cloud', industryName, industryTags, undefined, provider);
  const dcBareMetalLayers = buildTrackLayers('datacenter', industryName, industryTags, 'bare-metal', provider);
  const dcHybridLayers = buildTrackLayers('datacenter', industryName, industryTags, 'hybrid-cloud', provider);

  const { datadogYaml, confYaml, kubernetesYaml } = buildConfigExamples(industryTags, instanceKey);
  const configExamplesMd = [
    '#### How to actually set these tags',
    '**Agent host tags — datadog.yaml**',
    fence(datadogYaml, 'yaml'),
    '**Integration check tags — conf.yaml**',
    fence(confYaml, 'yaml'),
    '**Kubernetes — labels + env vars**',
    fence(kubernetesYaml, 'yaml'),
  ].join('\n\n');

  const equivalentsRows = KEY_EQUIVALENTS.map((k) =>
    `| \`${k.ddKey}\` | ${escapeMdCell(k.aws)} | ${escapeMdCell(k.azure)} | ${escapeMdCell(k.gcp)} | ${escapeMdCell(k.datacenterNote)} |`
  ).join('\n');

  const resourcesMd = resources.map((r) =>
    `- **${r.category} — ${r.name}**: ${r.tags.map((t) => `\`${t.tag}\`${t.required ? ' ✅' : ''}`).join(', ')}`
  ).join('\n');

  const maturityMd = maturityAssessment ? [
    '## 8. Bits AI tagging maturity assessment prompt',
    'Paste this into Bits AI to score this org\'s Unified Service Tagging maturity, using the industry-specific tags above.',
    colorCard(
      maturityAssessment.hasScanData ? 'blue' : 'amber',
      maturityAssessment.hasScanData ? 'Note' : 'Heads up',
      htmlP(`Industry: ${escapeHtml(maturityAssessment.industry)}${maturityAssessment.hasScanData ? '' : ' · no Architecture Health Check scan on file yet for this org'}`),
    ),
    fence(maturityAssessment.promptText),
  ].join('\n\n') : '';

  const remediationMd = remediationExecution ? [
    '## 9. Bits AI tagging remediation execution prompt',
    'Paste this into Bits AI to have it actually apply the tag fixes via the Datadog UI, not just report on them.',
    colorCard(
      remediationExecution.hasScanData ? 'blue' : 'amber',
      remediationExecution.hasScanData ? 'Note' : 'Heads up',
      htmlP(`Industry: ${escapeHtml(remediationExecution.industry)}${remediationExecution.hasScanData ? '' : ' · no Architecture Health Check scan on file yet for this org'}`),
    ),
    fence(remediationExecution.promptText),
  ].join('\n\n') : '';

  const cloudKeysSet = new Set(cloudLayers.flatMap((l) => l.newTags).map(keyOf));
  const dcKeysSet = new Set(dcHybridLayers.flatMap((l) => l.newTags).map(keyOf));
  const sharedKeysList = [...cloudKeysSet].filter((k) => dcKeysSet.has(k));
  const cloudOnlyKeys = [...cloudKeysSet].filter((k) => !dcKeysSet.has(k));
  const dcOnlyKeys = [...dcKeysSet].filter((k) => !cloudKeysSet.has(k));

  const legendMd = '**Legend:** ✅ required · plain = suggested\n\n' +
    `<span style="color:#3b82f6">■</span> cloud &nbsp; <span style="color:#8b5cf6">■</span> agent &nbsp; <span style="color:#f59e0b">■</span> datacenter &nbsp; <span style="color:#22c55e">■</span> unified &nbsp; <span style="color:#f43f5e">■</span> industry template`;

  const mixBreakdownMd = [
    '#### Unified in Datadog — mix mode',
    `**Shared keys (query across both):** ${sharedKeysList.length ? sharedKeysList.map((k) => `\`${k}\``).join(', ') : '—'}`,
    cloudOnlyKeys.length ? `**Cloud-only:** ${cloudOnlyKeys.map((k) => `\`${k}\``).join(', ')}` : '',
    dcOnlyKeys.length ? `**Datacenter-only:** ${dcOnlyKeys.map((k) => `\`${k}\``).join(', ')}` : '',
  ].filter(Boolean).join('\n\n');

  const waterfallsMd = [
    '## 3. Tag inheritance, visualized',
    '#### One instance, tagged',
    '_Follow a single host from raw cloud tags down to its final merged tag set._',
    waterfallMermaid(tiers),
    '#### Whole fleet, aggregated in Datadog',
    `_Same tiers, same order — but this is what Tag Explorer shows once every ${instanceLabel} is reporting: one key, many values._`,
    waterfallMermaid(aggregateTiers),
  ].join('\n\n');

  return [
    '# How Tagging Works: Cloud, Datacenter & Mixed Environments',
    'A reference guide to Datadog tagging for engineers new to the concept.',
    `_Generated ${generatedOn}${industryName ? ` · Template: ${industryName}` : ''}_`,
    industryBannerMd,
    '## 1. The #1 beginner mistake: one tag trying to answer two questions',
    `Say your **Checkout** service runs at every ${instanceLabel}, and you need to know which ${instanceLabel} each instance belongs to. The natural instinct is to squeeze both facts — "which app" and "which ${instanceLabel}" — into one made-up value. Don't.`,
    colorCard('red', "✗ Don't: mash two facts into one value", [
      htmlPre([`${instanceKey}:${instanceExample}_${cloudTag}`, `application:${instanceExample}_checkout`].join('\n')),
      htmlP(`Each value secretly encodes two answers at once. There is no single tag that just means "Checkout" — so you can never ask "show me every ${instanceLabel} running Checkout" in one query. Every new ${instanceLabel} means inventing yet another one-off string.`),
    ].join('\n')),
    colorCard('green', '✓ Do: one key per question', [
      htmlPre(['service:checkout', `${instanceKey}:${instanceExample}`, `cloud_provider:${cloudTag} (already automatic)`].join('\n')),
      htmlP(`"Which app?" and "which ${instanceLabel}?" are two different questions, so they get two different keys. Query ${htmlCode('service:checkout')} for everything, or ${htmlCode(`${instanceKey}:${instanceExample}`)} for one ${instanceLabel}, or both together for one exact instance. A new ${instanceLabel} is just one new value on ${htmlCode(instanceKey)} — nothing else to invent or maintain.`),
    ].join('\n')),
    '## 2. env is an umbrella, not a per-team label',
    'A related mistake, specific to `env`: folding the team or service into the environment value itself — `env:payments_prod`, `env:nonprod-utilities`. It feels more precise, but it quietly breaks the one job env has: letting every interrelated service be filtered, alerted on, and correlated together as "production," regardless of which team owns it.',
    colorCard('red', "✗ Don't: one env value per team", [
      htmlPre(['env:payments_prod', 'env:checkout-prod', 'env:nonprod-utilities'].join('\n')),
      htmlP(`Now no single value means "production." Every dashboard filter, monitor, and notification rule that assumes one ${htmlCode('env:prod')} has to special-case each team's spelling — or, more often, silently misses them.`),
    ].join('\n')),
    colorCard('green', '✓ Do: a small shared vocabulary', [
      htmlPre(['env:prod', 'env:staging', 'env:dev'].join('\n')),
      htmlP(`Every team uses the same handful of values. "Which team, which service" is a separate question, answered by ${htmlCode('service')} and ${htmlCode('team')} — not by env.`),
    ].join('\n')),
    envUmbrellaFanoutMermaid(),
    '**Why this umbrella matters:**',
    '| Impact area | Why a shared env matters |\n|---|---|\n' +
      '| 📊 **Dashboards** | One `$env` template variable drives every dashboard org-wide. Fragment env and a "Production Overview" dashboard silently excludes any team that spelled it differently. |\n' +
      '| 🔔 **Monitors & notifications** | One monitor scoped to `env:prod`, and one on-call escalation policy, can cover every service. Fragmented env means either N near-duplicate monitors, or alerts that never fire. |\n' +
      '| 🤖 **Bits AI Root Cause** | Root cause analysis correlates traces, logs, and deploys across every service sharing an environment to find blast radius. A private env value per team turns each team into an island Bits AI can\'t cross. |',
    waterfallsMd,
    '## 4. Rollout timeline',
    stepsMd,
    '## 5. Tags accumulated at each layer',
    legendMd,
    unifiedPathMermaid(sharedKeysList),
    layerFlowchartMermaid('Cloud-hosted resource', cloudLayers),
    layerFlowchartMermaid('Datacenter — bare-metal (no cloud vendor)', dcBareMetalLayers),
    layerFlowchartMermaid(`Datacenter — hybrid cloud hardware (e.g. ${PROVIDER_CONFIG[provider].hybridHardwareName})`, dcHybridLayers),
    mixBreakdownMd,
    configExamplesMd,
    '## 6. Tag name equivalents',
    'Cloud providers don\'t standardize tag key spelling. On a datacenter host there\'s no import step at all — write the Datadog-canonical key directly and it matches by construction.',
    `| Datadog key | AWS (typical) | Azure (typical) | GCP (typical) | Datacenter / on-prem |\n|---|---|---|---|---|\n${equivalentsRows}`,
    '## 7. Apps & resources instrumented — example tag sets',
    resourcesMd,
    colorCard('violet', 'Key takeaway', htmlP('Cloud tags describe <em>where</em>; env/service/version describe <em>what</em>. The cloud provider gives you the "where" tags for free — you only ever hand-write the "what" tags, and you write them identically whether the host is in AWS or your own datacenter.')),
    maturityMd,
    remediationMd,
  ].filter(Boolean).join('\n\n') + '\n';
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportMarkdown(opts: {
  industryName?: string;
  industryTags: ContextTag[];
  instanceKey: string;
  instanceExample: string;
  provider: CloudProvider;
  steps: TimelineStep[];
  resources: ResourceCard[];
  tiers: WaterfallTier[];
  aggregateTiers: WaterfallTier[];
  maturityAssessment?: { industry: string; promptText: string; hasScanData: boolean };
  remediationExecution?: { industry: string; promptText: string; hasScanData: boolean };
}) {
  const markdown = buildPrintableMarkdown(opts);
  downloadTextFile('how-tagging-works.md', markdown, 'text/markdown');
}

function exportPdf(opts: {
  industryName?: string;
  industryTags: ContextTag[];
  instanceKey: string;
  instanceExample: string;
  provider: CloudProvider;
  steps: TimelineStep[];
  resources: ResourceCard[];
  maturityAssessment?: { industry: string; promptText: string; hasScanData: boolean };
  remediationExecution?: { industry: string; promptText: string; hasScanData: boolean };
}) {
  const html = buildPrintableHtml(opts);
  // Passing 'noopener' here would make window.open() return null in most
  // browsers, leaving an unwritable blank tab — omit it so we keep the
  // reference needed to write the document and trigger print().
  const win = window.open('', '_blank');
  if (!win) {
    toast.error('Export blocked — allow pop-ups for this site and try again.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => {
    win.focus();
    win.print();
  }, 300);
}

function MaturityAssessmentSection({
  hasOrgSelected, data, isLoading, isError,
}: {
  hasOrgSelected: boolean;
  data?: MaturityAssessmentResult;
  isLoading: boolean;
  isError: boolean;
}) {
  function copyPrompt() {
    if (!data) return;
    navigator.clipboard.writeText(data.promptText)
      .then(() => toast.success('Prompt copied — paste it into Bits AI'))
      .catch(() => toast.error('Failed to copy to clipboard'));
  }

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-ink mb-1">Ready to assess your maturity? Ask Bits AI</h3>
      <p className="text-xs text-ink-muted mb-3">
        Generate a ready-to-run prompt that scores this org's Unified Service Tagging maturity, using the
        industry tags above, and hand it to Bits AI directly.
      </p>

      {!hasOrgSelected ? (
        <p className="text-xs text-ink-faint">Select an organization to generate this prompt.</p>
      ) : isLoading ? (
        <p className="text-xs text-ink-faint">Generating prompt…</p>
      ) : isError || !data ? (
        <p className="text-xs text-ink-faint">Couldn't generate a maturity assessment prompt for this org.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-ink-faint">
              Industry: <span className="text-ink-muted font-medium">{data.industry}</span>
              {!data.hasScanData && ' · no Architecture Health Check scan on file yet for this org'}
            </span>
            <button className="btn-secondary text-xs px-3 py-1.5" onClick={copyPrompt}>
              Copy for Bits AI
            </button>
          </div>
          <pre className="text-xs text-ink-muted bg-surface-sunken border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
            {data.promptText}
          </pre>
        </div>
      )}
    </section>
  );
}

function RemediationExecutionSection({
  hasOrgSelected, data, isLoading, isError,
}: {
  hasOrgSelected: boolean;
  data?: RemediationExecutionResult;
  isLoading: boolean;
  isError: boolean;
}) {
  function copyPrompt() {
    if (!data) return;
    navigator.clipboard.writeText(data.promptText)
      .then(() => toast.success('Prompt copied — paste it into Bits AI'))
      .catch(() => toast.error('Failed to copy to clipboard'));
  }

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-ink mb-1">Ready to fix it? Ask Bits AI to apply the tags</h3>
      <p className="text-xs text-ink-muted mb-3">
        This is the same idea as the maturity assessment, but instead of scoring and reporting, this prompt
        instructs Bits AI to actually go apply the recommended tags via the Datadog UI — after showing you a
        plan and getting your confirmation.
      </p>

      {!hasOrgSelected ? (
        <p className="text-xs text-ink-faint">Select an organization to generate this prompt.</p>
      ) : isLoading ? (
        <p className="text-xs text-ink-faint">Generating prompt…</p>
      ) : isError || !data ? (
        <p className="text-xs text-ink-faint">Couldn't generate a remediation execution prompt for this org.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-ink-faint">
              Industry: <span className="text-ink-muted font-medium">{data.industry}</span>
              {!data.hasScanData && ' · no Architecture Health Check scan on file yet for this org'}
            </span>
            <button className="btn-secondary text-xs px-3 py-1.5" onClick={copyPrompt}>
              Copy for Bits AI
            </button>
          </div>
          <pre className="text-xs text-ink-muted bg-surface-sunken border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
            {data.promptText}
          </pre>
          <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
            This prompt grants Bits AI write access to your tagging. It's written to show a plan before
            applying anything and cap batches at 25 resources — review both before pasting it into a
            production org.
          </p>
        </div>
      )}
    </section>
  );
}

export default function TaggingStrategyGuideModal({
  onClose, industryName, industryTags = [],
}: {
  onClose: () => void;
  industryName?: string;
  industryTags?: ContextTag[];
}) {
  const [provider, setProvider] = useState<CloudProvider>('aws');
  const instanceTag = industryTags.find((t) => INSTANCE_KEY_PATTERN.test(t.key));
  const instanceKey = instanceTag?.key ?? 'location';
  const instanceExample = instanceTag?.example ?? 'site-01';
  const steps = buildSteps(industryName, industryTags, provider);
  const tiers = buildWaterfall(industryName, industryTags, provider);
  const aggregateTiers = buildAggregateWaterfall(industryName, industryTags, instanceKey, instanceExample, provider);
  const resources = buildResourceCards(industryTags, instanceKey, provider);

  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const { data: maturityAssessment, isLoading: maturityLoading, isError: maturityError } = useQuery({
    queryKey: ['tagging-maturity-assessment', selectedOrgId, selectedScanId],
    queryFn: () => taggingApi.maturityAssessment(selectedOrgId, selectedScanId || undefined),
    enabled: Boolean(selectedOrgId),
  });
  const maturityAssessmentForExport = maturityAssessment && {
    industry: maturityAssessment.industry,
    promptText: maturityAssessment.promptText,
    hasScanData: maturityAssessment.hasScanData,
  };
  const { data: remediationExecution, isLoading: remediationLoading, isError: remediationError } = useQuery({
    queryKey: ['tagging-remediation-execution', selectedOrgId, selectedScanId],
    queryFn: () => taggingApi.remediationExecution(selectedOrgId, selectedScanId || undefined),
    enabled: Boolean(selectedOrgId),
  });
  const remediationExecutionForExport = remediationExecution && {
    industry: remediationExecution.industry,
    promptText: remediationExecution.promptText,
    hasScanData: remediationExecution.hasScanData,
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-surface-subtle rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h2 className="text-lg font-bold text-ink">How tagging works: cloud + datacenter + mixed environments</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportMarkdown({
                  industryName, industryTags, instanceKey, instanceExample, provider, steps, resources, tiers, aggregateTiers,
                  maturityAssessment: maturityAssessmentForExport,
                  remediationExecution: remediationExecutionForExport,
                })}
                className="btn-secondary text-xs"
              >
                ⬇ Export Markdown
              </button>
              <button
                onClick={() => exportPdf({
                  industryName, industryTags, instanceKey, instanceExample, provider, steps, resources,
                  maturityAssessment: maturityAssessmentForExport,
                  remediationExecution: remediationExecutionForExport,
                })}
                className="btn-secondary text-xs"
              >
                🖨 Export PDF
              </button>
              <button onClick={onClose} className="btn-ghost text-xs">✕ Close</button>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-ink-faint shrink-0">Cloud provider in the examples below:</span>
            <div className="flex gap-1 bg-surface-sunken rounded-full p-0.5">
              {CLOUD_PROVIDERS.map((c) => (
                <button
                  key={c}
                  onClick={() => setProvider(c)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    provider === c ? 'bg-blue-600 text-white' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {PROVIDER_CONFIG[c].label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-ink-muted mb-4">
            A step-by-step flow for engineers new to Datadog tagging — what's automatic, what you have to set
            yourself, and how the two sources come together into one consistent view even when your
            infrastructure is split across a cloud provider and your own datacenter.
          </p>

          {industryName && industryTags.length > 0 && (
            <div className="card bg-rose-500/10 border-rose-500/30 mb-6">
              <div className="text-xs font-semibold text-rose-400 uppercase tracking-wide mb-1">
                Showing examples for: {industryName}
              </div>
              <p className="text-xs text-ink-muted mb-2">
                This is your organization's tagging policy. Its key tags are woven into the flow and resource
                examples below so this guide reflects what your organization actually needs to tag.
              </p>
              <div className="flex flex-wrap gap-2">
                {industryTags.map((t) => (
                  <div key={t.key} className="flex items-center gap-1.5 bg-surface-sunken border border-border rounded-lg px-2 py-1">
                    <code className="text-xs font-mono text-rose-400">{t.key}</code>
                    <span className="text-xs text-ink-faint truncate max-w-[220px]" title={t.description}>{t.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <TaggingPitfallExample instanceKey={instanceKey} instanceExample={instanceExample} provider={provider} />

          <EnvUmbrellaSection />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
            <InheritanceWaterfall
              tiers={tiers}
              title="One instance, tagged"
              subtitle="Follow a single host from raw cloud tags down to its final merged tag set."
              filename="datadog-tagging-single-host.png"
            />
            <InheritanceWaterfall
              tiers={aggregateTiers}
              title="Whole fleet, aggregated in Datadog"
              subtitle={`Same tiers, same order — but this is what Tag Explorer shows once every ${humanizeInstanceLabel(instanceKey)} is reporting: one key, many values.`}
              filename="datadog-tagging-aggregate.png"
            />
          </div>

          <div className="relative pl-8 mt-6">
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />
            <div className="space-y-6">
              {steps.map((s) => <StepCard key={s.step} s={s} />)}
            </div>
          </div>

          <TagAccumulationCard industryName={industryName} industryTags={industryTags} provider={provider} />

          <ConfigExamplesSection industryTags={industryTags} instanceKey={instanceKey} />

          <KeyEquivalentsTable />

          <section className="mt-6">
            <h3 className="text-sm font-semibold text-ink mb-1">Apps & resources instrumented — example tag sets</h3>
            <p className="text-xs text-ink-muted mb-2">
              The same env/service/version backbone applies everywhere Datadog collects data — only the
              resource-specific tags change. Use these as a starting checklist when instrumenting something new.
            </p>
            <div className="flex items-center gap-3 mb-3 text-[11px] text-ink-faint">
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm border-2 border-violet-500/60 bg-violet-500/10 inline-block" /> Required
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm border border-border bg-surface-sunken inline-block" /> Suggested
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {resources.map((r) => <ResourceCardView key={r.name} r={r} />)}
            </div>
          </section>

          <div className="mt-6 card bg-violet-500/10 border-violet-500/30">
            <div className="text-xs font-semibold text-violet-400 uppercase tracking-wide mb-1">Key takeaway</div>
            <p className="text-xs text-ink-muted">
              Cloud tags describe <em>where</em>; env/service/version describe <em>what</em>. The cloud provider
              gives you the "where" tags for free — you only ever hand-write the "what" tags (plus any
              {industryName ? ` ${industryName}-specific ones` : ' industry-specific ones'}), and you write them
              identically whether the host is in AWS or your own datacenter. That's the entire trick to a mixed
              environment scoring well against the templates below.
            </p>
          </div>

          <MaturityAssessmentSection
            hasOrgSelected={Boolean(selectedOrgId)}
            data={maturityAssessment}
            isLoading={maturityLoading}
            isError={maturityError}
          />

          <RemediationExecutionSection
            hasOrgSelected={Boolean(selectedOrgId)}
            data={remediationExecution}
            isLoading={remediationLoading}
            isError={remediationError}
          />
        </div>
      </div>
    </div>
  );
}
