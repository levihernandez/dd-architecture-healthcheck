import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { orgContextApi } from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonText } from '../components/ui/Skeleton';
import type { OrgContextData } from '../types';
import SectionGate from '../components/SectionGate';

// ── Chip selector ──────────────────────────────────────────────────────────────

function ChipGroup({ options, selected, onChange, allowCustom = false }: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  allowCustom?: boolean;
}) {
  const [custom, setCustom] = useState('');
  const toggle = (opt: string) =>
    onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]);
  const addCustom = () => {
    const v = custom.trim();
    if (v && !selected.includes(v)) onChange([...selected, v]);
    setCustom('');
  };
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={`text-xs px-3 py-1.5 rounded-full border transition-all font-medium ${
            selected.includes(opt)
              ? 'bg-dd-purple text-white border-dd-purple'
              : 'bg-surface-subtle text-ink-muted border-border-strong hover:border-dd-purple/50 hover:text-dd-purple'
          }`}
        >
          {opt}
        </button>
      ))}
      {selected.filter(s => !options.includes(s)).map(s => (
        <button
          key={s}
          type="button"
          onClick={() => toggle(s)}
          className="text-xs px-3 py-1.5 rounded-full border bg-dd-purple/10 text-dd-purple-dark border-dd-purple/30 font-medium"
        >
          {s} ×
        </button>
      ))}
      {allowCustom && (
        <input
          className="text-xs border border-dashed border-border-strong rounded-full px-3 py-1.5 w-32 focus:outline-none focus:border-dd-purple/50 placeholder:text-ink-faint"
          placeholder="+ add other"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
          onBlur={addCustom}
        />
      )}
    </div>
  );
}

// ── Field wrapper ──────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-semibold text-ink">{label}</label>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
      {children}
    </div>
  );
}

function Select({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>; placeholder?: string;
}) {
  return (
    <select className="input text-sm mt-1.5 w-full" value={value} onChange={e => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      className="input text-sm mt-1.5 w-full resize-none"
      rows={rows}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({ icon, title, subtitle, children }: {
  icon: string; title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div className="card space-y-5">
      <div className="flex items-start gap-3">
        <span className="text-2xl mt-0.5">{icon}</span>
        <div>
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <p className="text-xs text-ink-faint mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-5 pl-9">
        {children}
      </div>
    </div>
  );
}

// ── Constants ──────────────────────────────────────────────────────────────────

const INDUSTRIES = ['Payment Processing', 'Financial Services / Fintech', 'E-Commerce / Retail', 'Healthcare / Pharma', 'SaaS / B2B Software', 'Media & Entertainment', 'Telecommunications', 'Logistics & Supply Chain', 'Gaming', 'Government / Public Sector', 'Education', 'Manufacturing / IoT', 'Other'];
const TECH_STACK = ['.NET / C#', 'Java / JVM', 'Go / Golang', 'Node.js', 'Python', 'Ruby', 'PHP', 'Rust', 'React', 'Angular', 'Vue', 'iOS / Swift', 'Android / Kotlin', 'Kubernetes', 'Docker', 'Serverless / Lambda', 'Kafka / Event Streaming', 'Redis', 'PostgreSQL', 'MySQL', 'MongoDB', 'Elasticsearch', 'gRPC', 'GraphQL', 'REST APIs'];
const CLOUD_PROVIDERS = ['AWS', 'Google Cloud', 'Azure', 'On-Premises', 'Hybrid', 'Oracle Cloud', 'Alibaba Cloud'];
const COMPLIANCE = ['PCI DSS', 'SOC 2', 'HIPAA', 'GDPR', 'ISO 27001', 'FedRAMP', 'PSD2', 'CCPA', 'NIST'];
const PEAK_PERIODS = ['Black Friday / Cyber Monday', 'Holiday Season (Q4)', 'Back to School', 'Monthly Billing Cycle', 'Tax Season', 'End of Quarter', 'Weekday Business Hours', 'Evenings / Weekends', 'Major Events (sports, launches)', 'None — relatively flat'];
const ONCALL = ['PagerDuty', 'OpsGenie', 'Datadog On-Call', 'VictorOps / Splunk On-Call', 'Manual / Email', 'No formal on-call'];
const TEAM_SIZE = ['1–5 engineers', '6–15 engineers', '16–50 engineers', '51–200 engineers', '201–500 engineers', '500+ engineers'];
const REVENUE_IMPACT = ['< $1K/hour', '$1K–$10K/hour', '$10K–$100K/hour', '$100K–$1M/hour', '> $1M/hour', 'Non-revenue (internal tools)'];
const END_USER_SCALE = ['< 1,000 users', '1K–10K users', '10K–100K users', '100K–1M users', '1M–10M users', '10M+ users', 'B2B (seats-based)'];
const TX_VOLUME = ['< 10K/day', '10K–100K/day', '100K–1M/day', '1M–10M/day', '10M–100M/day', '100M+/day', 'N/A'];
const DEVICE_COUNT = ['None', '< 1,000', '1K–10K', '10K–100K', '100K–500K', '500K+'];
const UPTIME_TARGETS = ['99%', '99.5%', '99.9%', '99.95%', '99.99%', '99.999%', 'No formal SLA'];
const PAIN_POINTS = ['Alert fatigue / too many noisy alerts', 'Lack of service ownership visibility', 'High log costs / over-indexing', 'Custom metrics overage charges', 'Poor tagging hygiene', 'Slow incident response / high MTTR', 'Synthetics coverage gaps on critical flows', 'No SLOs defined for key services', 'K8s observability blind spots', 'Compliance audit readiness', 'Hard to correlate logs/traces/metrics', 'Database performance visibility', 'Security posture visibility (CSPM)', 'Onboarding new services is slow'];
const DD_GOALS = ['Reduce Datadog costs by optimizing configuration', 'Achieve 99.99% uptime on Tier 0 services', 'Implement full Unified Service Tagging (UST)', 'Define SLOs for all Tier 0/1 services', 'Improve synthetic coverage on revenue flows', 'Reduce MTTR from hours to minutes', 'Automate incident routing to the right team', 'Migrate to Flex Logs for cold data', 'Gain full K8s cluster visibility', 'Improve developer self-service via dashboards', 'Achieve compliance audit readiness', 'Forecast capacity for next peak season'];

// ── Main page ──────────────────────────────────────────────────────────────────

const EMPTY: OrgContextData = {
  industry: '', businessDescription: '', techStack: [], cloudProviders: [],
  endUserScale: '', transactionVolume: '', deviceCount: '',
  tier0Description: '', tier1Description: '', tier2Description: '',
  tier0UptimeTarget: '', tier1UptimeTarget: '', revenueImpactPerHour: '',
  seasonalityDescription: '', peakPeriods: [], complianceFrameworks: [],
  devTeamSize: '', hasDedicatedSRE: false, oncallSetup: '',
  currentPainPoints: [], ddGoals: [], additionalContext: '', updatedAt: null,
};

export default function OrgContext() {
  const { selectedOrgId, orgs } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const queryClient = useQueryClient();

  const { data: saved, isLoading } = useQuery({
    queryKey: ['org-context', selectedOrgId],
    queryFn: () => orgContextApi.get(selectedOrgId),
    enabled: Boolean(selectedOrgId),
  });

  const [form, setForm] = useState<OrgContextData>(EMPTY);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (saved) setForm({ ...EMPTY, ...saved });
    else if (!isLoading) setForm(EMPTY);
  }, [saved, isLoading]);

  const mutation = useMutation({
    mutationFn: (data: OrgContextData) => orgContextApi.put(selectedOrgId, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['org-context', selectedOrgId], data);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    },
    onError: (err) => {
      setSaveStatus('error');
      toast.error(err instanceof Error ? err.message : 'Failed to save org profile');
      setTimeout(() => setSaveStatus('idle'), 3000);
    },
  });

  const update = useCallback(<K extends keyof OrgContextData>(key: K, value: OrgContextData[K]) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveStatus('saving');
      saveTimer.current = setTimeout(() => mutation.mutate(next), 900);
      return next;
    });
  }, [mutation]);

  if (!selectedOrgId) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="card text-center py-16 text-ink-faint">
          <div className="text-4xl mb-3">🔍</div>
          <div className="font-semibold text-ink-muted">Select an organization from the header to get started</div>
        </div>
      </div>
    );
  }

  const saveStatusBadge = (
    <div className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all whitespace-nowrap ${
      saveStatus === 'saved' ? 'bg-green-500/15 text-green-400'
      : saveStatus === 'saving' ? 'bg-amber-500/10 text-amber-400'
      : saveStatus === 'error' ? 'bg-red-500/15 text-red-400'
      : 'bg-surface-sunken text-ink-faint'
    }`}>
      {saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Save failed' : 'Auto-saves as you type'}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Getting to Know You"
        subtitle={`Help our AI understand your business so every recommendation is relevant to ${selectedOrg?.name ?? 'your org'} — not a generic org.`}
        actions={saveStatusBadge}
      />

      <div className="bg-dd-purple/5 border border-dd-purple/20 rounded-xl px-4 py-3 text-sm text-dd-purple-dark">
        <strong>Why this matters:</strong> Every AI insight in this app — from log cost optimization to Synthetics coverage gaps — will be tailored to your industry, tech stack, service tiers, and goals. The more context you provide, the more precise the recommendations.
      </div>

      {isLoading ? (
        <div className="card space-y-4">
          <SkeletonText lines={5} />
        </div>
      ) : (
        <div className="space-y-5">

          {/* 1 — About Your Business */}
          <SectionGate featureKey="section.org_context.about_business">
          <Section icon="🏢" title="About Your Business" subtitle="What does your organization do, and who depends on it?">
            <Field label="Industry" hint="Used to apply industry-specific Datadog best practices and cost benchmarks">
              <Select value={form.industry ?? ''} onChange={v => update('industry', v)}
                options={INDUSTRIES.map(i => ({ value: i, label: i }))} placeholder="Select your industry" />
            </Field>
            <Field label="What does your organization do?" hint="Describe your product, customers, and how Datadog supports your operations. The more specific, the better the AI tailoring.">
              <Textarea value={form.businessDescription ?? ''} onChange={v => update('businessDescription', v)}
                placeholder="e.g. We operate payment processing infrastructure for 300K+ POS terminals across North America and Europe. We process ~50M transactions/day across .NET APIs backed by Kubernetes on AWS, with React-based merchant portals and Golang microservices handling settlement and fraud detection." rows={4} />
            </Field>
          </Section>
          </SectionGate>

          {/* 2 — Tech Stack */}
          <SectionGate featureKey="section.org_context.tech_stack">
          <Section icon="⚙️" title="Tech Stack & Infrastructure" subtitle="Powers your tagging strategy, APM service naming, K8s label recommendations, and integration gap analysis.">
            <Field label="Languages & Frameworks">
              <ChipGroup options={TECH_STACK} selected={form.techStack ?? []} onChange={v => update('techStack', v)} allowCustom />
            </Field>
            <Field label="Cloud Providers">
              <ChipGroup options={CLOUD_PROVIDERS} selected={form.cloudProviders ?? []} onChange={v => update('cloudProviders', v)} />
            </Field>
          </Section>
          </SectionGate>

          {/* 3 — Scale */}
          <SectionGate featureKey="section.org_context.scale_volume">
          <Section icon="📊" title="Scale & Volume" subtitle="Informs capacity forecasting, custom metric allotment risk, and log volume projections.">
            <div className="grid grid-cols-3 gap-4">
              <Field label="End users" hint="Active users or accounts">
                <Select value={form.endUserScale ?? ''} onChange={v => update('endUserScale', v)}
                  options={END_USER_SCALE.map(i => ({ value: i, label: i }))} placeholder="Select range" />
              </Field>
              <Field label="Transactions / day" hint="API calls, payments, events">
                <Select value={form.transactionVolume ?? ''} onChange={v => update('transactionVolume', v)}
                  options={TX_VOLUME.map(i => ({ value: i, label: i }))} placeholder="Select range" />
              </Field>
              <Field label="Managed devices" hint="POS terminals, IoT, NDM devices">
                <Select value={form.deviceCount ?? ''} onChange={v => update('deviceCount', v)}
                  options={DEVICE_COUNT.map(i => ({ value: i, label: i }))} placeholder="Select range" />
              </Field>
            </div>
          </Section>
          </SectionGate>

          {/* 4 — Service Tiers */}
          <SectionGate featureKey="section.org_context.service_tiers">
          <Section icon="🎯" title="Service Criticality Tiers" subtitle="Drives Synthetics coverage recommendations, alerting thresholds, SLO targets, and log retention by tier.">
            <div className="space-y-4">
              {([
                { tier: '0', label: 'Tier 0 — Mission Critical', placeholder: 'e.g. Payment processing API, Auth service, Fraud detection — direct revenue impact and highest uptime requirement', uptimeKey: 'tier0UptimeTarget' as const, descKey: 'tier0Description' as const },
                { tier: '1', label: 'Tier 1 — Business Critical', placeholder: 'e.g. Merchant portal, Settlement service, Reporting API — significant impact if down but can tolerate brief degradation', uptimeKey: 'tier1UptimeTarget' as const, descKey: 'tier1Description' as const },
                { tier: '2', label: 'Tier 2 — Supporting Services', placeholder: 'e.g. Admin tools, Internal dashboards, Batch jobs — limited user impact, longer acceptable downtime', uptimeKey: null, descKey: 'tier2Description' as const },
              ] as const).map(({ tier, label, placeholder, uptimeKey, descKey }) => (
                <div key={tier} className={`rounded-xl p-4 border space-y-3 ${
                  tier === '0' ? 'bg-red-500/10 border-red-500/30' : tier === '1' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-surface-subtle border-border'
                }`}>
                  <div className="font-semibold text-sm text-ink">{label}</div>
                  <input className="input text-sm w-full" placeholder={placeholder}
                    value={(form[descKey] as string) ?? ''}
                    onChange={e => update(descKey, e.target.value)} />
                  {uptimeKey && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-ink-faint shrink-0">Uptime target:</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {UPTIME_TARGETS.map(t => (
                          <button key={t} type="button" onClick={() => update(uptimeKey, t)}
                            className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
                              form[uptimeKey] === t ? 'bg-dd-purple text-white border-dd-purple' : 'bg-surface-subtle text-ink-muted border-border-strong hover:border-dd-purple/50'
                            }`}>{t}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
          </SectionGate>

          {/* 5 — Revenue & Compliance */}
          <SectionGate featureKey="section.org_context.revenue_compliance">
          <Section icon="💰" title="Revenue & Compliance" subtitle="Helps quantify the cost of downtime and ensures recommendations meet your regulatory requirements.">
            <Field label="Revenue impact of Tier 0 downtime" hint="How much revenue is at risk per hour of outage? Used to prioritize alerting and Synthetics recommendations.">
              <div className="flex flex-wrap gap-2 mt-2">
                {REVENUE_IMPACT.map(r => (
                  <button key={r} type="button" onClick={() => update('revenueImpactPerHour', r)}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
                      form.revenueImpactPerHour === r ? 'bg-dd-purple text-white border-dd-purple' : 'bg-surface-subtle text-ink-muted border-border-strong hover:border-dd-purple/50'
                    }`}>{r}</button>
                ))}
              </div>
            </Field>
            <Field label="Compliance & Regulatory Frameworks" hint="Surfaces relevant log retention, audit trail, and access control recommendations.">
              <ChipGroup options={COMPLIANCE} selected={form.complianceFrameworks ?? []} onChange={v => update('complianceFrameworks', v)} allowCustom />
            </Field>
          </Section>
          </SectionGate>

          {/* 6 — Seasonality */}
          <SectionGate featureKey="section.org_context.seasonality">
          <Section icon="📅" title="Seasonality & Traffic Patterns" subtitle="Used for capacity planning, Synthetics schedule recommendations, and log volume forecasting.">
            <Field label="Known peak periods">
              <ChipGroup options={PEAK_PERIODS} selected={form.peakPeriods ?? []} onChange={v => update('peakPeriods', v)} />
            </Field>
            <Field label="Describe your traffic patterns" hint="e.g. 3× traffic spike during Q4 holiday season; evenings see 40% higher terminal activity in Europe">
              <Textarea value={form.seasonalityDescription ?? ''} onChange={v => update('seasonalityDescription', v)}
                placeholder="Describe any seasonal or time-of-day patterns, expected growth rates, or planned events that drive traffic spikes..." rows={3} />
            </Field>
          </Section>
          </SectionGate>

          {/* 7 — Team & Operations */}
          <SectionGate featureKey="section.org_context.team_ops">
          <Section icon="👥" title="Team & Operations" subtitle="Aligns alert routing, on-call recommendations, and team ownership tagging strategies.">
            <div className="grid grid-cols-3 gap-4">
              <Field label="Engineering team size">
                <Select value={form.devTeamSize ?? ''} onChange={v => update('devTeamSize', v)}
                  options={TEAM_SIZE.map(i => ({ value: i, label: i }))} placeholder="Select range" />
              </Field>
              <Field label="Dedicated SRE / Ops team?">
                <div className="flex gap-2 mt-2">
                  {['Yes', 'No'].map(v => (
                    <button key={v} type="button" onClick={() => update('hasDedicatedSRE', v === 'Yes')}
                      className={`flex-1 text-sm px-3 py-2 rounded-lg border font-medium transition-all ${
                        (form.hasDedicatedSRE ? 'Yes' : 'No') === v ? 'bg-dd-purple text-white border-dd-purple' : 'bg-surface-subtle text-ink-muted border-border-strong hover:border-dd-purple/50'
                      }`}>{v}</button>
                  ))}
                </div>
              </Field>
              <Field label="On-call tooling">
                <Select value={form.oncallSetup ?? ''} onChange={v => update('oncallSetup', v)}
                  options={ONCALL.map(i => ({ value: i, label: i }))} placeholder="Select" />
              </Field>
            </div>
          </Section>
          </SectionGate>

          {/* 8 — Goals & Pain Points */}
          <SectionGate featureKey="section.org_context.goals_pain_points">
          <Section icon="🎯" title="Goals & Current Pain Points" subtitle="Prioritizes AI recommendations toward the outcomes that matter most to your team.">
            <Field label="What's hurting most right now?" hint="Select all that apply — the AI will address these first in its recommendations.">
              <ChipGroup options={PAIN_POINTS} selected={form.currentPainPoints ?? []} onChange={v => update('currentPainPoints', v)} allowCustom />
            </Field>
            <Field label="What do you want to achieve with Datadog?">
              <ChipGroup options={DD_GOALS} selected={form.ddGoals ?? []} onChange={v => update('ddGoals', v)} allowCustom />
            </Field>
            <Field label="Anything else the AI should know?" hint="Free-form context: architecture decisions, known issues, upcoming migrations, constraints, etc.">
              <Textarea value={form.additionalContext ?? ''} onChange={v => update('additionalContext', v)}
                placeholder="e.g. We're migrating from ECS to EKS over the next 6 months. We have a hard cap on Datadog spend. Our on-call team is in 3 time zones. We're onboarding 5 new microservices by Q3..." rows={4} />
            </Field>
          </Section>
          </SectionGate>

          {saved?.updatedAt && (
            <p className="text-xs text-center text-ink-faint">
              Profile last saved {new Date(saved.updatedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
