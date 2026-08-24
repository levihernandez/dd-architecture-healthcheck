import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { analyticsApi, usageApi, pricingSnapshotsApi, sizingSnapshotsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { useMultiOrgSizing, type MultiOrgRow } from '../hooks/useMultiOrgSizing';
import OrgQuickLink from '../components/common/OrgQuickLink';
import type { AnalyticsData, UsageData, PricingSnapshot, SizingSnapshotSummary, SizingSnapshotRecord } from '../types';

// ─── Persistence ──────────────────────────────────────────────────────────────
// Every calculator input is backed by localStorage under this prefix, so switching
// tabs or reloading the page keeps whatever was last configured instead of resetting
// to defaults.
const PERSIST_PREFIX = 'dd-calc:';

function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const storageKey = PERSIST_PREFIX + key;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw != null ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }, [storageKey, value]);
  return [value, setValue];
}

// Snapshots every persisted calculator field (all 15 calculators' inputs, plus page-level
// mode/activeId/cart) into a plain object so it can be saved and restored later.
function collectPersistedState(): Record<string, string> {
  const state: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PERSIST_PREFIX)) {
        const value = localStorage.getItem(key);
        if (value != null) state[key] = value;
      }
    }
  } catch { /* storage unavailable */ }
  return state;
}

// Writes a previously-saved state blob back into localStorage. The caller is responsible
// for reloading the page afterwards so every usePersistedState hook re-reads fresh values.
function restorePersistedState(state: Record<string, unknown>) {
  try {
    for (const [key, value] of Object.entries(state)) {
      if (typeof value === 'string') localStorage.setItem(key, value);
    }
  } catch { /* storage unavailable */ }
}

// Fires `resetFn` exactly once whenever `mode` transitions INTO 'blank' — used so
// Blank Project mode always starts every input at zero instead of showing whatever
// was persisted from Current Org / a previous Blank session.
function useResetOnBlank(mode: SizingMode, resetFn: () => void) {
  const prevMode = useRef(mode);
  useEffect(() => {
    if (mode === 'blank' && prevMode.current !== 'blank') resetFn();
    prevMode.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
}

// Mode-namespaced persistence: Blank Project keeps its own persisted slot (so it can be
// zeroed out via useResetOnBlank without touching anything), while Current Org and Multi-Org
// share a "main" slot — so switching out of Blank and back to Current always restores what
// you last configured there, instead of the blank-mode zeros bleeding across modes.
function useModeState<T>(mode: SizingMode, key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [mainValue, setMainValue] = usePersistedState<T>(`${key}.main`, defaultValue);
  const [blankValue, setBlankValue] = usePersistedState<T>(`${key}.blank`, defaultValue);
  return mode === 'blank' ? [blankValue, setBlankValue] : [mainValue, setMainValue];
}

// ─── Sizing Modes (Current Org + Growth / Blank Project / Multi-Org) ─────────

type SizingMode = 'current' | 'blank' | 'multi';

// Props every calculator receives, threaded down from the page-level mode toggle.
type SizingModeProps = {
  mode: SizingMode;
  usageData?: UsageData | null;
  multiOrg: MultiOrgRow[];
  multiOrgLoading: boolean;
  reportCost: (item: CartItem) => void;
};

// One line item in the cross-category cost breakdown ("shopping cart") panel.
// One granular billing line within a category — what an invoice needs that a single
// rolled-up cost number doesn't: the SKU, the quantity driving it, the rate, and the amount.
type SkuLine = { sku: string; description: string; quantity: number; unit: string; rate: number; amount: number };

type CartItem = {
  id: string;
  label: string;
  icon: string;
  primaryMetric: string;
  listPriceCost: number;
  realCost?: number;
  skuLines?: SkuLine[];
};

function sumUsageProducts(usageData: UsageData | null | undefined, names: string[]) {
  if (!usageData) return null;
  const matched = usageData.products.filter(p => names.includes(p.name));
  if (!matched.length) return null;
  return {
    value: matched.reduce((s, p) => s + (p.value ?? 0), 0),
    committedCost: matched.reduce((s, p) => s + p.committedCost, 0),
    onDemandCost: matched.reduce((s, p) => s + p.onDemandCost, 0),
  };
}

function ModeToggle({ mode, onChange, hasOrgs, hasMultipleOrgs }: {
  mode: SizingMode; onChange: (m: SizingMode) => void; hasOrgs: boolean; hasMultipleOrgs: boolean;
}) {
  const opts: Array<{ id: SizingMode; icon: string; label: string; sub: string; disabled?: boolean }> = [
    { id: 'current', icon: '📡', label: 'Current Org + Growth', sub: 'baseline from real usage/cost', disabled: !hasOrgs },
    { id: 'blank', icon: '📄', label: 'Blank Project', sub: 'ignore org, size from scratch' },
    { id: 'multi', icon: '🌐', label: 'Multi-Org Rollup', sub: 'breakdown across all connected orgs', disabled: !hasMultipleOrgs },
  ];
  return (
    <div className="flex flex-wrap items-stretch gap-1 bg-surface-subtle border border-border rounded-xl p-1 mb-4 w-fit">
      {opts.map(o => (
        <button
          key={o.id}
          disabled={o.disabled}
          onClick={() => onChange(o.id)}
          title={o.disabled ? (o.id === 'current' ? 'Connect a Datadog org to use this mode' : 'Connect more than one org to use this mode') : undefined}
          className={`text-left px-3 py-2 rounded-lg transition-colors ${
            mode === o.id ? 'bg-violet-600 text-white' : o.disabled ? 'text-ink-faint cursor-not-allowed opacity-50' : 'text-ink-muted hover:bg-surface-sunken'
          }`}
        >
          <div className="text-xs font-semibold flex items-center gap-1.5">{o.icon} {o.label}</div>
          <div className={`text-[10px] mt-0.5 ${mode === o.id ? 'text-violet-200' : 'text-ink-faint'}`}>{o.sub}</div>
        </button>
      ))}
    </div>
  );
}

function CostSavingsCard({
  label, usageValue, usageUnit, committedCost, onDemandCost, listPriceCost,
}: {
  label: string; usageValue: number | null; usageUnit: string;
  committedCost: number; onDemandCost: number; listPriceCost: number;
}) {
  const realCost = committedCost + onDemandCost;
  const savings = listPriceCost - realCost;
  const savingsPct = listPriceCost > 0 ? Math.round((Math.abs(savings) / listPriceCost) * 100) : 0;
  return (
    <div className="rounded-xl border border-emerald-500/30 overflow-hidden">
      <div className="bg-emerald-900 text-white px-4 py-3">
        <div className="text-sm font-semibold flex items-center gap-2">💵 Real Cost vs. List Price — {label}</div>
        <div className="text-xs text-emerald-300">From this org's actual Datadog Usage API data this billing period</div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border bg-surface-subtle">
        <div className="p-4">
          <div className="text-xs text-ink-muted uppercase font-medium tracking-wide">Real Cost</div>
          <div className="text-xl font-bold text-ink mt-1 tabular-nums">${Math.round(realCost).toLocaleString()}/mo</div>
          <div className="text-xs text-ink-faint mt-1">{fmtNum(usageValue ?? 0)} {usageUnit} · committed + on-demand</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-ink-muted uppercase font-medium tracking-wide">List Price Equivalent</div>
          <div className="text-xl font-bold text-ink mt-1 tabular-nums">${Math.round(listPriceCost).toLocaleString()}/mo</div>
          <div className="text-xs text-ink-faint mt-1">at public on-demand rates</div>
        </div>
        <div className={`p-4 ${savings > 0 ? 'bg-emerald-500/10' : savings < 0 ? 'bg-red-500/10' : ''}`}>
          <div className="text-xs text-ink-muted uppercase font-medium tracking-wide">{savings >= 0 ? 'Savings vs. list' : 'Over list price'}</div>
          <div className={`text-xl font-bold mt-1 tabular-nums ${savings >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {savings >= 0 ? '−' : '+'}${Math.round(Math.abs(savings)).toLocaleString()}/mo
          </div>
          <div className="text-xs text-ink-faint mt-1">{savingsPct}% {savings >= 0 ? 'below' : 'above'} list price</div>
        </div>
      </div>
    </div>
  );
}

type OrgUsageCostRow = { orgName: string; orgId?: string; usage: number | null; cost: number; costIsEstimate?: boolean };

function MultiOrgBreakdown({
  title, rows, growthRate, usageUnit, isLoading,
}: {
  title: string; rows: OrgUsageCostRow[]; growthRate: number; usageUnit: string; isLoading?: boolean;
}) {
  const g = growthRate / 100;
  const totalUsage = rows.reduce((s, r) => s + (r.usage ?? 0), 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const anyEstimate = rows.some(r => r.costIsEstimate);
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="bg-gray-800 text-white px-4 py-2.5 flex items-center gap-2">
          <span>🌐</span>
          <span className="text-sm font-semibold">{title} — All Connected Orgs</span>
          {isLoading && <span className="text-xs text-ink-faint ml-auto">loading…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-subtle text-ink-muted text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">Org</th>
                <th className="text-right px-4 py-2">Current Usage</th>
                <th className="text-right px-4 py-2">Current Cost</th>
                <th className="text-right px-4 py-2 bg-violet-500/10 text-violet-400">+1yr Usage ({growthRate}%)</th>
                <th className="text-right px-4 py-2 bg-violet-500/10 text-violet-400">+1yr Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && !isLoading && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-faint text-sm">No completed scans found across connected orgs yet.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="bg-surface-subtle even:bg-surface-subtle/40">
                  <td className="px-4 py-2.5 font-medium text-ink">
                    <OrgQuickLink orgId={r.orgId ?? ''} orgName={r.orgName} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.usage != null ? fmtNum(r.usage) : '—'} <span className="text-xs text-ink-faint">{usageUnit}</span></td>
                  <td className="px-4 py-2.5 text-right font-mono">${Math.round(r.cost).toLocaleString()}{r.costIsEstimate ? '*' : ''}</td>
                  <td className="px-4 py-2.5 text-right font-mono bg-violet-500/40">{r.usage != null ? fmtNum(r.usage * (1 + g)) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono bg-violet-500/40">${Math.round(r.cost * (1 + g)).toLocaleString()}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-surface-sunken font-bold">
                  <td className="px-4 py-3 text-ink">Total ({rows.length} org{rows.length === 1 ? '' : 's'})</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtNum(totalUsage)} {usageUnit}</td>
                  <td className="px-4 py-3 text-right font-mono">${Math.round(totalCost).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-violet-400">{fmtNum(totalUsage * (1 + g))}</td>
                  <td className="px-4 py-3 text-right font-mono text-violet-400">${Math.round(totalCost * (1 + g)).toLocaleString()}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {anyEstimate && (
          <div className="px-4 py-2 text-xs text-ink-faint bg-surface-subtle border-t border-border">
            * No direct Datadog Usage API mapping for this product on that org — cost is a list-price estimate from scanned usage, not real billing.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center ml-1 align-middle">
      <span className="w-3.5 h-3.5 rounded-full bg-surface-sunken text-ink-faint text-[9px] font-bold flex items-center justify-center cursor-help border border-border shrink-0">?</span>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-56 rounded-lg bg-gray-900 text-white text-xs leading-snug px-2.5 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg">
        {text}
      </span>
    </span>
  );
}

function PresetBar({ presets, active, onSelect }: {
  presets: Array<{ id: string; label: string; sub?: string }>;
  active: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/50 p-3">
      <div className="text-xs font-semibold text-violet-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <span>✨</span> Quick size — pick a starting point
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map(p => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              active === p.id ? 'bg-violet-600 text-white border-violet-600' : 'bg-surface-subtle text-ink-muted border-border hover:border-violet-500/30 hover:text-violet-400'
            }`}
          >
            {p.label}
            {p.sub && <span className={`ml-1.5 font-normal ${active === p.id ? 'text-violet-200' : 'text-ink-faint'}`}>{p.sub}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Advanced({ children, label = 'Advanced settings' }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="group border-t border-border pt-3">
      <summary className="cursor-pointer text-xs font-semibold text-ink-muted uppercase tracking-wide flex items-center gap-1.5 select-none list-none marker:content-none">
        <span className="inline-block transition-transform group-open:rotate-90 text-ink-faint">▸</span>
        {label}
      </summary>
      <div className="mt-4 space-y-5">{children}</div>
    </details>
  );
}

function SliderInput({
  label, value, min, max, step = 1, unit = '', hint, info, onChange, log: isLog = false,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  unit?: string; hint?: string; info?: string; onChange: (v: number) => void; log?: boolean;
}) {
  const toSlider = (v: number) => isLog ? Math.log10(Math.max(v, 1)) : v;
  const fromSlider = (s: number) => isLog ? Math.round(Math.pow(10, s)) : s;
  const sliderMin = isLog ? Math.log10(Math.max(min, 1)) : min;
  const sliderMax = isLog ? Math.log10(max) : max;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-ink-muted leading-tight">{label}{info && <InfoTip text={info} />}</label>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
            }}
            className="w-24 text-right text-sm font-bold text-violet-400 border border-violet-500/30 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          {unit && <span className="text-xs text-ink-faint w-16 leading-tight">{unit}</span>}
        </div>
      </div>
      <input
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={isLog ? (sliderMax - sliderMin) / 200 : step}
        value={toSlider(value)}
        onChange={(e) => onChange(Math.max(min, Math.min(max, fromSlider(Number(e.target.value)))))}
        className="w-full accent-violet-600 h-1.5 cursor-pointer"
      />
      {hint && <p className="text-xs text-ink-faint leading-tight">{hint}</p>}
    </div>
  );
}

function SelectInput({
  label, value, options, onChange, hint, info,
}: {
  label: string; value: string | number;
  options: Array<{ value: string | number; label: string }>;
  onChange: (v: string) => void; hint?: string; info?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-ink-muted">{label}{info && <InfoTip text={info} />}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400 bg-surface-subtle"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

function ResultCard({
  label, value, sub, color = 'gray',
}: {
  label: string; value: string; sub?: string;
  color?: 'gray' | 'violet' | 'amber' | 'green' | 'red' | 'blue';
}) {
  const colors = {
    gray: 'bg-surface-subtle border-border text-ink',
    violet: 'bg-violet-500/10 border-violet-500/30 text-violet-400',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    green: 'bg-green-500/10 border-green-500/30 text-green-400',
    red: 'bg-red-500/10 border-red-500/30 text-red-400',
    blue: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="text-xs text-ink-muted mb-1 font-medium uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-0.5 leading-tight">{sub}</div>}
    </div>
  );
}

function SizingBlock({ title, icon, rows }: {
  title: string; icon: string; rows: Array<{ label: string; value: string; note?: string }>;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-800 text-white flex items-center gap-2">
        <span>{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="divide-y divide-border">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5 bg-surface-subtle even:bg-surface-subtle/50">
            <span className="text-sm text-ink-muted">{r.label}</span>
            <div className="text-right">
              <span className="text-sm font-mono font-bold text-ink">{r.value}</span>
              {r.note && <div className="text-xs text-ink-faint">{r.note}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GrowthTable({ rows, growthRate }: {
  rows: Array<{ label: string; baseline: number; unit: string; formatter?: (n: number) => string }>;
  growthRate: number;
}) {
  const g = growthRate / 100;
  const project = (base: number, years: number) => base * Math.pow(1 + g, years);
  const fmt = (n: number, formatter?: (n: number) => string) => {
    if (formatter) return formatter(n);
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return Math.round(n).toLocaleString();
  };
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="bg-gray-800 text-white px-4 py-2.5 flex items-center gap-2">
        <span>📈</span>
        <span className="text-sm font-semibold">Growth Projection ({growthRate}% YoY)</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-subtle text-ink-muted text-xs uppercase tracking-wide">
            <th className="text-left px-4 py-2">Metric</th>
            <th className="text-right px-4 py-2">Now</th>
            <th className="text-right px-4 py-2 bg-violet-500/10 text-violet-400">+1 Year</th>
            <th className="text-right px-4 py-2">+2 Years</th>
            <th className="text-right px-4 py-2">+3 Years</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i} className="bg-surface-subtle even:bg-surface-subtle/40">
              <td className="px-4 py-2.5 text-ink-muted">{r.label}</td>
              <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink">
                {fmt(r.baseline, r.formatter)} <span className="text-xs font-normal text-ink-faint">{r.unit}</span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono font-bold text-violet-400 bg-violet-500/40">
                {fmt(project(r.baseline, 1), r.formatter)} <span className="text-xs font-normal">{r.unit}</span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-ink-muted">
                {fmt(project(r.baseline, 2), r.formatter)} <span className="text-xs font-normal text-ink-faint">{r.unit}</span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-ink-muted">
                {fmt(project(r.baseline, 3), r.formatter)} <span className="text-xs font-normal text-ink-faint">{r.unit}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalcHeader({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        <span className="text-3xl">{icon}</span>
        <div>
          <h1 className="text-xl font-bold text-ink">{title}</h1>
          <p className="text-sm text-ink-muted mt-0.5">{description}</p>
        </div>
      </div>
    </div>
  );
}

function ScanContext({
  id, items, onLoad,
}: {
  id: string;
  items: Array<{ label: string; actual: string; note?: string }>;
  onLoad?: () => void;
}) {
  // Auto-apply scan-derived values the first time ever a user visits this calculator, so it
  // starts pre-sized to the real org. Persisted (not a mount-local ref) so revisiting the tab
  // or reloading the page doesn't keep clobbering manual edits with scan data every time.
  const [hasAutoLoaded, setHasAutoLoaded] = usePersistedState(`scanAutoLoaded.${id}`, false);
  React.useEffect(() => {
    if (onLoad && !hasAutoLoaded) {
      setHasAutoLoaded(true);
      onLoad();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLoad, hasAutoLoaded]);

  return (
    <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-1">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-blue-400 text-base">📡</span>
          <span className="text-sm font-semibold text-blue-400">Current Usage — last scan</span>
          <span className="text-xs text-blue-500">(applied below automatically)</span>
        </div>
        {onLoad && (
          <button
            onClick={onLoad}
            className="text-xs bg-blue-600 text-white px-3 py-1 rounded-full font-medium hover:bg-blue-700 transition-colors shrink-0"
          >
            Reapply scan values ↓
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {items.map((item, i) => (
          <div key={i} className="bg-surface-subtle/80 rounded-lg px-3 py-2">
            <div className="text-xs text-blue-500 mb-0.5">{item.label}</div>
            <div className="text-sm font-bold text-blue-900 font-mono">{item.actual}</div>
            {item.note && <div className="text-xs text-blue-400 mt-0.5 leading-tight">{item.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

const fmtNum = (n: number) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
};

// ─── Pricing & Baselines ──────────────────────────────────────────────────────

// List prices below marked "confirmed" were captured from https://www.datadoghq.com/pricing/list/
// (see the Pricing History panel for the full timestamped snapshot). The rest are this app's
// own estimates for products without a directly comparable public per-unit price.
// Rates below are annual-committed list prices, cross-checked against two sources:
// (1) https://www.datadoghq.com/pricing/list/ (public marketing page)
// (2) Datadog's internal sizing/pricing calculator spreadsheet, which breaks every
//     product into M2M vs Annual committed rates plus on-demand monthly/hourly rates.
// Where the two disagreed (RUM, ASM, CI), the sizing spreadsheet wins — it's the
// purpose-built pricing tool, the marketing page numbers were self-serve/promo rates.
const DD_PRICES = {
  infraHostPro: 15,          // confirmed — both sources agree
  infraHostEnt: 23,          // confirmed — both sources agree
  containerMonthly: 1,       // confirmed — flat per container/month, not per-hour
  apmHost: 31,               // confirmed — APM Standard, both sources agree
  logsIngestGb: 0.10,        // confirmed
  logsIndexMillion: 2.50,    // 30-day retention tier; see LOG_INDEX_PRICE_BY_RETENTION for the full tiered table
  logsFlexHotGb: 0.05,
  logsFlexFrozenGb: 0.01,
  customMetricsPer100: 5,    // confirmed
  syntheticsApi10k: 5,       // confirmed
  syntheticsBrowser1k: 12,   // confirmed
  rumSession1k: 1.50,        // confirmed via sizing sheet (Browser/Mobile Sessions, Annual)
  rumMobileSession1k: 1.50,  // same combined Browser/Mobile rate per sizing sheet
  rumReplay1k: 1.80,         // confirmed via sizing sheet (Premium/Replay Sessions, Annual)
  npmHost: 5,                // confirmed — both sources agree
  dbmInstance: 70,           // confirmed — both sources agree
  profilerHost: 19,          // confirmed (public page; bundled into APM Enterprise in the sizing sheet)
  ciCommitter: 8,            // confirmed — CI Pipeline Visibility, Annual. Test Optimization is a separate $20/committer add-on.
  ndmDevice: 7,              // confirmed — both sources agree
  cspmHostAnnual: 10,        // confirmed — Cloud Security Management PRO, per host, Annual (Enterprise tier is $25/host)
  opwGb: 0.095,              // confirmed
  asmHost: 31,               // confirmed — ASM Threat Management, per host, Annual (Vulnerability Mgt alone is $10/host)
  serverlessFunction: 5,     // estimate — per function/mo, verify against pricing page
  fargateTask: 3,            // estimate — per task/mo
  ccmPctOfSpend: 0.033,      // estimate — Cloud Cost Management, % of managed cloud spend/mo
  cloudSiemGb: 0.20,         // estimate — per analyzed GB/day equivalent, distinct SKU from log ingest
  sdsScannedGb: 0.05,        // estimate — Sensitive Data Scanner, per GB scanned
  usmHost: 4,                // estimate — Universal Service Monitoring, per host/mo add-on
  dsmHost: 4,                // estimate — Data Streams Monitoring, per host/mo
  djmHost: 4,                // estimate — Data Jobs Monitoring, per compute host/mo
  llmObsSpan1k: 5,           // estimate — LLM Observability, per 1K spans
  onCallUser: 27,            // estimate — On-Call, per responder seat/mo
  cloudNetworkInterface: 4,  // estimate — Cloud Network Monitoring, per monitored network interface/mo (VPC subnet, NAT GW, Transit GW attachment)
  featureFlagPer1M: 55,      // confirmed via sizing sheet — per 1M Monthly Feature Change Requests (MFCRs), Annual
  workflowAutomationPer100: 10, // confirmed via sizing sheet — per 100 executions/mo, Annual
  productAnalytics1k: 0.80,  // confirmed via datadoghq.com/pricing/list — per 1K sessions/mo
};


type BaselineRange = { label: string; low: number; mid: number; high: number; unit: string };

const TIER_BASELINES: Partial<Record<string, Record<string, BaselineRange[]>>> = {
  infra: {
    'Startup (<50)':        [{ label: 'Hosts', low: 5, mid: 20, high: 50, unit: '' }, { label: 'Custom Metrics', low: 500, mid: 3000, high: 8000, unit: '' }],
    'Growth (50-250)':      [{ label: 'Hosts', low: 50, mid: 130, high: 250, unit: '' }, { label: 'Custom Metrics', low: 8000, mid: 40000, high: 100000, unit: '' }],
    'Mid-Market (250-999)': [{ label: 'Hosts', low: 250, mid: 550, high: 999, unit: '' }, { label: 'Custom Metrics', low: 100000, mid: 300000, high: 700000, unit: '' }],
    'Enterprise (1000+)':   [{ label: 'Hosts', low: 1000, mid: 4000, high: 15000, unit: '' }, { label: 'Custom Metrics', low: 700000, mid: 3000000, high: 20000000, unit: '' }],
  },
  logs: {
    'Startup (<50)':        [{ label: 'Daily Ingest', low: 1, mid: 10, high: 30, unit: 'GB/day' }],
    'Growth (50-250)':      [{ label: 'Daily Ingest', low: 30, mid: 100, high: 300, unit: 'GB/day' }],
    'Mid-Market (250-999)': [{ label: 'Daily Ingest', low: 300, mid: 1000, high: 3000, unit: 'GB/day' }],
    'Enterprise (1000+)':   [{ label: 'Daily Ingest', low: 3000, mid: 10000, high: 50000, unit: 'GB/day' }],
  },
  apm: {
    'Startup (<50)':        [{ label: 'APM Services', low: 3, mid: 10, high: 25, unit: '' }],
    'Growth (50-250)':      [{ label: 'APM Services', low: 25, mid: 60, high: 100, unit: '' }],
    'Mid-Market (250-999)': [{ label: 'APM Services', low: 100, mid: 250, high: 500, unit: '' }],
    'Enterprise (1000+)':   [{ label: 'APM Services', low: 500, mid: 1500, high: 5000, unit: '' }],
  },
  rum: {
    'Startup (<50)':        [{ label: 'Sessions/mo', low: 10000, mid: 100000, high: 500000, unit: '' }],
    'Growth (50-250)':      [{ label: 'Sessions/mo', low: 500000, mid: 2000000, high: 5000000, unit: '' }],
    'Mid-Market (250-999)': [{ label: 'Sessions/mo', low: 5000000, mid: 15000000, high: 30000000, unit: '' }],
    'Enterprise (1000+)':   [{ label: 'Sessions/mo', low: 30000000, mid: 100000000, high: 500000000, unit: '' }],
  },
  synthetics: {
    'Startup (<50)':        [{ label: 'API Runs/mo', low: 50000, mid: 200000, high: 500000, unit: '' }, { label: 'Browser Runs/mo', low: 1000, mid: 5000, high: 20000, unit: '' }],
    'Growth (50-250)':      [{ label: 'API Runs/mo', low: 500000, mid: 2000000, high: 5000000, unit: '' }, { label: 'Browser Runs/mo', low: 20000, mid: 100000, high: 500000, unit: '' }],
    'Mid-Market (250-999)': [{ label: 'API Runs/mo', low: 5000000, mid: 15000000, high: 30000000, unit: '' }, { label: 'Browser Runs/mo', low: 500000, mid: 1500000, high: 5000000, unit: '' }],
    'Enterprise (1000+)':   [{ label: 'API Runs/mo', low: 30000000, mid: 100000000, high: 500000000, unit: '' }, { label: 'Browser Runs/mo', low: 5000000, mid: 15000000, high: 50000000, unit: '' }],
  },
};

// Preset ids (small/mid/large/enterprise) map 1:1 to TIER_BASELINES buckets by org size.
const TIER_KEYS = ['Startup (<50)', 'Growth (50-250)', 'Mid-Market (250-999)', 'Enterprise (1000+)'];
const PRESET_TO_TIER: Record<string, string> = { small: TIER_KEYS[0], mid: TIER_KEYS[1], large: TIER_KEYS[2], enterprise: TIER_KEYS[3] };

type PriceLine = { label: string; qty: number; unit: string; rate: string; monthly: number };

function PricingEstimate({ lines, note }: { lines: PriceLine[]; note?: string }) {
  const active = lines.filter(l => l.monthly > 0.5);
  const total = active.reduce((s, l) => s + l.monthly, 0);
  if (!active.length) return null;
  return (
    <div className="rounded-xl border border-emerald-500/30 overflow-hidden">
      <div className="bg-emerald-900 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>💰</span>
          <div>
            <div className="text-sm font-semibold">Estimated Monthly Cost</div>
            <div className="text-xs text-emerald-300">Datadog public list pricing</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums">${Math.round(total).toLocaleString()}</div>
          <div className="text-xs text-emerald-300">per month (list price)</div>
        </div>
      </div>
      <div className="divide-y divide-border bg-surface-subtle">
        {active.map((l, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5 even:bg-surface-subtle/40 hover:bg-violet-500/20">
            <span className="text-sm text-ink-muted">{l.label}</span>
            <div className="text-right">
              <div className="text-xs text-ink-faint font-mono">{l.qty.toLocaleString()} {l.unit} @ {l.rate}</div>
              <div className="text-sm font-bold font-mono text-ink">${Math.round(l.monthly).toLocaleString()}</div>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3 bg-emerald-500/10">
          <span className="font-bold text-ink">Total Estimated</span>
          <span className="text-xl font-bold font-mono text-emerald-400">${Math.round(total).toLocaleString()}/mo</span>
        </div>
      </div>
      {note && <div className="px-4 py-2.5 bg-amber-500/10 text-xs text-amber-400 border-t border-amber-100">ⓘ {note}</div>}
      <div className="px-4 py-2 text-xs text-ink-faint bg-surface-subtle border-t border-border">
        List pricing only — enterprise/committed rates typically 20–50% lower. Contact Datadog sales for quotes.
      </div>
    </div>
  );
}

function BaselineCard({ tier, ranges, currentValues }: {
  tier: string;
  ranges: BaselineRange[];
  currentValues: number[];
}) {
  if (!ranges.length) return null;
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="bg-gray-700 text-white px-4 py-2.5 flex items-center gap-2">
        <span>📊</span>
        <span className="text-sm font-semibold">Industry Baselines — {tier}</span>
        <span className="text-xs text-ink-faint ml-auto">Typical ranges for your org size</span>
      </div>
      <div className="p-4 space-y-4 bg-surface-subtle">
        {ranges.map((r, i) => {
          const current = currentValues[i] ?? 0;
          const maxVal = r.high * 2;
          const lowPct = Math.min(85, (r.low / maxVal) * 100);
          const highPct = Math.min(85, (r.high / maxVal) * 100);
          const currPct = Math.min(97, (current / maxVal) * 100);
          const inRange = current >= r.low && current <= r.high;
          const below = current > 0 && current < r.low;
          return (
            <div key={i}>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-medium text-ink-muted">{r.label}</span>
                <span className={`font-semibold px-2 py-0.5 rounded-full text-[10px] ${inRange ? 'bg-green-500/15 text-green-400' : below ? 'bg-blue-500/15 text-blue-400' : current > 0 ? 'bg-amber-500/15 text-amber-400' : 'bg-surface-sunken text-ink-muted'}`}>
                  {current > 0 ? (inRange ? '✓ Typical' : below ? '↓ Below typical' : '↑ Above typical') : 'No scan data'}
                  {current > 0 ? ` · ${fmtNum(current)}${r.unit ? ` ${r.unit}` : ''}` : ''}
                </span>
              </div>
              <div className="relative h-4 bg-surface-sunken rounded-full overflow-hidden">
                <div className="absolute top-0 h-full bg-green-200" style={{ left: `${lowPct}%`, width: `${Math.max(0, highPct - lowPct)}%` }} />
                {current > 0 && <div className="absolute top-0 h-full w-1 bg-violet-600" style={{ left: `${currPct}%` }} />}
              </div>
              <div className="flex justify-between text-[10px] text-ink-faint mt-0.5">
                <span>{fmtNum(r.low)}</span>
                <span className="text-green-400 text-center flex-1">typical range</span>
                <span>{fmtNum(r.high)}</span>
              </div>
            </div>
          );
        })}
        <div className="flex items-center gap-4 pt-1 border-t border-border text-[10px] text-ink-faint">
          <span className="flex items-center gap-1"><span className="w-4 h-2 bg-green-200 rounded inline-block border border-green-500/30" /> Typical range</span>
          <span className="flex items-center gap-1"><span className="w-1 h-3 bg-violet-600 rounded inline-block" /> Your value</span>
          <span className="ml-auto">Based on Datadog deployment patterns by org size</span>
        </div>
      </div>
    </div>
  );
}

// ─── NDM: Network Device Monitoring ──────────────────────────────────────────

const NDM_PRESETS = [
  { id: 'small', label: 'Small office', sub: '<500 devices', devices: 500, interfaces: 8, pollSec: '60' },
  { id: 'mid', label: 'Mid-size network', sub: '~5,000 devices', devices: 5000, interfaces: 12, pollSec: '60' },
  { id: 'large', label: 'Large enterprise', sub: '~25,000 devices', devices: 25000, interfaces: 16, pollSec: '120' },
  { id: 'carrier', label: 'Carrier / global WAN', sub: '100,000+ devices', devices: 100000, interfaces: 24, pollSec: '300' },
];

function NDMCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [devices, setDevices] = useModeState(mode, 'ndm.devices', 5000);
  const [interfaces, setInterfaces] = useModeState(mode, 'ndm.interfaces', 12);
  const [pollSec, setPollSec] = useModeState(mode, 'ndm.pollSec', '60');
  const [deviceMetrics, setDeviceMetrics] = useModeState(mode, 'ndm.deviceMetrics', 60);
  const [buffer, setBuffer] = useModeState(mode, 'ndm.buffer', 30);
  const [growthRate, setGrowthRate] = useModeState(mode, 'ndm.growthRate', 20);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'ndm.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setDevices(0); setInterfaces(0); setDeviceMetrics(0); setBuffer(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const poll = Number(pollSec);
    // Devices per agent based on Datadog NDM sizing guidance
    const devPerAgent = poll <= 30 ? 300 : poll <= 60 ? 1000 : poll <= 120 ? 1500 : poll <= 300 ? 2500 : 4000;
    const baseAgents = Math.ceil(devices / devPerAgent);
    const totalAgents = Math.ceil(baseAgents * (1 + buffer / 100));

    // Metrics
    const metricsPerDevice = deviceMetrics + interfaces * 8; // 8 counters per interface
    const totalMetrics = devices * metricsPerDevice;

    // K8s sizing: per-agent resources scale with device density
    const agentCpuM = Math.max(250, Math.ceil(devPerAgent / 500) * 250); // millicores
    const agentMemMi = Math.max(512, Math.ceil(devPerAgent / 500) * 512); // Mi
    const totalCpuCores = (totalAgents * agentCpuM / 1000).toFixed(1);
    const totalMemGi = (totalAgents * agentMemMi / 1024).toFixed(0);

    // VM sizing (if bare-metal/VM deployment)
    const vmCpu = poll <= 60 ? 2 : 1;
    const vmRamGb = poll <= 60 ? 4 : 2;

    // SNMP bandwidth (UDP packets, ~100-200 bytes/PDU)
    const oidsPerDevice = deviceMetrics + interfaces * 12;
    const pduBytes = 150;
    const bwMbps = ((devices * oidsPerDevice * pduBytes * 2) / poll / 1e6).toFixed(2); // req+resp

    // Proj
    const g = growthRate / 100;
    const projDevices = (y: number) => Math.round(devices * Math.pow(1 + g, y));
    const projAgents = (d: number) => Math.ceil(Math.ceil(d / devPerAgent) * (1 + buffer / 100));

    const listPriceCost = devices * DD_PRICES.ndmDevice;

    return {
      poll, devPerAgent, baseAgents, totalAgents,
      metricsPerDevice, totalMetrics,
      agentCpuM, agentMemMi, totalCpuCores, totalMemGi,
      vmCpu, vmRamGb, bwMbps, listPriceCost,
      d1: projDevices(1), d2: projDevices(2), d3: projDevices(3),
      a1: projAgents(projDevices(1)), a2: projAgents(projDevices(2)), a3: projAgents(projDevices(3)),
    };
  }, [devices, interfaces, pollSec, deviceMetrics, buffer, growthRate]);

  const ndmNdpIntegCount = scanData
    ? scanData.integrations.list.filter(i => ['snmp', 'network', 'ndm', 'cisco', 'juniper', 'palo_alto'].some(k => i.name.toLowerCase().includes(k))).length
    : 0;

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'ndm', label: 'Network Devices', icon: '🔌', primaryMetric: `${fmtNum(devices)} devices`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'NDM-DEVICE', description: 'Network Device Monitoring', quantity: devices, unit: 'devices', rate: DD_PRICES.ndmDevice, amount: c.listPriceCost }],
    });
  }, [mode, devices, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔌" title="Network Device Monitoring Sizing" description="Size Datadog NDM agents for SNMP polling across your device fleet. Outputs K8s and VM deployment specs." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="NDM (proxy: agent hosts)"
          growthRate={growthRate}
          usageUnit="hosts"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const usage = r.analytics?.infrastructure.totalHosts ?? null;
            return { orgName: r.org.name, orgId: r.org.id, usage, cost: usage != null ? usage * DD_PRICES.ndmDevice : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="ndm"
          onLoad={() => {
            const estimatedDevices = ndmNdpIntegCount > 0
              ? ndmNdpIntegCount * 20
              : Math.max(10, scanData.infrastructure.totalHosts);
            setDevices(estimatedDevices);
            setPresetId(null);
          }}
          items={[
            { label: 'Agent Hosts', actual: fmtNum(scanData.infrastructure.totalHosts), note: 'eligible for NDM collector role' },
            { label: 'Network Integrations', actual: String(ndmNdpIntegCount), note: 'SNMP-related checks detected' },
            { label: 'Cloud Accounts', actual: String(scanData.infrastructure.cloudAccounts.length), note: 'network-connected clouds' },
          ]}
        />
      )}

      <PresetBar
        presets={NDM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = NDM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setDevices(p.devices);
          setInterfaces(p.interfaces);
          setPollSec(p.pollSec);
        }}
      />

      <div className="grid grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Fleet Configuration</h3>
          <SliderInput
            label="Network Devices" value={devices} min={10} max={100000} step={100} unit="devices"
            onChange={(v) => { setDevices(v); setPresetId(null); }} log
            info="Every SNMP-managed switch, router, firewall, and load balancer you want Datadog to poll."
          />
          <SliderInput label="Interfaces per Device" value={interfaces} min={1} max={200} unit="interfaces" hint="Average across fleet. Core switches: 48+, routers: 4-24, firewalls: 4-16" onChange={(v) => { setInterfaces(v); setPresetId(null); }} />
          <SelectInput
            label="SNMP Poll Interval"
            value={pollSec}
            onChange={(v) => { setPollSec(v); setPresetId(null); }}
            options={[
              { value: '30', label: '30 seconds (high-freq monitoring)' },
              { value: '60', label: '60 seconds (recommended)' },
              { value: '120', label: '2 minutes' },
              { value: '300', label: '5 minutes (large fleets)' },
              { value: '600', label: '10 minutes (capacity only)' },
            ]}
            hint={`At ${pollSec}s interval: up to ${fmtNum(c.devPerAgent)} devices per agent`}
            info="Shorter intervals give fresher data but need more agents. 60s is the Datadog-recommended default for most fleets."
          />
          <Advanced>
            <SliderInput label="Device-Level Metrics" value={deviceMetrics} min={10} max={300} unit="metrics/device" hint="CPU, memory, BGP peers, OSPF, HSRP, chassis metrics" onChange={setDeviceMetrics} />
            <SliderInput label="Agent Headroom Buffer" value={buffer} min={10} max={100} unit="%" hint="Extra agents for redundancy and traffic spikes" onChange={setBuffer} />
            <SliderInput label="Annual Device Growth" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>

        {/* Results */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Agents Required" value={String(c.totalAgents)} sub={`${c.baseAgents} base + ${c.totalAgents - c.baseAgents} buffer`} color="violet" />
            <ResultCard label="Devices / Agent" value={fmtNum(c.devPerAgent)} sub={`at ${pollSec}s poll interval`} color="blue" />
            <ResultCard label="Metrics / Device" value={String(c.metricsPerDevice)} sub={`${deviceMetrics} device + ${interfaces * 8} interface`} color="gray" />
            <ResultCard label="Total Metrics" value={fmtNum(c.totalMetrics)} sub="across fleet at poll time" color={c.totalMetrics > 5e6 ? 'amber' : 'green'} />
          </div>

          <SizingBlock title="Kubernetes Deployment (per agent pod)" icon="☸" rows={[
            { label: 'CPU Request', value: `${c.agentCpuM}m`, note: `Limit: ${c.agentCpuM * 3}m (3×)` },
            { label: 'Memory Request', value: `${c.agentMemMi}Mi`, note: `Limit: ${c.agentMemMi * 2}Mi (2×)` },
            { label: 'Total CPU (all agents)', value: `${c.totalCpuCores} cores`, note: 'requests' },
            { label: 'Total Memory (all agents)', value: `${c.totalMemGi}Gi`, note: 'requests' },
            { label: 'Recommended: Deployment replicas', value: `${c.totalAgents}`, note: 'not DaemonSet' },
          ]} />

          <SizingBlock title="VM / Bare-Metal Option" icon="🖥" rows={[
            { label: 'VMs needed', value: `${c.totalAgents}`, note: `1 agent per VM` },
            { label: 'vCPU per VM', value: `${c.vmCpu} vCPU`, note: `at ${pollSec}s poll` },
            { label: 'RAM per VM', value: `${c.vmRamGb} GB`, note: 'Linux OS + agent' },
            { label: 'Total vCPU', value: `${c.totalAgents * c.vmCpu} vCPU` },
            { label: 'Total RAM', value: `${c.totalAgents * c.vmRamGb} GB` },
          ]} />

          <SizingBlock title="Network Bandwidth (SNMP polling)" icon="📡" rows={[
            { label: 'Estimated SNMP traffic', value: `${c.bwMbps} Mbps`, note: 'req + resp PDUs' },
            { label: 'OIDs per device/poll', value: fmtNum(deviceMetrics + interfaces * 12) },
            { label: 'Daily data volume', value: `${(Number(c.bwMbps) * 86400 / 8 / 1000).toFixed(1)} GB` },
          ]} />
        </div>
      </div>

      <SizingBlock title="List Price Estimate" icon="💰" rows={[
        { label: 'NDM devices', value: fmtNum(devices), note: `$${DD_PRICES.ndmDevice}/device/mo list price` },
        { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for NDM yet' },
      ]} />

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Devices', baseline: devices, unit: '' },
        { label: 'Agents Required', baseline: c.totalAgents, unit: '' },
        { label: 'Total Metrics', baseline: c.totalMetrics, unit: '' },
        { label: 'K8s CPU (cores)', baseline: Number(c.totalCpuCores), unit: 'cores', formatter: (n) => n.toFixed(1) },
        { label: 'K8s Memory', baseline: Number(c.totalMemGi), unit: 'Gi', formatter: (n) => `${n.toFixed(0)}` },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Logs Calculator ──────────────────────────────────────────────────────────

const LOGS_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~5 GB/day', ingestGbDay: 5, rows: [{ type: 'standard' as const, pct: 30, retentionDays: 15 }] },
  { id: 'mid', label: 'Growing org', sub: '~50 GB/day', ingestGbDay: 50, rows: [{ type: 'standard' as const, pct: 15, retentionDays: 15 }] },
  { id: 'large', label: 'Large org', sub: '~1,000 GB/day', ingestGbDay: 1000, rows: [
    { type: 'standard' as const, pct: 8, retentionDays: 30 },
    { type: 'flexHot' as const, pct: 20, retentionDays: 90 },
  ] },
  { id: 'enterprise', label: 'Enterprise', sub: '10,000+ GB/day', ingestGbDay: 10000, rows: [
    { type: 'standard' as const, pct: 5, retentionDays: 30 },
    { type: 'flexHot' as const, pct: 15, retentionDays: 90 },
    { type: 'flexFrozen' as const, pct: 20, retentionDays: 365 },
  ] },
];

// Standard retention windows Datadog exposes for indexed logs.
const RETENTION_DAY_OPTIONS = [3, 7, 15, 30, 45, 60, 90, 180, 365];

const LOG_TIER_TYPES: Array<{ id: 'standard' | 'flexHot' | 'flexFrozen'; label: string; color: 'violet' | 'blue' | 'gray' }> = [
  { id: 'standard', label: 'Standard (Indexed)', color: 'violet' },
  { id: 'flexHot', label: 'Flex (Hot)', color: 'blue' },
  { id: 'flexFrozen', label: 'Flex (Frozen)', color: 'gray' },
];

// Annual-contract indexing price per million events/month, tiered by retention — confirmed
// against Datadog's internal sizing/pricing calculator (full 3-90 day table). Beyond 90 days
// there's no confirmed rate, so we keep extrapolating linearly from the last two tiers.
const LOG_INDEX_PRICE_BY_RETENTION: Array<[number, number]> = [
  [3, 1.06], [7, 1.27], [15, 1.70], [30, 2.50],
  [45, 3.30], [60, 4.10], [90, 5.70], [180, 12.90], [365, 27.30],
];

function indexPriceForRetention(days: number): number {
  const table = LOG_INDEX_PRICE_BY_RETENTION;
  if (days <= table[0][0]) return table[0][1];
  if (days >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [d0, p0] = table[i];
    const [d1, p1] = table[i + 1];
    if (days >= d0 && days <= d1) return p0 + ((days - d0) / (d1 - d0)) * (p1 - p0);
  }
  return DD_PRICES.logsIndexMillion;
}

type LogTierRow = { id: string; type: 'standard' | 'flexHot' | 'flexFrozen'; pct: number; retentionDays: number };
let logTierRowSeq = 0;
const newLogTierRow = (type: LogTierRow['type'], pct: number, retentionDays: number): LogTierRow =>
  ({ id: `row-${++logTierRowSeq}`, type, pct, retentionDays });

// Suggested log source categories — not a fixed enum, just <datalist> suggestions.
// Any label can be typed in, so "and much more" beyond these presets is free-form.
const LOG_SOURCE_CATEGORY_SUGGESTIONS = [
  'Hosts', 'Apps', 'Database', 'Network', 'Security', 'Kubernetes',
  'Load Balancer', 'CDN', 'Message Queue', 'Serverless', 'CI/CD', 'Audit',
];

type LogSourceRow = { id: string; category: string; count: number; gbPerUnitDay: number; enabled: boolean };
let logSourceRowSeq = 0;
const newLogSourceRow = (category: string, count: number, gbPerUnitDay: number, enabled: boolean): LogSourceRow =>
  ({ id: `src-${++logSourceRowSeq}`, category, count, gbPerUnitDay, enabled });

function LogsCalculator({ scanData, mode, usageData, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [ingestGbDay, setIngestGbDay] = useModeState(mode, 'logs.ingestGbDay', 50);
  const [tierRows, setTierRows] = useModeState<LogTierRow[]>(mode, 'logs.tierRows', [newLogTierRow('standard', 15, 15)]);
  const [pipelines, setPipelines] = useModeState(mode, 'logs.pipelines', 5);
  const [growthRate, setGrowthRate] = useModeState(mode, 'logs.growthRate', 30);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'logs.presetId', 'mid');

  // Alternative way to derive Daily Log Ingestion: an extensible list of log
  // source categories (hosts, apps, database, network, security, or any custom
  // label), each count × GB/day/unit. Any subset can be enabled — their
  // contributions add together.
  const [sourceRows, setSourceRows] = useModeState<LogSourceRow[]>(mode, 'logs.sourceRows', [
    newLogSourceRow('Hosts', 50, 1, false),
    newLogSourceRow('Apps', 10, 2, false),
  ]);

  useResetOnBlank(mode, () => {
    setIngestGbDay(0);
    setTierRows([newLogTierRow('standard', 0, 15)]);
    setPipelines(0);
    setGrowthRate(0);
    setPresetId(null);
    setSourceRows(rows => rows.map(r => ({ ...r, count: 0, enabled: false })));
  });
  const updateSourceRow = (id: string, patch: Partial<LogSourceRow>) =>
    setSourceRows(rows => rows.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const addSourceRow = () => setSourceRows(rows => [...rows, newLogSourceRow('Database', 1, 1, true)]);
  const removeSourceRow = (id: string) => setSourceRows(rows => rows.filter(r => r.id !== id));

  const enabledSourceRows = sourceRows.filter(r => r.enabled);
  const fleetCalcActive = enabledSourceRows.length > 0;
  const fleetIngestGbDay = enabledSourceRows.reduce((s, r) => s + r.count * r.gbPerUnitDay, 0);

  useEffect(() => {
    if (fleetCalcActive) setIngestGbDay(fleetIngestGbDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetCalcActive, fleetIngestGbDay]);

  const updateRow = (id: string, patch: Partial<LogTierRow>) =>
    setTierRows(rows => rows.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => setTierRows(rows => [...rows, newLogTierRow('standard', 0, 15)]);
  const removeRow = (id: string) => setTierRows(rows => rows.filter(r => r.id !== id));

  const c = useMemo(() => {
    const eventsPerGb = 500000; // ~2KB/event compressed
    const eventsPerDay = ingestGbDay * eventsPerGb;
    const bytesPerIndexedEvent = 500; // compressed+indexed overhead
    const bytesPerFlexEvent = 200; // compressed for object storage

    const allocatedPct = tierRows.reduce((s, r) => s + r.pct, 0);
    const droppedPct = Math.max(0, 100 - allocatedPct);
    const droppedPerDay = eventsPerDay * (droppedPct / 100);

    let indexedPerDay = 0;
    let flexPerDay = 0;
    let indexStorageGbPerDay = 0;
    let totalIndexStorageGb = 0;
    let totalFlexStorageGb = 0;
    let indexCost = 0;
    let flexCost = 0;

    const tierBreakdown = tierRows.map(row => {
      const rowEventsPerDay = eventsPerDay * (row.pct / 100);
      if (row.type === 'standard') {
        indexedPerDay += rowEventsPerDay;
        const storageGbPerDay = (rowEventsPerDay * bytesPerIndexedEvent) / 1e9;
        const rowTotalStorageGb = storageGbPerDay * row.retentionDays;
        indexStorageGbPerDay += storageGbPerDay;
        totalIndexStorageGb += rowTotalStorageGb;
        const rowCost = (rowEventsPerDay * 30 / 1e6) * indexPriceForRetention(row.retentionDays);
        indexCost += rowCost;
        return { row, eventsPerDay: rowEventsPerDay, totalStorageGb: rowTotalStorageGb, cost: rowCost };
      }
      flexPerDay += rowEventsPerDay;
      const storageGbPerDay = (rowEventsPerDay * bytesPerFlexEvent) / 1e9;
      const rowTotalStorageGb = storageGbPerDay * row.retentionDays;
      totalFlexStorageGb += rowTotalStorageGb;
      const gbPrice = row.type === 'flexHot' ? DD_PRICES.logsFlexHotGb : DD_PRICES.logsFlexFrozenGb;
      const rowCost = rowTotalStorageGb * gbPrice;
      flexCost += rowCost;
      return { row, eventsPerDay: rowEventsPerDay, totalStorageGb: rowTotalStorageGb, cost: rowCost };
    });

    const listPriceCost = ingestGbDay * 30 * DD_PRICES.logsIngestGb + indexCost + flexCost;

    return {
      eventsPerDay, indexedPerDay, flexPerDay, droppedPerDay,
      indexStorageGbPerDay, totalIndexStorageGb, totalFlexStorageGb,
      droppedPct, droppedRate: droppedPct, listPriceCost, tierBreakdown, allocatedPct,
    };
  }, [ingestGbDay, tierRows, pipelines]);

  const logsUsage = mode === 'current' ? sumUsageProducts(usageData, ['Log Ingestion']) : null;

  useEffect(() => {
    if (mode === 'multi') return;
    const realCost = logsUsage ? logsUsage.committedCost + logsUsage.onDemandCost : undefined;
    const ingestAmount = ingestGbDay * 30 * DD_PRICES.logsIngestGb;
    reportCost({
      id: 'logs', label: 'Log Pipeline', icon: '🪵', primaryMetric: `${ingestGbDay} GB/day`, listPriceCost: c.listPriceCost, realCost,
      skuLines: [
        { sku: 'LOGS-INGEST', description: 'Log Ingestion', quantity: ingestGbDay * 30, unit: 'GB/mo', rate: DD_PRICES.logsIngestGb, amount: ingestAmount },
        ...c.tierBreakdown.map((t, i) => ({
          sku: t.row.type === 'standard' ? 'LOGS-INDEX' : t.row.type === 'flexHot' ? 'LOGS-FLEX-HOT' : 'LOGS-FLEX-FROZEN',
          description: `${t.row.type === 'standard' ? 'Indexed Logs' : t.row.type === 'flexHot' ? 'Flex Logs (Hot)' : 'Flex Logs (Frozen)'} — tier ${i + 1}, ${t.row.retentionDays}d retention`,
          quantity: t.row.type === 'standard' ? (t.eventsPerDay * 30) / 1e6 : t.totalStorageGb,
          unit: t.row.type === 'standard' ? 'M events/mo' : 'GB',
          rate: t.row.type === 'standard' ? indexPriceForRetention(t.row.retentionDays) : (t.row.type === 'flexHot' ? DD_PRICES.logsFlexHotGb : DD_PRICES.logsFlexFrozenGb),
          amount: t.cost,
        })),
      ],
    });
  }, [mode, ingestGbDay, c.listPriceCost, logsUsage, reportCost]);

  const g = growthRate / 100;
  const proj = (y: number) => ingestGbDay * Math.pow(1 + g, y);

  const avgRetention = scanData
    ? (() => {
        const entries = Object.entries(scanData.logs.retentionDistribution);
        if (!entries.length) return null;
        const total = entries.reduce((s, [, n]) => s + n, 0);
        const weighted = entries.reduce((s, [d, n]) => s + parseInt(d) * n, 0);
        return Math.round(weighted / total);
      })()
    : null;

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🪵" title="Log Pipeline Calculator" description="Estimate log ingestion, indexing rates, Flex Logs allocation, and retention storage requirements." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Log Ingestion"
          growthRate={growthRate}
          usageUnit="GB/mo"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['Log Ingestion']);
            const usageGb = u?.value != null ? u.value / 1e9 : null;
            const cost = u ? u.committedCost + u.onDemandCost : 0;
            return { orgName: r.org.name, orgId: r.org.id, usage: usageGb, cost, costIsEstimate: !u };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="logs"
          onLoad={() => {
            setPipelines(scanData.logs.pipelines || pipelines);
            setSourceRows(rows => rows.map(r => {
              if (r.category === 'Hosts' && scanData.infrastructure.totalHosts > 0) return { ...r, count: scanData.infrastructure.totalHosts };
              if (r.category === 'Apps' && scanData.apm.totalServices > 0) return { ...r, count: scanData.apm.totalServices };
              return r;
            }));
            const details = scanData.logs.indexDetails || [];
            if (details.length) {
              const groups = new Map<string, { type: LogTierRow['type']; retentionDays: number; count: number }>();
              details.forEach(d => {
                const type: LogTierRow['type'] = d.isFlex ? 'flexHot' : 'standard';
                const retentionDays = d.retentionDays ?? 15;
                const key = `${type}-${retentionDays}`;
                const g = groups.get(key);
                if (g) g.count += 1;
                else groups.set(key, { type, retentionDays, count: 1 });
              });
              const totalCount = details.length;
              const standardBudget = 15; // heuristic: indexed logs are a small slice of raw ingest
              const flexBudget = scanData.logs.flexIndexCount > 0 ? 20 : 0;
              const rows = Array.from(groups.values()).map(g => {
                const budget = g.type === 'standard' ? standardBudget : flexBudget;
                const share = g.count / totalCount;
                return newLogTierRow(g.type, Math.round(budget * share * 10) / 10, g.retentionDays);
              });
              setTierRows(rows.length ? rows : [newLogTierRow('standard', standardBudget, avgRetention || 15)]);
            } else if (avgRetention) {
              setTierRows([newLogTierRow('standard', 15, avgRetention)]);
            }
          }}
          items={[
            { label: 'Log Indexes', actual: String(scanData.logs.totalIndexes), note: `${scanData.logs.enabledPipelines} pipelines active` },
            { label: 'Avg Retention', actual: avgRetention ? `${avgRetention}d` : '—', note: 'across all indexes' },
            { label: 'Exclusion Filters', actual: String(scanData.logs.totalExclusionFilters), note: scanData.logs.totalExclusionFilters === 0 ? 'none — cost risk' : 'active' },
            { label: 'Flex Indexes', actual: String(scanData.logs.flexIndexCount), note: scanData.logs.flexIndexCount > 0 ? 'warm-tier active' : 'not using Flex' },
            { label: 'Rate Limited', actual: String(scanData.logs.rateLimitedCount), note: scanData.logs.rateLimitedCount > 0 ? 'hitting daily cap' : 'none' },
            { label: 'Daily Limit', actual: scanData.logs.totalDailyLimitEvents > 0 ? fmtNum(scanData.logs.totalDailyLimitEvents) : '∞', note: 'events/day total cap' },
          ]}
        />
      )}

      <PresetBar
        presets={LOGS_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = LOGS_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setIngestGbDay(p.ingestGbDay);
          setTierRows(p.rows.map(r => newLogTierRow(r.type, r.pct, r.retentionDays)));
        }}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Pipeline Configuration</h3>
          <SliderInput
            label="Daily Log Ingestion" value={ingestGbDay} min={1} max={10000} unit="GB / day"
            onChange={(v) => { setIngestGbDay(v); setPresetId(null); setSourceRows(rows => rows.map(r => ({ ...r, enabled: false }))); }}
            log hint={fleetCalcActive ? 'Calculated from source categories below — drag to override' : `~${fmtNum(ingestGbDay * 500000)} events/day at 2KB avg`}
            info="Total raw log volume sent to Datadog before any filtering — the single biggest driver of log cost."
          />

          <div className="space-y-2 bg-surface-subtle rounded-lg p-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-ink-muted leading-tight">
                Calculate from source categories
                <InfoTip text="Derive Daily Log Ingestion from log source categories (hosts, apps, database, network, security, or any custom label) instead of entering it directly. Enable any subset — their contributions add together." />
              </label>
              <button
                type="button"
                onClick={() => { addSourceRow(); setPresetId(null); }}
                className="text-xs font-semibold text-violet-400 hover:text-violet-400 shrink-0"
              >
                + Add category
              </button>
            </div>

            <datalist id="log-source-categories">
              {LOG_SOURCE_CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}
            </datalist>

            <div className="space-y-1.5">
              {sourceRows.map(row => {
                const contributionGbDay = row.enabled ? row.count * row.gbPerUnitDay : 0;
                const contributionMEventsDay = (contributionGbDay * 500000) / 1e6;
                return (
                  <div key={row.id} className="flex items-center gap-2">
                    <input
                      type="checkbox" checked={row.enabled}
                      onChange={(e) => { updateSourceRow(row.id, { enabled: e.target.checked }); setPresetId(null); }}
                      className="accent-violet-600 shrink-0"
                    />
                    <input
                      type="text" list="log-source-categories" value={row.category} disabled={!row.enabled}
                      onChange={(e) => updateSourceRow(row.id, { category: e.target.value })}
                      className="text-xs font-medium border border-border rounded px-1.5 py-1 bg-surface-subtle flex-1 min-w-0 disabled:opacity-40"
                    />
                    <input
                      type="number" min={0} value={row.count} disabled={!row.enabled}
                      onChange={(e) => updateSourceRow(row.id, { count: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-16 text-right text-xs font-bold text-ink border border-border rounded px-1.5 py-1 disabled:opacity-40 shrink-0"
                    />
                    <span className="text-xs text-ink-faint shrink-0">×</span>
                    <input
                      type="number" min={0} step={0.1} value={row.gbPerUnitDay} disabled={!row.enabled}
                      onChange={(e) => updateSourceRow(row.id, { gbPerUnitDay: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-14 text-right text-xs font-bold text-ink border border-border rounded px-1.5 py-1 disabled:opacity-40 shrink-0"
                    />
                    <span className="text-xs text-ink-faint w-24 shrink-0 leading-tight">
                      GB/day{row.enabled && <><br />{fmtNum(contributionGbDay)} GB · {contributionMEventsDay.toFixed(1)}M ev/day</>}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSourceRow(row.id)}
                      disabled={sourceRows.length === 1}
                      className="text-ink-faint hover:text-red-400 disabled:opacity-30 disabled:hover:text-ink-faint shrink-0 px-1"
                      aria-label="Remove category"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            {fleetCalcActive && (
              <div className="text-xs text-violet-400 bg-violet-500/10 border border-violet-500/30 rounded px-2 py-1">
                Total: <strong>{fmtNum(fleetIngestGbDay)} GB/day</strong> across {enabledSourceRows.length} categor{enabledSourceRows.length === 1 ? 'y' : 'ies'}
                {' '}({enabledSourceRows.map(r => r.category).join(', ')})
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-ink-muted leading-tight">
                Storage Tiers & Retention
                <InfoTip text="Split ingest across multiple storage tiers (Standard indexed, Flex Hot, Flex Frozen), each with its own retention window. Whatever isn't allocated is treated as dropped via exclusion filters." />
              </label>
              <button
                type="button"
                onClick={() => { addRow(); setPresetId(null); }}
                className="text-xs font-semibold text-violet-400 hover:text-violet-400 shrink-0"
              >
                + Add tier
              </button>
            </div>

            {tierRows.map((row) => (
              <div key={row.id} className="flex items-center gap-2 bg-surface-subtle rounded-lg p-2">
                <select
                  value={row.type}
                  onChange={(e) => { updateRow(row.id, { type: e.target.value as LogTierRow['type'] }); setPresetId(null); }}
                  className="text-xs font-medium border border-border rounded px-1.5 py-1 bg-surface-subtle flex-1 min-w-0"
                >
                  {LOG_TIER_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number" min={0} max={100} value={row.pct}
                    onChange={(e) => { updateRow(row.id, { pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }); setPresetId(null); }}
                    className="w-14 text-right text-xs font-bold text-ink border border-border rounded px-1.5 py-1"
                  />
                  <span className="text-xs text-ink-faint">%</span>
                </div>
                <select
                  value={row.retentionDays}
                  onChange={(e) => { updateRow(row.id, { retentionDays: Number(e.target.value) }); setPresetId(null); }}
                  className="text-xs font-medium border border-border rounded px-1.5 py-1 bg-surface-subtle shrink-0"
                >
                  {RETENTION_DAY_OPTIONS.map(d => <option key={d} value={d}>{d}d</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => { removeRow(row.id); setPresetId(null); }}
                  disabled={tierRows.length === 1}
                  className="text-ink-faint hover:text-red-400 disabled:opacity-30 disabled:hover:text-ink-faint shrink-0 px-1"
                  aria-label="Remove tier"
                >
                  ×
                </button>
              </div>
            ))}

            <div className={`rounded-lg p-3 text-xs space-y-0.5 ${c.allocatedPct > 100 ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
              <div className="font-semibold">Routing summary</div>
              <div>Allocated: <strong>{c.allocatedPct.toFixed(0)}%</strong> across {tierRows.length} tier{tierRows.length === 1 ? '' : 's'} · Dropped/excluded: <strong>{c.droppedPct.toFixed(0)}%</strong></div>
              {c.allocatedPct > 100 && <div>Tiers add up to more than 100% of ingest — reduce one or more rows.</div>}
            </div>
          </div>

          <Advanced>
            <SliderInput label="Processing Pipelines" value={pipelines} min={1} max={100} unit="pipelines" hint="Parsing, enrichment, and routing pipelines" onChange={setPipelines} />
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Events / Day (total)" value={fmtNum(c.eventsPerDay)} sub={`${ingestGbDay} GB ingested`} color="gray" />
            <ResultCard label="Indexed Events / Day" value={fmtNum(c.indexedPerDay)} sub={`${tierRows.filter(r => r.type === 'standard').reduce((s, r) => s + r.pct, 0).toFixed(0)}% of ingest`} color="violet" />
            <ResultCard label="Flex Events / Day" value={fmtNum(c.flexPerDay)} sub={`${tierRows.filter(r => r.type !== 'standard').reduce((s, r) => s + r.pct, 0).toFixed(0)}% to object storage`} color="blue" />
            <ResultCard label="Dropped / Day" value={fmtNum(c.droppedPerDay)} sub={`${c.droppedPct.toFixed(0)}% via exclusion filters`} color={c.droppedPct > 70 ? 'green' : 'amber'} />
            <ResultCard label="Ingested Events (M/day)" value={`${(c.eventsPerDay / 1e6).toFixed(1)}M`} sub="millions of events per day" color="gray" />
            <ResultCard label="Ingested Events (M/month)" value={`${((c.eventsPerDay * 30) / 1e6).toFixed(1)}M`} sub="Datadog prices indexing per million events/mo" color="gray" />
          </div>

          {presetId && PRESET_TO_TIER[presetId] && TIER_BASELINES.logs?.[PRESET_TO_TIER[presetId]] && (
            <BaselineCard
              tier={PRESET_TO_TIER[presetId]}
              ranges={TIER_BASELINES.logs[PRESET_TO_TIER[presetId]]!}
              currentValues={[ingestGbDay]}
            />
          )}

          <SizingBlock title="Storage Estimate" icon="💾" rows={[
            { label: 'Standard index storage / day', value: `${c.indexStorageGbPerDay.toFixed(1)} GB`, note: 'compressed + index overhead' },
            { label: 'Standard total storage', value: `${c.totalIndexStorageGb.toFixed(0)} GB`, note: 'summed across standard tiers at their own retention' },
            { label: 'Flex storage / day', value: `${((c.flexPerDay * 200) / 1e9).toFixed(2)} GB`, note: 'object storage (compressed)' },
            { label: 'Flex total storage', value: `${c.totalFlexStorageGb.toFixed(0)} GB`, note: 'summed across Flex tiers at their own retention' },
          ]} />

          <SizingBlock title="Cost by Tier" icon="💰" rows={c.tierBreakdown.map(({ row, eventsPerDay, cost }) => ({
            label: `${LOG_TIER_TYPES.find(t => t.id === row.type)?.label} · ${row.retentionDays}d`,
            value: `$${cost.toFixed(0)}/mo`,
            note: `${row.pct}% of ingest · ${fmtNum(eventsPerDay)} events/day`,
          }))} />
        </div>
      </div>

      {mode === 'current' && logsUsage && (
        <CostSavingsCard
          label="Log Ingestion"
          usageValue={logsUsage.value / 1e9}
          usageUnit="GB ingested"
          committedCost={logsUsage.committedCost}
          onDemandCost={logsUsage.onDemandCost}
          listPriceCost={c.listPriceCost}
        />
      )}

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Daily Ingestion', baseline: ingestGbDay, unit: 'GB/day' },
        { label: 'Indexed Events/Day', baseline: c.indexedPerDay, unit: '' },
        { label: 'Online Storage Total', baseline: c.totalIndexStorageGb, unit: 'GB', formatter: (n) => `${n.toFixed(0)}` },
        { label: 'Monthly Ingest', baseline: ingestGbDay * 30, unit: 'GB/mo' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── APM / Traces ─────────────────────────────────────────────────────────────

// hosts are an illustrative default (~3-4 services packed per host in containerized
// environments) — always overridden by the real host count when a scan is loaded.
const APM_PRESETS = [
  { id: 'small', label: 'Small app', sub: '~5 services', services: 5, hosts: 3, rps: 20, samplingRate: 20 },
  { id: 'mid', label: 'Growing product', sub: '~20 services', services: 20, hosts: 8, rps: 100, samplingRate: 10 },
  { id: 'large', label: 'Large platform', sub: '~150 services', services: 150, hosts: 40, rps: 500, samplingRate: 10 },
  { id: 'enterprise', label: 'Enterprise scale', sub: '1,000+ services', services: 1000, hosts: 250, rps: 1000, samplingRate: 5 },
];

function APMCalculator({ scanData, mode, usageData, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [services, setServices] = useModeState(mode, 'apm.services', 20);
  const [apmHosts, setApmHosts] = useModeState(mode, 'apm.hosts', 8);
  const [rps, setRps] = useModeState(mode, 'apm.rps', 100);
  const [spansPerTrace, setSpansPerTrace] = useModeState(mode, 'apm.spansPerTrace', 8);
  const [samplingRate, setSamplingRate] = useModeState(mode, 'apm.samplingRate', 10);
  const [indexedPct, setIndexedPct] = useModeState(mode, 'apm.indexedPct', 5);
  const [retentionDays, setRetentionDays] = useModeState(mode, 'apm.retentionDays', 15);
  const [growthRate, setGrowthRate] = useModeState(mode, 'apm.growthRate', 25);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'apm.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setServices(0); setApmHosts(0); setRps(0); setSpansPerTrace(0); setSamplingRate(0); setIndexedPct(0);
    setRetentionDays(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const totalRps = services * rps;
    const ingestedSpansPerSec = totalRps * spansPerTrace * (samplingRate / 100);
    const ingestedSpansPerMin = ingestedSpansPerSec * 60;
    const ingestedGbPerDay = (ingestedSpansPerSec * 2000 * 86400) / 1e9; // ~2KB/span

    const indexedSpansPerMin = ingestedSpansPerMin * (indexedPct / 100);
    const indexedGbPerDay = (indexedSpansPerMin * 60 * 24 * 2000) / 1e9 * (indexedPct / 100);

    const retentionStorageGb = indexedGbPerDay * retentionDays;
    // APM Hosts is billed per host running the Agent, not per service — multiple
    // services/containers commonly share a host, so this must use apmHosts, not services.
    const listPriceCost = apmHosts * DD_PRICES.apmHost;

    return {
      totalRps, ingestedSpansPerSec, ingestedSpansPerMin,
      ingestedGbPerDay, indexedSpansPerMin, indexedGbPerDay, retentionStorageGb, listPriceCost,
    };
  }, [services, apmHosts, rps, spansPerTrace, samplingRate, indexedPct, retentionDays]);

  const apmUsage = mode === 'current' ? sumUsageProducts(usageData, ['APM Hosts']) : null;

  useEffect(() => {
    if (mode === 'multi') return;
    const realCost = apmUsage ? apmUsage.committedCost + apmUsage.onDemandCost : undefined;
    reportCost({
      id: 'apm', label: 'APM & Traces', icon: '🔍', primaryMetric: `${apmHosts} hosts (${services} svc)`, listPriceCost: c.listPriceCost, realCost,
      skuLines: [{ sku: 'APM-HOST', description: 'APM Host (Standard)', quantity: apmHosts, unit: 'hosts', rate: DD_PRICES.apmHost, amount: c.listPriceCost }],
    });
  }, [mode, services, apmHosts, c.listPriceCost, apmUsage, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔍" title="APM & Traces Calculator" description="Estimate trace ingestion volume, indexed spans, and retention storage for your APM configuration." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="APM Hosts"
          growthRate={growthRate}
          usageUnit="hosts"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['APM Hosts']);
            // Prefer real host count over service count for the no-usage-data fallback —
            // APM Hosts bills per host, and services routinely outnumber hosts.
            const usage = u?.value ?? r.analytics?.infrastructure.totalHosts ?? r.analytics?.apm.totalServices ?? null;
            const cost = u ? u.committedCost + u.onDemandCost : (usage != null ? usage * DD_PRICES.apmHost : 0);
            return { orgName: r.org.name, orgId: r.org.id, usage, cost, costIsEstimate: !u };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="apm"
          onLoad={() => {
            setServices(Math.max(1, scanData.apm.totalServices));
            setApmHosts(Math.max(1, scanData.infrastructure.totalHosts));
          }}
          items={[
            { label: 'APM Services', actual: String(scanData.apm.totalServices), note: 'detected in scan' },
            { label: 'Hosts (APM billing unit)', actual: String(scanData.infrastructure.totalHosts), note: `${scanData.infrastructure.totalHosts > 0 ? (scanData.apm.totalServices / scanData.infrastructure.totalHosts).toFixed(1) : '—'} services/host` },
            { label: 'In Service Catalog', actual: String(scanData.apm.svcInCatalog), note: `${scanData.apm.totalServices > 0 ? Math.round(scanData.apm.svcInCatalog / scanData.apm.totalServices * 100) : 0}% coverage` },
            { label: 'With Monitor', actual: String(scanData.apm.svcWithMonitor), note: 'services monitored' },
            { label: 'With SLO', actual: String(scanData.apm.svcWithSLO), note: 'services with SLO' },
          ]}
        />
      )}
      <PresetBar
        presets={APM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = APM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setServices(p.services);
          setApmHosts(p.hosts);
          setRps(p.rps);
          setSamplingRate(p.samplingRate);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">APM Configuration</h3>
          <SliderInput label="Services Instrumented" value={services} min={1} max={5000} unit="services" onChange={(v) => { setServices(v); setPresetId(null); }} log />
          <SliderInput
            label="APM Hosts (billing unit)" value={apmHosts} min={1} max={5000} unit="hosts"
            onChange={(v) => { setApmHosts(v); setPresetId(null); }} log
            hint={`${(services / Math.max(1, apmHosts)).toFixed(1)} services/host — Datadog bills APM per host, not per service`}
            info="APM Hosts is the actual billing unit: any host running the Datadog Agent with APM enabled, regardless of how many services/containers run on it. Set this independently from Services — they're rarely equal."
          />
          <SliderInput label="Requests per Second (avg per service)" value={rps} min={1} max={100000} unit="req/s" onChange={(v) => { setRps(v); setPresetId(null); }} log hint="Across all environments (prod + staging)" />
          <SliderInput label="Spans per Trace" value={spansPerTrace} min={1} max={200} unit="spans" hint="Avg spans per distributed trace (entry → downstream calls)" onChange={setSpansPerTrace} />
          <SliderInput
            label="Ingestion Sampling Rate" value={samplingRate} min={1} max={100} unit="%" hint="% of traces ingested. 100% = full fidelity (highest cost)"
            onChange={(v) => { setSamplingRate(v); setPresetId(null); }}
            info="The % of traces sent to Datadog at all. Lowering this is the single biggest APM cost lever — errors and slow traces can still be kept at 100% separately."
          />
          <SliderInput
            label="Indexed (Retention Filters)" value={indexedPct} min={0.1} max={100} step={0.1} unit="% of ingested" hint="Indexed spans are searchable & queryable long-term" onChange={setIndexedPct}
            info="Of the traces that made it past sampling, this % is kept long-term and searchable. Ingest ≠ index — you can ingest 100% and index only 5%."
          />
          <Advanced>
            <SliderInput label="Retention Period" value={retentionDays} min={1} max={365} unit="days" onChange={setRetentionDays} />
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Total RPS (all services)" value={fmtNum(c.totalRps)} sub="across fleet" color="gray" />
            <ResultCard label="Ingested Spans / min" value={fmtNum(c.ingestedSpansPerMin)} sub={`at ${samplingRate}% sampling`} color="violet" />
            <ResultCard label="Ingest Volume / day" value={`${c.ingestedGbPerDay.toFixed(1)} GB`} sub="before indexing" color="blue" />
            <ResultCard label="Indexed Spans / min" value={fmtNum(c.indexedSpansPerMin)} sub={`${indexedPct}% of ingested`} color={c.indexedSpansPerMin > 1e6 ? 'amber' : 'green'} />
          </div>

          {presetId && PRESET_TO_TIER[presetId] && TIER_BASELINES.apm?.[PRESET_TO_TIER[presetId]] && (
            <BaselineCard
              tier={PRESET_TO_TIER[presetId]}
              ranges={TIER_BASELINES.apm[PRESET_TO_TIER[presetId]]!}
              currentValues={[services]}
            />
          )}

          <SizingBlock title="Storage & Retention" icon="💾" rows={[
            { label: 'Indexed volume / day', value: `${c.indexedGbPerDay.toFixed(2)} GB` },
            { label: `Retention storage (${retentionDays}d)`, value: `${c.retentionStorageGb.toFixed(0)} GB` },
            { label: 'Indexed span / minute', value: fmtNum(c.indexedSpansPerMin) },
            { label: 'Monthly ingest', value: `${(c.ingestedGbPerDay * 30).toFixed(0)} GB` },
          ]} />

          <SizingBlock title="Optimization Levers" icon="⚡" rows={[
            { label: 'Lower sampling 100%→10%', value: '−90% ingestion cost', note: 'use head-based sampling' },
            { label: 'Indexed: 5%→1%', value: '−80% indexed spans', note: 'review retention filters' },
            { label: 'Reduce retention 30d→15d', value: '~50% storage reduction' },
            { label: 'Error+slow always-on', value: 'keep 100% of errors', note: 'regardless of sampling rate' },
          ]} />
        </div>
      </div>

      {mode === 'current' && apmUsage && (
        <CostSavingsCard
          label="APM Hosts"
          usageValue={apmUsage.value}
          usageUnit="hosts"
          committedCost={apmUsage.committedCost}
          onDemandCost={apmUsage.onDemandCost}
          listPriceCost={c.listPriceCost}
        />
      )}

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Total RPS', baseline: c.totalRps, unit: 'req/s' },
        { label: 'Ingested Spans/min', baseline: c.ingestedSpansPerMin, unit: '' },
        { label: 'Daily Ingest', baseline: c.ingestedGbPerDay, unit: 'GB/day', formatter: (n) => n.toFixed(1) },
        { label: 'Monthly Ingest', baseline: c.ingestedGbPerDay * 30, unit: 'GB/mo', formatter: (n) => n.toFixed(0) },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Infrastructure ───────────────────────────────────────────────────────────

const INFRA_PRESETS = [
  { id: 'small', label: 'Startup', sub: '<50 hosts', hosts: 20, k8sNodes: 0, cloudAccounts: 1 },
  { id: 'mid', label: 'Growth', sub: '50-250 hosts', hosts: 130, k8sNodes: 20, cloudAccounts: 2 },
  { id: 'large', label: 'Mid-Market', sub: '250-999 hosts', hosts: 400, k8sNodes: 100, cloudAccounts: 4 },
  { id: 'enterprise', label: 'Enterprise', sub: '1,000+ hosts', hosts: 3000, k8sNodes: 800, cloudAccounts: 10 },
];

function InfraCalculator({ scanData, mode, usageData, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [hosts, setHosts] = useModeState(mode, 'infra.hosts', 200);
  const [containersPerHost, setContainersPerHost] = useModeState(mode, 'infra.containersPerHost', 20);
  const [k8sNodes, setK8sNodes] = useModeState(mode, 'infra.k8sNodes', 50);
  const [podsPerNode, setPodsPerNode] = useModeState(mode, 'infra.podsPerNode', 30);
  const [cloudAccounts, setCloudAccounts] = useModeState(mode, 'infra.cloudAccounts', 3);
  const [resourcesPerAccount, setResourcesPerAccount] = useModeState(mode, 'infra.resourcesPerAccount', 500);
  const [allotmentPlan, setAllotmentPlan] = useModeState(mode, 'infra.allotmentPlan', '100');
  const [growthRate, setGrowthRate] = useModeState(mode, 'infra.growthRate', 20);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'infra.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setHosts(0); setContainersPerHost(0); setK8sNodes(0); setPodsPerNode(0);
    setCloudAccounts(0); setResourcesPerAccount(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const allotment = Number(allotmentPlan);
    const totalHosts = hosts + k8sNodes;
    const totalContainers = hosts * containersPerHost + k8sNodes * podsPerNode;
    const cmAllotment = Math.max(500, totalHosts * allotment);
    const cloudMetrics = cloudAccounts * resourcesPerAccount * 15; // ~15 metrics per resource

    // Custom metrics drivers
    const infraMetrics = totalHosts * 300; // ~300 system metrics per host
    const containerMetrics = totalContainers * 20;
    const totalMetrics = infraMetrics + containerMetrics + cloudMetrics;
    const utilizationPct = Math.round((totalMetrics / cmAllotment) * 100);

    // Agent resource requirements per node
    const agentCpuM = 200; // 200m CPU per agent
    const agentMemMi = 256; // 256Mi per agent
    const totalAgentCpu = ((hosts + k8sNodes) * agentCpuM / 1000).toFixed(1);
    const totalAgentMemGi = ((hosts + k8sNodes) * agentMemMi / 1024).toFixed(1);

    const onDemandMetrics = Math.max(0, totalMetrics - cmAllotment);
    const listPriceCost = totalHosts * DD_PRICES.infraHostPro
      + totalContainers * DD_PRICES.containerMonthly
      + (onDemandMetrics / 100) * DD_PRICES.customMetricsPer100;

    return {
      totalHosts, totalContainers, cmAllotment, cloudMetrics,
      infraMetrics, containerMetrics, totalMetrics, utilizationPct, listPriceCost, onDemandMetrics,
      totalAgentCpu, totalAgentMemGi,
    };
  }, [hosts, containersPerHost, k8sNodes, podsPerNode, cloudAccounts, resourcesPerAccount, allotmentPlan]);

  const infraUsage = mode === 'current' ? sumUsageProducts(usageData, ['Infrastructure Hosts', 'Containers']) : null;

  useEffect(() => {
    if (mode === 'multi') return;
    const realCost = infraUsage ? infraUsage.committedCost + infraUsage.onDemandCost : undefined;
    reportCost({
      id: 'infra', label: 'Infrastructure', icon: '🖥', primaryMetric: `${fmtNum(c.totalHosts)} hosts`, listPriceCost: c.listPriceCost, realCost,
      skuLines: [
        { sku: 'INFRA-HOST-PRO', description: 'Infrastructure Host (Pro)', quantity: c.totalHosts, unit: 'hosts', rate: DD_PRICES.infraHostPro, amount: c.totalHosts * DD_PRICES.infraHostPro },
        { sku: 'INFRA-CONTAINER', description: 'Container Monitoring', quantity: c.totalContainers, unit: 'containers', rate: DD_PRICES.containerMonthly, amount: c.totalContainers * DD_PRICES.containerMonthly },
        ...(c.onDemandMetrics > 0 ? [{ sku: 'INFRA-CM-ONDEMAND', description: 'Custom Metrics (on-demand overage)', quantity: c.onDemandMetrics, unit: 'metrics', rate: DD_PRICES.customMetricsPer100 / 100, amount: (c.onDemandMetrics / 100) * DD_PRICES.customMetricsPer100 }] : []),
      ],
    });
  }, [mode, c.totalHosts, c.listPriceCost, infraUsage, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🖥" title="Infrastructure Sizing Calculator" description="Model host, container, and K8s allotment consumption. Estimate agent resource footprint across your fleet." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Infrastructure Hosts"
          growthRate={growthRate}
          usageUnit="hosts"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['Infrastructure Hosts']);
            const usage = u?.value ?? r.analytics?.infrastructure.totalHosts ?? null;
            const cost = u ? u.committedCost + u.onDemandCost : (usage != null ? usage * DD_PRICES.infraHostPro : 0);
            return { orgName: r.org.name, orgId: r.org.id, usage, cost, costIsEstimate: !u };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="infra"
          onLoad={() => {
            const h = scanData.infrastructure.totalHosts;
            if (h > 0) setHosts(h);
            const awsN = scanData.infrastructure.cloudAccounts.find(a => a.provider === 'aws')?.n ?? 0;
            if (awsN > 0) setCloudAccounts(awsN);
            if (scanData.infrastructure.containers) setContainersPerHost(Math.round(scanData.infrastructure.containers / Math.max(h, 1)));
          }}
          items={[
            { label: 'Total Hosts', actual: String(scanData.infrastructure.totalHosts), note: scanData.infrastructure.hostTier },
            { label: 'Containers', actual: scanData.infrastructure.containers != null ? fmtNum(scanData.infrastructure.containers) : '—', note: 'detected via signals' },
            { label: 'Cloud Accounts', actual: String(scanData.infrastructure.cloudAccounts.length), note: scanData.infrastructure.cloudAccounts.map(a => `${a.provider}:${a.n}`).join(', ') || 'none' },
            { label: 'CM Utilization', actual: `${scanData.customMetrics.utilizationPct}%`, note: `${fmtNum(scanData.customMetrics.estimated)} est. metrics` },
            { label: 'CM Risk', actual: scanData.customMetrics.risk.toUpperCase(), note: `allotment: ${fmtNum(scanData.customMetrics.allotmentAt100PerHost)}` },
            { label: 'Tag Coverage', actual: `env ${scanData.infrastructure.tagCoverage.env}%`, note: `svc ${scanData.infrastructure.tagCoverage.service}% · team ${scanData.infrastructure.tagCoverage.team}%` },
          ]}
        />
      )}

      <PresetBar
        presets={INFRA_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = INFRA_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setHosts(p.hosts);
          setK8sNodes(p.k8sNodes);
          setCloudAccounts(p.cloudAccounts);
        }}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Fleet Composition</h3>
          <SliderInput label="Traditional Hosts (VMs/bare-metal)" value={hosts} min={0} max={50000} step={10} unit="hosts" onChange={(v) => { setHosts(v); setPresetId(null); }} log />
          <SliderInput label="Containers per VM Host" value={containersPerHost} min={0} max={500} unit="containers" hint="Docker/ECS containers running on traditional hosts" onChange={setContainersPerHost} />
          <SliderInput label="Kubernetes Nodes" value={k8sNodes} min={0} max={10000} step={5} unit="nodes" onChange={(v) => { setK8sNodes(v); setPresetId(null); }} log />
          <SliderInput label="Pods per K8s Node" value={podsPerNode} min={1} max={250} unit="pods" hint="Depends on node size. t3.large: ~30, m5.2xl: ~100" onChange={setPodsPerNode} />
          <SliderInput label="Cloud Accounts (AWS/GCP/Azure)" value={cloudAccounts} min={0} max={500} unit="accounts" onChange={(v) => { setCloudAccounts(v); setPresetId(null); }} />
          <SliderInput label="Cloud Resources per Account" value={resourcesPerAccount} min={10} max={50000} unit="resources" hint="EC2, RDS, Lambda, GCE, etc. combined" onChange={setResourcesPerAccount} log />
          <SelectInput
            label="Custom Metrics Allotment"
            value={allotmentPlan}
            onChange={setAllotmentPlan}
            options={[
              { value: '100', label: '100 per host (Pro)' },
              { value: '200', label: '200 per host (Enterprise)' },
              { value: '500', label: '500 per host (Enterprise+)' },
            ]}
            info="How many custom metric timeseries your Datadog plan includes per host before on-demand overage charges kick in."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Total Host Count" value={fmtNum(c.totalHosts)} sub={`${hosts} VMs + ${k8sNodes} K8s nodes`} color="violet" />
            <ResultCard label="Total Containers" value={fmtNum(c.totalContainers)} sub={`${containersPerHost}/host + ${podsPerNode} pods/node`} color="blue" />
            <ResultCard label="CM Allotment" value={fmtNum(c.cmAllotment)} sub={`${allotmentPlan}/host plan`} color="gray" />
            <ResultCard label="Est. Custom Metrics" value={fmtNum(c.totalMetrics)} sub={`${c.utilizationPct}% of allotment`} color={c.utilizationPct > 90 ? 'red' : c.utilizationPct > 70 ? 'amber' : 'green'} />
          </div>

          {presetId && PRESET_TO_TIER[presetId] && TIER_BASELINES.infra?.[PRESET_TO_TIER[presetId]] && (
            <BaselineCard
              tier={PRESET_TO_TIER[presetId]}
              ranges={TIER_BASELINES.infra[PRESET_TO_TIER[presetId]]!}
              currentValues={[c.totalHosts, c.totalMetrics]}
            />
          )}

          <SizingBlock title="Custom Metrics Breakdown" icon="📊" rows={[
            { label: 'Infrastructure metrics', value: fmtNum(c.infraMetrics), note: `~300/host × ${c.totalHosts} hosts` },
            { label: 'Container metrics', value: fmtNum(c.containerMetrics), note: `~20/container × ${fmtNum(c.totalContainers)}` },
            { label: 'Cloud integration metrics', value: fmtNum(c.cloudMetrics), note: `${cloudAccounts} accounts × ${resourcesPerAccount} resources` },
            { label: 'Allotment utilization', value: `${c.utilizationPct}%`, note: c.utilizationPct > 100 ? '⚠ ON-DEMAND charges apply' : '✓ within allotment' },
          ]} />

          <SizingBlock title="Agent Resource Footprint" icon="☸" rows={[
            { label: 'Total agent instances', value: `${c.totalHosts}`, note: 'one per host/node' },
            { label: 'Total agent CPU', value: `${c.totalAgentCpu} cores`, note: '200m request per agent' },
            { label: 'Total agent memory', value: `${c.totalAgentMemGi} Gi`, note: '256Mi request per agent' },
            { label: 'Cluster Agent (K8s)', value: `${Math.max(1, Math.ceil(k8sNodes / 500))} pods`, note: '1 per 500 nodes recommended' },
          ]} />
        </div>
      </div>

      {mode === 'current' && infraUsage && (
        <CostSavingsCard
          label="Infrastructure Hosts + Containers"
          usageValue={infraUsage.value}
          usageUnit="hosts (host+container units)"
          committedCost={infraUsage.committedCost}
          onDemandCost={infraUsage.onDemandCost}
          listPriceCost={c.listPriceCost}
        />
      )}

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Total Hosts', baseline: c.totalHosts, unit: '' },
        { label: 'Total Containers', baseline: c.totalContainers, unit: '' },
        { label: 'Est. Custom Metrics', baseline: c.totalMetrics, unit: '' },
        { label: 'CM Allotment', baseline: c.cmAllotment, unit: '' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── RUM ──────────────────────────────────────────────────────────────────────

const RUM_PRESETS = [
  { id: 'small', label: 'Startup', sub: '~100K sessions/mo', mau: 25000, sessionsPerUser: 4 },
  { id: 'mid', label: 'Growth', sub: '~2M sessions/mo', mau: 500000, sessionsPerUser: 4 },
  { id: 'large', label: 'Mid-Market', sub: '~15M sessions/mo', mau: 3000000, sessionsPerUser: 5 },
  { id: 'enterprise', label: 'Enterprise', sub: '100M+ sessions/mo', mau: 20000000, sessionsPerUser: 5 },
];

function RUMCalculator({ scanData, mode, usageData, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [mau, setMau] = useModeState(mode, 'rum.mau', 100000);
  const [sessionsPerUser, setSessionsPerUser] = useModeState(mode, 'rum.sessionsPerUser', 4);
  const [pageviewsPerSession, setPageviewsPerSession] = useModeState(mode, 'rum.pageviewsPerSession', 8);
  const [replayRate, setReplayRate] = useModeState(mode, 'rum.replayRate', 5);
  const [mobileUsers, setMobileUsers] = useModeState(mode, 'rum.mobileUsers', 30);
  const [errorTracking, setErrorTracking] = useModeState(mode, 'rum.errorTracking', true);
  const [growthRate, setGrowthRate] = useModeState(mode, 'rum.growthRate', 35);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'rum.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setMau(0); setSessionsPerUser(0); setPageviewsPerSession(0); setReplayRate(0);
    setMobileUsers(0); setErrorTracking(false); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const totalSessions = mau * sessionsPerUser;
    const browserSessions = totalSessions * (1 - mobileUsers / 100);
    const mobileSessions = totalSessions * (mobileUsers / 100);
    const replaySessions = browserSessions * (replayRate / 100);
    const totalPageviews = browserSessions * pageviewsPerSession;
    const totalActions = totalPageviews * 3; // ~3 actions per page view
    const errorsTracked = mau * 2; // ~2 errors per user/month

    // Data volume estimates
    const sessionDataKb = 15; // KB per session metadata
    const replayDataMbPerSession = 2; // MB per replay session
    const replayStorageGb = (replaySessions * replayDataMbPerSession) / 1024;

    const listPriceCost = (browserSessions / 1000) * DD_PRICES.rumSession1k
      + (mobileSessions / 1000) * DD_PRICES.rumMobileSession1k
      + (replaySessions / 1000) * DD_PRICES.rumReplay1k;

    return {
      totalSessions, browserSessions, mobileSessions, replaySessions,
      totalPageviews, totalActions, errorsTracked, replayStorageGb, listPriceCost,
    };
  }, [mau, sessionsPerUser, pageviewsPerSession, replayRate, mobileUsers]);

  const rumUsage = mode === 'current' ? sumUsageProducts(usageData, ['RUM Sessions', 'Mobile RUM Sessions']) : null;

  useEffect(() => {
    if (mode === 'multi') return;
    const realCost = rumUsage ? rumUsage.committedCost + rumUsage.onDemandCost : undefined;
    reportCost({
      id: 'rum', label: 'RUM & Sessions', icon: '👤', primaryMetric: `${fmtNum(mau)} MAU`, listPriceCost: c.listPriceCost, realCost,
      skuLines: [
        { sku: 'RUM-BROWSER', description: 'Browser RUM Sessions', quantity: c.browserSessions / 1000, unit: 'K sessions', rate: DD_PRICES.rumSession1k, amount: (c.browserSessions / 1000) * DD_PRICES.rumSession1k },
        { sku: 'RUM-MOBILE', description: 'Mobile RUM Sessions', quantity: c.mobileSessions / 1000, unit: 'K sessions', rate: DD_PRICES.rumMobileSession1k, amount: (c.mobileSessions / 1000) * DD_PRICES.rumMobileSession1k },
        { sku: 'RUM-REPLAY', description: 'Session Replay', quantity: c.replaySessions / 1000, unit: 'K sessions', rate: DD_PRICES.rumReplay1k, amount: (c.replaySessions / 1000) * DD_PRICES.rumReplay1k },
      ],
    });
  }, [mode, mau, c.listPriceCost, rumUsage, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="👤" title="RUM & Session Calculator" description="Estimate session volumes, replay coverage, and data footprint for Browser and Mobile RUM." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="RUM Sessions"
          growthRate={growthRate}
          usageUnit="sessions/mo"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['RUM Sessions', 'Mobile RUM Sessions']);
            return { orgName: r.org.name, orgId: r.org.id, usage: u?.value ?? null, cost: u ? u.committedCost + u.onDemandCost : 0, costIsEstimate: !u };
          })}
        />
      ) : (
      <>
      {scanData?.rum && (
        <ScanContext
          id="rum"
          items={[
            { label: 'RUM Applications', actual: String(scanData.rum.total), note: scanData.rum.total === 0 ? 'none detected' : 'instrumented' },
            { label: 'Browser Apps', actual: String(scanData.rum.byType['browser'] ?? 0), note: 'web SDK' },
            { label: 'Mobile Apps', actual: String((scanData.rum.byType['ios'] ?? 0) + (scanData.rum.byType['android'] ?? 0)), note: 'iOS + Android' },
            { label: 'Other Types', actual: String(Object.entries(scanData.rum.byType).filter(([k]) => !['browser','ios','android'].includes(k)).reduce((s,[,v]) => s+v, 0)), note: 'RN, Flutter, etc.' },
          ]}
          onLoad={scanData.rum.total > 0 ? () => {
            const mobilePct = Math.round(((scanData.rum.byType['ios'] ?? 0) + (scanData.rum.byType['android'] ?? 0)) / Math.max(scanData.rum.total, 1) * 100);
            setMobileUsers(mobilePct);
          } : undefined}
        />
      )}

      <PresetBar
        presets={RUM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = RUM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setMau(p.mau);
          setSessionsPerUser(p.sessionsPerUser);
        }}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">User Traffic</h3>
          <SliderInput
            label="Monthly Active Users (MAU)" value={mau} min={1000} max={50000000} unit="users/mo"
            onChange={(v) => { setMau(v); setPresetId(null); }} log
            info="Unique users visiting your site/app per month — the base multiplier for nearly every RUM cost driver below."
          />
          <SliderInput label="Sessions per User / Month" value={sessionsPerUser} min={1} max={100} unit="sessions" hint="A session = 15 min of continuous activity" onChange={(v) => { setSessionsPerUser(v); setPresetId(null); }} />
          <SliderInput label="Page Views per Session" value={pageviewsPerSession} min={1} max={100} unit="pageviews" onChange={setPageviewsPerSession} />
          <SliderInput label="Mobile Users" value={mobileUsers} min={0} max={100} unit="%" hint="Mobile SDK sessions billed separately" onChange={setMobileUsers} />
          <SliderInput
            label="Session Replay Rate" value={replayRate} min={0} max={100} unit="% of browser sessions" hint="100% = full fidelity but highest data volume. 5-10% typical." onChange={setReplayRate}
            info="Replay records what users actually saw for debugging/UX review. It's billed per session recorded, so most teams sample 5-20% rather than record everything."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Total Sessions / Month" value={fmtNum(c.totalSessions)} sub={`${fmtNum(mau)} MAU × ${sessionsPerUser} sessions`} color="violet" />
            <ResultCard label="Replay Sessions / Month" value={fmtNum(c.replaySessions)} sub={`${replayRate}% of browser sessions`} color={replayRate > 30 ? 'amber' : 'blue'} />
            <ResultCard label="Page Views / Month" value={fmtNum(c.totalPageviews)} sub={`${pageviewsPerSession} views/session`} color="gray" />
            <ResultCard label="Replay Storage" value={`${c.replayStorageGb.toFixed(0)} GB/mo`} sub="~2MB per replay session" color="gray" />
          </div>

          {presetId && PRESET_TO_TIER[presetId] && TIER_BASELINES.rum?.[PRESET_TO_TIER[presetId]] && (
            <BaselineCard
              tier={PRESET_TO_TIER[presetId]}
              ranges={TIER_BASELINES.rum[PRESET_TO_TIER[presetId]]!}
              currentValues={[c.totalSessions]}
            />
          )}

          <SizingBlock title="Session Breakdown" icon="📱" rows={[
            { label: 'Browser sessions / month', value: fmtNum(c.browserSessions), note: `${(100 - mobileUsers).toFixed(0)}% of total` },
            { label: 'Mobile sessions / month', value: fmtNum(c.mobileSessions), note: `${mobileUsers}% of total` },
            { label: 'Replay sessions / month', value: fmtNum(c.replaySessions), note: `${replayRate}% replay rate` },
            { label: 'Total page views / month', value: fmtNum(c.totalPageviews) },
            { label: 'User actions / month', value: fmtNum(c.totalActions), note: '~3 actions/pageview' },
          ]} />

          <SizingBlock title="Sampling Strategy" icon="⚡" rows={[
            { label: 'Replay at 5% (cost-effective)', value: fmtNum(c.totalSessions * 0.05), note: 'sessions replayed' },
            { label: 'Replay at 20% (balanced)', value: fmtNum(c.totalSessions * 0.20), note: 'sessions replayed' },
            { label: 'Replay at 100% (full fidelity)', value: fmtNum(c.browserSessions), note: 'sessions replayed' },
            { label: 'Error-triggered replays only', value: fmtNum(c.totalSessions * 0.02), note: 'lowest cost option' },
          ]} />
        </div>
      </div>

      {mode === 'current' && rumUsage && (
        <CostSavingsCard
          label="RUM Sessions"
          usageValue={rumUsage.value}
          usageUnit="sessions/mo"
          committedCost={rumUsage.committedCost}
          onDemandCost={rumUsage.onDemandCost}
          listPriceCost={c.listPriceCost}
        />
      )}

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'MAU', baseline: mau, unit: 'users' },
        { label: 'Sessions / Month', baseline: c.totalSessions, unit: '' },
        { label: 'Replay Sessions / Month', baseline: c.replaySessions, unit: '' },
        { label: 'Page Views / Month', baseline: c.totalPageviews, unit: '' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Synthetics ───────────────────────────────────────────────────────────────

const SYNTHETICS_PRESETS = [
  { id: 'small', label: 'Startup', sub: 'few key flows', apiTests: 10, browserTests: 3 },
  { id: 'mid', label: 'Growth', sub: 'core user journeys', apiTests: 50, browserTests: 20 },
  { id: 'large', label: 'Mid-Market', sub: 'broad coverage', apiTests: 300, browserTests: 80 },
  { id: 'enterprise', label: 'Enterprise', sub: 'full regression suite', apiTests: 2000, browserTests: 400 },
];

function SyntheticsCalculator({ scanData, mode, usageData, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [apiTests, setApiTests] = useModeState(mode, 'synthetics.apiTests', 50);
  const [apiLocations, setApiLocations] = useModeState(mode, 'synthetics.apiLocations', 3);
  const [apiFreqMin, setApiFreqMin] = useModeState(mode, 'synthetics.apiFreqMin', 5);
  const [browserTests, setBrowserTests] = useModeState(mode, 'synthetics.browserTests', 20);
  const [browserLocations, setBrowserLocations] = useModeState(mode, 'synthetics.browserLocations', 2);
  const [browserFreqMin, setBrowserFreqMin] = useModeState(mode, 'synthetics.browserFreqMin', 60);
  const [multiStepTests, setMultiStepTests] = useModeState(mode, 'synthetics.multiStepTests', 10);
  const [stepsPerTest, setStepsPerTest] = useModeState(mode, 'synthetics.stepsPerTest', 5);
  const [growthRate, setGrowthRate] = useModeState(mode, 'synthetics.growthRate', 20);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'synthetics.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setApiTests(0); setApiLocations(0); setBrowserTests(0); setBrowserLocations(0);
    setMultiStepTests(0); setStepsPerTest(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const apiRunsPerMonth = apiTests * apiLocations * (30 * 24 * 60 / apiFreqMin);
    const browserRunsPerMonth = browserTests * browserLocations * (30 * 24 * 60 / browserFreqMin);
    const multiStepRunsPerMonth = multiStepTests * 2 * (30 * 24 * 60 / 15); // 2 locations, 15 min
    const multiStepChecksPerMonth = multiStepRunsPerMonth * stepsPerTest;
    const totalRunsPerMonth = apiRunsPerMonth + browserRunsPerMonth + multiStepRunsPerMonth;

    // Browser step estimate (~5 steps per browser test)
    const browserStepsPerMonth = browserRunsPerMonth * 5;

    const listPriceCost = (apiRunsPerMonth / 10000) * DD_PRICES.syntheticsApi10k + (browserStepsPerMonth / 1000) * DD_PRICES.syntheticsBrowser1k;

    return {
      apiRunsPerMonth, browserRunsPerMonth, multiStepRunsPerMonth,
      multiStepChecksPerMonth, totalRunsPerMonth, browserStepsPerMonth, listPriceCost,
    };
  }, [apiTests, apiLocations, apiFreqMin, browserTests, browserLocations, browserFreqMin, multiStepTests, stepsPerTest]);

  const syntheticsUsage = mode === 'current' ? sumUsageProducts(usageData, ['Synthetics API Tests', 'Synthetics Browser Tests']) : null;

  useEffect(() => {
    if (mode === 'multi') return;
    const realCost = syntheticsUsage ? syntheticsUsage.committedCost + syntheticsUsage.onDemandCost : undefined;
    reportCost({
      id: 'synthetics', label: 'Synthetics', icon: '🧪', primaryMetric: `${apiTests + browserTests} tests`, listPriceCost: c.listPriceCost, realCost,
      skuLines: [
        { sku: 'SYN-API', description: 'Synthetic API Test Runs', quantity: c.apiRunsPerMonth / 10000, unit: '10K runs', rate: DD_PRICES.syntheticsApi10k, amount: (c.apiRunsPerMonth / 10000) * DD_PRICES.syntheticsApi10k },
        { sku: 'SYN-BROWSER', description: 'Synthetic Browser Test Steps', quantity: c.browserStepsPerMonth / 1000, unit: 'K steps', rate: DD_PRICES.syntheticsBrowser1k, amount: (c.browserStepsPerMonth / 1000) * DD_PRICES.syntheticsBrowser1k },
      ],
    });
  }, [mode, apiTests, browserTests, c.listPriceCost, syntheticsUsage, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🧪" title="Synthetics Test Calculator" description="Estimate monthly test runs, browser steps, and optimization opportunities across your Synthetics suite." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Synthetics Test Runs"
          growthRate={growthRate}
          usageUnit="runs/mo"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['Synthetics API Tests', 'Synthetics Browser Tests']);
            const usage = u?.value ?? (r.analytics ? r.analytics.synthetics.apiTests + r.analytics.synthetics.browserTests : null);
            const cost = u ? u.committedCost + u.onDemandCost : 0;
            return { orgName: r.org.name, orgId: r.org.id, usage, cost, costIsEstimate: !u };
          })}
        />
      ) : (
      <>
      {scanData && (scanData.synthetics.apiTests + scanData.synthetics.browserTests) > 0 && (
        <ScanContext
          id="synthetics"
          onLoad={() => {
            setApiTests(scanData.synthetics.apiTests);
            setBrowserTests(scanData.synthetics.browserTests);
          }}
          items={[
            { label: 'API Tests', actual: String(scanData.synthetics.apiTests), note: 'active in org' },
            { label: 'Browser Tests', actual: String(scanData.synthetics.browserTests), note: 'higher cost per run' },
            { label: 'Est. Monthly Runs', actual: fmtNum(scanData.synthetics.estimatedMonthlyRuns), note: 'based on default frequency' },
            { label: 'Browser Ratio', actual: `${Math.round(scanData.synthetics.browserTests / Math.max(scanData.synthetics.apiTests + scanData.synthetics.browserTests, 1) * 100)}%`, note: 'of total tests' },
          ]}
        />
      )}

      <PresetBar
        presets={SYNTHETICS_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = SYNTHETICS_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setApiTests(p.apiTests);
          setBrowserTests(p.browserTests);
        }}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Test Configuration</h3>
          <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide pt-1">API Tests</div>
          <SliderInput label="API Tests" value={apiTests} min={0} max={10000} unit="tests" onChange={(v) => { setApiTests(v); setPresetId(null); }} />
          <SliderInput label="Locations per API Test" value={apiLocations} min={1} max={30} unit="locations" onChange={setApiLocations} />
          <SliderInput label="API Test Frequency" value={apiFreqMin} min={1} max={1440} unit="min interval" hint="1min = highest frequency; 60min = hourly" onChange={setApiFreqMin} />
          <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide pt-1 border-t border-border">Browser Tests</div>
          <SliderInput
            label="Browser Tests" value={browserTests} min={0} max={5000} unit="tests" onChange={(v) => { setBrowserTests(v); setPresetId(null); }}
            info="Browser tests render the full page in a real browser and bill per step (~5×), so they cost far more per run than API tests."
          />
          <SliderInput label="Locations per Browser Test" value={browserLocations} min={1} max={20} unit="locations" onChange={setBrowserLocations} />
          <SliderInput label="Browser Test Frequency" value={browserFreqMin} min={5} max={1440} unit="min interval" hint="60min typical; browser tests are expensive, run less frequently" onChange={setBrowserFreqMin} />
          <Advanced label="Multi-step API & growth">
            <SliderInput label="Multi-Step API Tests" value={multiStepTests} min={0} max={2000} unit="tests" onChange={setMultiStepTests} />
            <SliderInput label="Steps per Multi-Step Test" value={stepsPerTest} min={2} max={50} unit="steps" hint="Billed per step, not per run" onChange={setStepsPerTest} />
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="API Runs / Month" value={fmtNum(c.apiRunsPerMonth)} sub={`${apiTests} tests × ${apiLocations} loc`} color="violet" />
            <ResultCard label="Browser Runs / Month" value={fmtNum(c.browserRunsPerMonth)} sub={`${browserTests} tests × ${browserLocations} loc`} color="blue" />
            <ResultCard label="Browser Steps / Month" value={fmtNum(c.browserStepsPerMonth)} sub="~5 steps avg per run" color="amber" />
            <ResultCard label="Total Runs / Month" value={fmtNum(c.totalRunsPerMonth)} sub="all test types" color="gray" />
          </div>

          {presetId && PRESET_TO_TIER[presetId] && TIER_BASELINES.synthetics?.[PRESET_TO_TIER[presetId]] && (
            <BaselineCard
              tier={PRESET_TO_TIER[presetId]}
              ranges={TIER_BASELINES.synthetics[PRESET_TO_TIER[presetId]]!}
              currentValues={[c.apiRunsPerMonth, c.browserRunsPerMonth]}
            />
          )}

          <SizingBlock title="Test Type Comparison" icon="⚡" rows={[
            { label: 'API tests cost', value: '1 check = 1 run', note: 'cheapest option' },
            { label: 'Browser tests cost', value: '1 run = 5+ steps', note: 'billed per browser step' },
            { label: 'Multi-step API cost', value: '1 run = N steps', note: 'billed per HTTP step' },
            { label: 'Multi-step checks/month', value: fmtNum(c.multiStepChecksPerMonth), note: `${multiStepTests} tests × ${stepsPerTest} steps` },
          ]} />

          <SizingBlock title="Optimization Opportunities" icon="💡" rows={[
            { label: 'Convert browser → API tests', value: '~5× cheaper per run', note: 'if no JS rendering needed' },
            { label: 'Halve browser test frequency', value: `−${fmtNum(c.browserRunsPerMonth / 2)} runs/mo`, note: 'e.g. 30min→60min' },
            { label: 'Reduce browser locations', value: `1 loc = ${fmtNum(c.browserRunsPerMonth / browserLocations)} runs/mo`, note: 'focus on key regions' },
            { label: 'API tests at current rate', value: `${fmtNum(c.apiRunsPerMonth)} runs/mo`, note: 'most efficient' },
          ]} />
        </div>
      </div>

      {mode === 'current' && syntheticsUsage && (
        <CostSavingsCard
          label="Synthetics Tests"
          usageValue={syntheticsUsage.value}
          usageUnit="runs"
          committedCost={syntheticsUsage.committedCost}
          onDemandCost={syntheticsUsage.onDemandCost}
          listPriceCost={c.listPriceCost}
        />
      )}

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'API Runs / Month', baseline: c.apiRunsPerMonth, unit: '' },
        { label: 'Browser Runs / Month', baseline: c.browserRunsPerMonth, unit: '' },
        { label: 'Browser Steps / Month', baseline: c.browserStepsPerMonth, unit: '' },
        { label: 'Total Runs / Month', baseline: c.totalRunsPerMonth, unit: '' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Custom Metrics ───────────────────────────────────────────────────────────

const METRICS_PRESETS = [
  { id: 'small', label: 'Startup', sub: 'low cardinality', services: 10, avgTags: 3, avgCardinalityPerTag: 5, hosts: 20, thirdPartyIntegrations: 3 },
  { id: 'mid', label: 'Growth', sub: 'typical tagging', services: 30, avgTags: 5, avgCardinalityPerTag: 10, hosts: 100, thirdPartyIntegrations: 10 },
  { id: 'large', label: 'Mid-Market', sub: 'rich tagging', services: 150, avgTags: 6, avgCardinalityPerTag: 25, hosts: 400, thirdPartyIntegrations: 30 },
  { id: 'enterprise', label: 'Enterprise', sub: 'high cardinality risk', services: 800, avgTags: 7, avgCardinalityPerTag: 60, hosts: 3000, thirdPartyIntegrations: 80 },
];

function MetricsCalculator({ scanData, mode, usageData, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [services, setServices] = useModeState(mode, 'metrics.services', 30);
  const [metricsPerService, setMetricsPerService] = useModeState(mode, 'metrics.metricsPerService', 50);
  const [avgTags, setAvgTags] = useModeState(mode, 'metrics.avgTags', 5);
  const [avgCardinalityPerTag, setAvgCardinalityPerTag] = useModeState(mode, 'metrics.avgCardinalityPerTag', 10);
  const [hosts, setHosts] = useModeState(mode, 'metrics.hosts', 100);
  const [allotmentPerHost, setAllotmentPerHost] = useModeState(mode, 'metrics.allotmentPerHost', 100);
  const [thirdPartyIntegrations, setThirdPartyIntegrations] = useModeState(mode, 'metrics.thirdPartyIntegrations', 10);
  const [metricsPerIntegration, setMetricsPerIntegration] = useModeState(mode, 'metrics.metricsPerIntegration', 200);
  const [growthRate, setGrowthRate] = useModeState(mode, 'metrics.growthRate', 20);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'metrics.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setServices(0); setMetricsPerService(0); setAvgTags(0); setAvgCardinalityPerTag(0);
    setHosts(0); setThirdPartyIntegrations(0); setMetricsPerIntegration(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    // Custom metrics = unique combinations of metric_name + tag_set
    const serviceMetrics = services * metricsPerService * Math.pow(avgCardinalityPerTag, Math.min(avgTags, 3)); // simplified
    const integMetrics = thirdPartyIntegrations * metricsPerIntegration;
    const totalMetrics = Math.round(serviceMetrics + integMetrics);

    const allotment = Math.max(100, hosts * allotmentPerHost);
    const onDemand = Math.max(0, totalMetrics - allotment);
    const utilizationPct = Math.round((totalMetrics / allotment) * 100);

    // Top cardinality drivers
    const perMetricCardinality = Math.pow(avgCardinalityPerTag, Math.min(avgTags, 3));

    const listPriceCost = (onDemand / 100) * DD_PRICES.customMetricsPer100;

    return { serviceMetrics, integMetrics, totalMetrics, allotment, onDemand, utilizationPct, perMetricCardinality, listPriceCost };
  }, [services, metricsPerService, avgTags, avgCardinalityPerTag, hosts, allotmentPerHost, thirdPartyIntegrations, metricsPerIntegration]);

  const metricsUsage = mode === 'current' ? sumUsageProducts(usageData, ['Custom Metrics']) : null;

  useEffect(() => {
    if (mode === 'multi') return;
    const realCost = metricsUsage ? metricsUsage.committedCost + metricsUsage.onDemandCost : undefined;
    reportCost({
      id: 'metrics', label: 'Custom Metrics', icon: '📈', primaryMetric: `${fmtNum(c.totalMetrics)} metrics`, listPriceCost: c.listPriceCost, realCost,
      skuLines: [{ sku: 'CM-ONDEMAND', description: 'Custom Metrics (on-demand overage)', quantity: c.onDemand, unit: 'metrics', rate: DD_PRICES.customMetricsPer100 / 100, amount: c.listPriceCost }],
    });
  }, [mode, c.totalMetrics, c.listPriceCost, metricsUsage, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="📈" title="Custom Metrics Calculator" description="Model custom metric cardinality, allotment utilization, and on-demand risk from services and integrations." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Custom Metrics"
          growthRate={growthRate}
          usageUnit="timeseries"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['Custom Metrics']);
            const usage = u?.value ?? r.analytics?.customMetrics.estimated ?? null;
            const overage = usage != null ? Math.max(0, usage - (r.analytics?.customMetrics.allotmentAt100PerHost ?? 0)) : 0;
            const cost = u ? u.committedCost + u.onDemandCost : (overage / 100) * DD_PRICES.customMetricsPer100;
            return { orgName: r.org.name, orgId: r.org.id, usage, cost, costIsEstimate: !u };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="metrics"
          onLoad={() => {
            setHosts(scanData.infrastructure.totalHosts);
            setServices(scanData.apm.totalServices);
            setThirdPartyIntegrations(scanData.integrations.configured);
          }}
          items={[
            { label: 'Estimated CM', actual: fmtNum(scanData.customMetrics.estimated), note: 'from tag cardinality' },
            { label: 'Allotment (100/host)', actual: fmtNum(scanData.customMetrics.allotmentAt100PerHost), note: `${scanData.infrastructure.totalHosts} hosts` },
            { label: 'Utilization', actual: `${scanData.customMetrics.utilizationPct}%`, note: `risk: ${scanData.customMetrics.risk}` },
            { label: 'Top Driver', actual: scanData.customMetrics.topDrivers[0]?.key ?? '—', note: scanData.customMetrics.topDrivers[0] ? `${scanData.customMetrics.topDrivers[0].uniqueValues} unique values` : '' },
          ]}
        />
      )}

      <PresetBar
        presets={METRICS_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = METRICS_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setServices(p.services);
          setAvgTags(p.avgTags);
          setAvgCardinalityPerTag(p.avgCardinalityPerTag);
          setHosts(p.hosts);
          setThirdPartyIntegrations(p.thirdPartyIntegrations);
        }}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Metric Sources</h3>
          <SliderInput label="Application Services" value={services} min={1} max={5000} unit="services" onChange={(v) => { setServices(v); setPresetId(null); }} />
          <SliderInput label="Custom Metrics per Service" value={metricsPerService} min={1} max={1000} unit="metrics" hint="Business + technical metrics emitted per service" onChange={setMetricsPerService} />
          <SliderInput
            label="Tags per Metric (avg)" value={avgTags} min={1} max={15} unit="tags" hint="Tags multiply cardinality exponentially" onChange={(v) => { setAvgTags(v); setPresetId(null); }}
            info="Each additional tag multiplies unique timeseries by that tag's cardinality — this is the biggest lever for runaway custom metric costs, more than metric count itself."
          />
          <SliderInput label="Cardinality per Tag (avg)" value={avgCardinalityPerTag} min={2} max={10000} unit="values" hint="env:3, service:50, region:5, version:10..." onChange={setAvgCardinalityPerTag} log />
          <Advanced label="Allotment & integrations">
            <SliderInput label="Infrastructure Hosts" value={hosts} min={0} max={50000} unit="hosts" onChange={(v) => { setHosts(v); setPresetId(null); }} />
            <SelectInput
              label="Allotment per Host"
              value={allotmentPerHost}
              onChange={(v) => setAllotmentPerHost(Number(v))}
              options={[
                { value: 100, label: '100 / host (Pro)' },
                { value: 200, label: '200 / host (Enterprise)' },
                { value: 500, label: '500 / host (Enterprise+)' },
              ]}
            />
            <SliderInput label="3rd-Party Integrations" value={thirdPartyIntegrations} min={0} max={500} unit="integrations" onChange={(v) => { setThirdPartyIntegrations(v); setPresetId(null); }} />
            <SliderInput label="Metrics per Integration (avg)" value={metricsPerIntegration} min={10} max={5000} unit="metrics" onChange={setMetricsPerIntegration} />
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Service Metrics" value={fmtNum(c.serviceMetrics)} sub={`${services} svc × ${metricsPerService} metrics × cardinality`} color="violet" />
            <ResultCard label="Integration Metrics" value={fmtNum(c.integMetrics)} sub={`${thirdPartyIntegrations} integrations`} color="blue" />
            <ResultCard label="Total Custom Metrics" value={fmtNum(c.totalMetrics)} sub="estimated unique timeseries" color={c.utilizationPct > 100 ? 'red' : c.utilizationPct > 80 ? 'amber' : 'green'} />
            <ResultCard label="Allotment" value={fmtNum(c.allotment)} sub={`${allotmentPerHost}/host × ${fmtNum(hosts)} hosts`} color="gray" />
          </div>

          {c.onDemand > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <div className="text-sm font-bold text-red-400 mb-1">⚠ On-Demand Overage Detected</div>
              <div className="text-sm text-red-400">{fmtNum(c.onDemand)} metrics ({c.utilizationPct - 100}% over allotment) will incur on-demand charges.</div>
              <div className="text-xs text-red-500 mt-1">Reduce tag cardinality or increase allotment to avoid.</div>
            </div>
          )}

          <SizingBlock title="Cardinality Analysis" icon="🔢" rows={[
            { label: 'Avg timeseries per metric', value: fmtNum(c.perMetricCardinality), note: `${avgTags} tags × ${avgCardinalityPerTag} values each` },
            { label: 'Allotment utilization', value: `${c.utilizationPct}%`, note: c.utilizationPct > 100 ? 'ON-DEMAND billing active' : 'within allotment' },
            { label: 'On-demand overage', value: c.onDemand > 0 ? fmtNum(c.onDemand) : '0', note: 'metrics over allotment' },
            { label: 'Max safe metrics', value: fmtNum(c.allotment), note: 'at current host count' },
          ]} />

          <SizingBlock title="Reduction Strategies" icon="⚡" rows={[
            { label: 'Remove 1 high-cardinality tag', value: `−${fmtNum(c.serviceMetrics / avgCardinalityPerTag * 0.7)}`, note: 'tags with >100 values' },
            { label: 'Add metrics filter in agent', value: `up to −50%`, note: 'allowlist only needed metrics' },
            { label: 'Use distributions over histos', value: `−4 timeseries/metric`, note: 'p50/p75/p90/p99 → distribution' },
            { label: 'Review integration configs', value: `−${fmtNum(c.integMetrics * 0.3)}`, note: 'disable unused metric namespaces' },
          ]} />
        </div>
      </div>

      {mode === 'current' && metricsUsage && (
        <CostSavingsCard
          label="Custom Metrics"
          usageValue={metricsUsage.value}
          usageUnit="timeseries"
          committedCost={metricsUsage.committedCost}
          onDemandCost={metricsUsage.onDemandCost}
          listPriceCost={c.listPriceCost}
        />
      )}

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Total Custom Metrics', baseline: c.totalMetrics, unit: '' },
        { label: 'Allotment', baseline: c.allotment, unit: '' },
        { label: 'On-Demand Overage', baseline: Math.max(0, c.onDemand), unit: '' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── NPM: Cloud Network Monitor (formerly Network Performance Monitoring) ─────

const NPM_PRESETS = [
  { id: 'small', label: 'Small fleet', sub: '<100 hosts', hostsMonitored: 50, flowsPerSec: 2000 },
  { id: 'mid', label: 'Mid-size fleet', sub: '~200 hosts', hostsMonitored: 200, flowsPerSec: 10000 },
  { id: 'large', label: 'Large fleet', sub: '~2,000 hosts', hostsMonitored: 2000, flowsPerSec: 100000 },
  { id: 'enterprise', label: 'Enterprise', sub: '10,000+ hosts', hostsMonitored: 15000, flowsPerSec: 1000000 },
];

function NPMCalculator({ scanData, mode, usageData, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [hostsMonitored, setHostsMonitored] = useModeState(mode, 'npm.hostsMonitored', 200);
  const [avgConnectionsPerHost, setAvgConnectionsPerHost] = useModeState(mode, 'npm.avgConnectionsPerHost', 500);
  const [flowsPerSec, setFlowsPerSec] = useModeState(mode, 'npm.flowsPerSec', 10000);
  const [retentionDays, setRetentionDays] = useModeState(mode, 'npm.retentionDays', 7);
  const [ebpfEnabled, setEbpfEnabled] = useModeState(mode, 'npm.ebpfEnabled', true);
  const [growthRate, setGrowthRate] = useModeState(mode, 'npm.growthRate', 20);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'npm.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setHostsMonitored(0); setAvgConnectionsPerHost(0); setFlowsPerSec(0); setRetentionDays(0);
    setEbpfEnabled(false); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const totalConnections = hostsMonitored * avgConnectionsPerHost;
    const flowsPerMin = flowsPerSec * 60;
    const dataGbPerDay = (flowsPerSec * 200 * 86400) / 1e9; // ~200 bytes per flow record
    const totalStorageGb = dataGbPerDay * retentionDays;

    // Agent overhead per host
    const agentCpuPct = ebpfEnabled ? 3 : 1; // % CPU overhead
    const agentMemMb = ebpfEnabled ? 150 : 50;

    const listPriceCost = hostsMonitored * DD_PRICES.npmHost;

    return { totalConnections, flowsPerMin, dataGbPerDay, totalStorageGb, agentCpuPct, agentMemMb, listPriceCost };
  }, [hostsMonitored, avgConnectionsPerHost, flowsPerSec, retentionDays, ebpfEnabled]);

  const npmUsage = mode === 'current' ? sumUsageProducts(usageData, ['Network Monitoring']) : null;

  useEffect(() => {
    if (mode === 'multi') return;
    const realCost = npmUsage ? npmUsage.committedCost + npmUsage.onDemandCost : undefined;
    reportCost({
      id: 'npm', label: 'Network Flows', icon: '🌊', primaryMetric: `${fmtNum(hostsMonitored)} hosts`, listPriceCost: c.listPriceCost, realCost,
      skuLines: [{ sku: 'NPM-HOST', description: 'Cloud Network Monitor', quantity: hostsMonitored, unit: 'hosts', rate: DD_PRICES.npmHost, amount: c.listPriceCost }],
    });
  }, [mode, hostsMonitored, c.listPriceCost, npmUsage, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🌊" title="Cloud Network Monitor (CNM)" description="Estimate CNM flow data volume, connection tracking, and agent resource overhead for your host fleet." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="CNM Hosts"
          growthRate={growthRate}
          usageUnit="hosts"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['Network Monitoring']);
            const usage = u?.value ?? null;
            const cost = u ? u.committedCost + u.onDemandCost : (usage != null ? usage * DD_PRICES.npmHost : 0);
            return { orgName: r.org.name, orgId: r.org.id, usage, cost, costIsEstimate: !u };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="npm"
          onLoad={() => setHostsMonitored(Math.max(1, scanData.infrastructure.totalHosts))}
          items={[
            { label: 'Agent Hosts', actual: String(scanData.infrastructure.totalHosts), note: 'eligible for CNM' },
            { label: 'CNM Integration', actual: scanData.integrations.list.some(i => i.name.toLowerCase().includes('network')) ? 'Detected' : 'Not detected', note: 'network check active' },
          ]}
        />
      )}

      <PresetBar
        presets={NPM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = NPM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setHostsMonitored(p.hostsMonitored);
          setFlowsPerSec(p.flowsPerSec);
        }}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">CNM Configuration</h3>
          <SliderInput label="Hosts with CNM Agent" value={hostsMonitored} min={1} max={50000} unit="hosts" onChange={(v) => { setHostsMonitored(v); setPresetId(null); }} log />
          <SliderInput label="Active Connections per Host" value={avgConnectionsPerHost} min={10} max={50000} unit="connections" hint="Active TCP/UDP connections tracked simultaneously" onChange={setAvgConnectionsPerHost} log />
          <SliderInput
            label="Network Flows per Second" value={flowsPerSec} min={100} max={10000000} unit="flows/sec" hint="Total across all monitored hosts" onChange={(v) => { setFlowsPerSec(v); setPresetId(null); }} log
            info="Every distinct connection (5-tuple) generates a flow record. This is the main driver of CNM data volume — not host count."
          />
          <Advanced>
            <SliderInput label="Data Retention" value={retentionDays} min={1} max={90} unit="days" onChange={setRetentionDays} />
            <div className="flex items-center gap-3">
              <input type="checkbox" id="ebpf" checked={ebpfEnabled} onChange={(e) => setEbpfEnabled(e.target.checked)} className="accent-violet-600" />
              <label htmlFor="ebpf" className="text-sm text-ink-muted">eBPF kernel-level tracing (higher fidelity, more overhead)</label>
            </div>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Tracked Connections" value={fmtNum(c.totalConnections)} sub={`${hostsMonitored} hosts × ${avgConnectionsPerHost} each`} color="violet" />
            <ResultCard label="Flows / Minute" value={fmtNum(c.flowsPerMin)} sub="all hosts combined" color="blue" />
            <ResultCard label="Flow Data / Day" value={`${c.dataGbPerDay.toFixed(1)} GB`} sub="~200 bytes/flow record" color="gray" />
            <ResultCard label={`Storage (${retentionDays}d)`} value={`${c.totalStorageGb.toFixed(0)} GB`} sub="flow record retention" color={c.totalStorageGb > 1000 ? 'amber' : 'green'} />
          </div>

          <SizingBlock title="Agent Overhead (per host)" icon="⚙" rows={[
            { label: 'CPU overhead', value: `~${c.agentCpuPct}%`, note: ebpfEnabled ? 'eBPF mode' : 'standard mode' },
            { label: 'Memory overhead', value: `~${c.agentMemMb}MB`, note: 'per agent instance' },
            { label: 'Total CPU overhead', value: `${(hostsMonitored * c.agentCpuPct / 100).toFixed(1)} cores`, note: 'across fleet (at 1-core hosts)' },
            { label: 'Total memory overhead', value: `${((hostsMonitored * c.agentMemMb) / 1024).toFixed(1)} GB`, note: 'across fleet' },
          ]} />

          <SizingBlock title="Data Sizing" icon="💾" rows={[
            { label: 'Flow record size', value: '~200 bytes', note: 'src/dst IP, port, protocol, bytes, packets' },
            { label: 'Hourly data volume', value: `${(c.dataGbPerDay / 24).toFixed(2)} GB/hr` },
            { label: 'Monthly data volume', value: `${(c.dataGbPerDay * 30).toFixed(0)} GB/mo` },
            { label: 'Compression ratio', value: '~3-5×', note: 'after columnar compression' },
          ]} />
        </div>
      </div>

      {mode === 'current' && npmUsage && (
        <CostSavingsCard
          label="Cloud Network Monitor"
          usageValue={npmUsage.value}
          usageUnit="hosts"
          committedCost={npmUsage.committedCost}
          onDemandCost={npmUsage.onDemandCost}
          listPriceCost={c.listPriceCost}
        />
      )}

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Hosts Monitored', baseline: hostsMonitored, unit: '' },
        { label: 'Flows / Second', baseline: flowsPerSec, unit: 'flows/s' },
        { label: 'Data / Day', baseline: c.dataGbPerDay, unit: 'GB/day', formatter: (n) => n.toFixed(1) },
        { label: 'Storage Total', baseline: c.totalStorageGb, unit: 'GB', formatter: (n) => n.toFixed(0) },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Cloud Integration Metrics ────────────────────────────────────────────────

const CLOUD_PRESETS = [
  { id: 'small', label: 'Single cloud, small', sub: '~50 EC2', awsAccounts: 1, ec2Instances: 50, rdsInstances: 5, lambdaFunctions: 20, gcpProjects: 0, gceInstances: 0, azureSubscriptions: 0, azureVms: 0 },
  { id: 'mid', label: 'Multi-cloud, growth', sub: '~200 EC2', awsAccounts: 5, ec2Instances: 200, rdsInstances: 20, lambdaFunctions: 100, gcpProjects: 2, gceInstances: 50, azureSubscriptions: 1, azureVms: 30 },
  { id: 'large', label: 'Multi-cloud, large', sub: '~1,500 EC2', awsAccounts: 15, ec2Instances: 1500, rdsInstances: 80, lambdaFunctions: 500, gcpProjects: 6, gceInstances: 300, azureSubscriptions: 4, azureVms: 200 },
  { id: 'enterprise', label: 'Enterprise scale', sub: '10,000+ EC2', awsAccounts: 50, ec2Instances: 10000, rdsInstances: 400, lambdaFunctions: 3000, gcpProjects: 20, gceInstances: 2000, azureSubscriptions: 15, azureVms: 1200 },
];

function CloudCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [awsAccounts, setAwsAccounts] = useModeState(mode, 'cloud.awsAccounts', 5);
  const [ec2Instances, setEc2Instances] = useModeState(mode, 'cloud.ec2Instances', 200);
  const [rdsInstances, setRdsInstances] = useModeState(mode, 'cloud.rdsInstances', 20);
  const [lambdaFunctions, setLambdaFunctions] = useModeState(mode, 'cloud.lambdaFunctions', 100);
  const [gcpProjects, setGcpProjects] = useModeState(mode, 'cloud.gcpProjects', 2);
  const [gceInstances, setGceInstances] = useModeState(mode, 'cloud.gceInstances', 50);
  const [azureSubscriptions, setAzureSubscriptions] = useModeState(mode, 'cloud.azureSubscriptions', 1);
  const [azureVms, setAzureVms] = useModeState(mode, 'cloud.azureVms', 30);
  const [growthRate, setGrowthRate] = useModeState(mode, 'cloud.growthRate', 25);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'cloud.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setAwsAccounts(0); setEc2Instances(0); setRdsInstances(0); setLambdaFunctions(0);
    setGcpProjects(0); setGceInstances(0); setAzureSubscriptions(0); setAzureVms(0);
    setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    // AWS metrics per resource (approximate Datadog CloudWatch metric counts)
    const awsMetrics = awsAccounts * (
      ec2Instances * 15 +     // EC2: CPU, network, disk, status
      rdsInstances * 25 +     // RDS: connections, IOPS, storage, replication
      lambdaFunctions * 8     // Lambda: invocations, duration, errors, throttles
    );

    // GCP metrics per resource
    const gcpMetrics = gcpProjects * (
      gceInstances * 12 +     // GCE: CPU, disk, network
      50 * 8                  // GKE clusters, Cloud SQL, etc.
    );

    // Azure metrics per resource
    const azureMetrics = azureSubscriptions * (
      azureVms * 10 +         // VMs: CPU, disk, network
      20 * 6                  // App Service, SQL, etc.
    );

    const totalMetrics = awsMetrics + gcpMetrics + azureMetrics;

    // Host equivalents (cloud resources billed as hosts in some cases)
    const hostEquiv = ec2Instances * awsAccounts + gceInstances * gcpProjects + azureVms * azureSubscriptions;

    const listPriceCost = hostEquiv * DD_PRICES.infraHostPro;

    return { awsMetrics, gcpMetrics, azureMetrics, totalMetrics, hostEquiv, listPriceCost };
  }, [awsAccounts, ec2Instances, rdsInstances, lambdaFunctions, gcpProjects, gceInstances, azureSubscriptions, azureVms]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'cloud', label: 'Cloud Accounts', icon: '☁', primaryMetric: `${fmtNum(c.hostEquiv)} cloud instances`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'INFRA-HOST-PRO', description: 'Cloud Instances (host-equivalent, Infra Pro)', quantity: c.hostEquiv, unit: 'instances', rate: DD_PRICES.infraHostPro, amount: c.listPriceCost }],
    });
  }, [mode, c.hostEquiv, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="☁" title="Cloud Integration Metrics Calculator" description="Estimate CloudWatch, GCP Monitoring, and Azure Monitor metric volumes from your cloud footprint." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Cloud Accounts (host-equivalent estimate)"
          growthRate={growthRate}
          usageUnit="accounts"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const accounts = r.analytics?.infrastructure.cloudAccounts.reduce((s, a) => s + a.n, 0) ?? null;
            const cost = accounts != null ? accounts * ec2Instances * DD_PRICES.infraHostPro : 0;
            return { orgName: r.org.name, orgId: r.org.id, usage: accounts, cost, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && scanData.infrastructure.cloudAccounts.length > 0 && (
        <ScanContext
          id="cloud"
          onLoad={() => {
            const aws = scanData.infrastructure.cloudAccounts.find(a => a.provider === 'aws')?.n ?? 0;
            const gcp = scanData.infrastructure.cloudAccounts.find(a => a.provider === 'gcp')?.n ?? 0;
            const az = scanData.infrastructure.cloudAccounts.find(a => a.provider === 'azure')?.n ?? 0;
            if (aws > 0) setAwsAccounts(aws);
            if (gcp > 0) setGcpProjects(gcp);
            if (az > 0) setAzureSubscriptions(az);
          }}
          items={scanData.infrastructure.cloudAccounts.map(a => ({
            label: a.provider.toUpperCase(),
            actual: String(a.n),
            note: 'accounts / projects detected',
          })).concat([
            { label: 'Total Accounts', actual: String(scanData.infrastructure.cloudAccounts.reduce((s, a) => s + a.n, 0)), note: 'all providers' },
          ])}
        />
      )}

      <PresetBar
        presets={CLOUD_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = CLOUD_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setAwsAccounts(p.awsAccounts);
          setEc2Instances(p.ec2Instances);
          setRdsInstances(p.rdsInstances);
          setLambdaFunctions(p.lambdaFunctions);
          setGcpProjects(p.gcpProjects);
          setGceInstances(p.gceInstances);
          setAzureSubscriptions(p.azureSubscriptions);
          setAzureVms(p.azureVms);
        }}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Cloud Resources</h3>
          <div className="text-xs font-semibold text-ink-muted uppercase pt-1">AWS</div>
          <SliderInput label="AWS Accounts" value={awsAccounts} min={0} max={500} unit="accounts" onChange={(v) => { setAwsAccounts(v); setPresetId(null); }} />
          <SliderInput label="EC2 Instances (per account)" value={ec2Instances} min={0} max={10000} unit="instances" onChange={(v) => { setEc2Instances(v); setPresetId(null); }} log />
          <SliderInput label="RDS Instances (per account)" value={rdsInstances} min={0} max={1000} unit="instances" onChange={setRdsInstances} />
          <SliderInput label="Lambda Functions (per account)" value={lambdaFunctions} min={0} max={10000} unit="functions" onChange={setLambdaFunctions} log />
          <Advanced label="GCP & Azure">
            <div className="text-xs font-semibold text-ink-muted uppercase pt-1">GCP</div>
            <SliderInput label="GCP Projects" value={gcpProjects} min={0} max={200} unit="projects" onChange={(v) => { setGcpProjects(v); setPresetId(null); }} />
            <SliderInput label="GCE Instances (per project)" value={gceInstances} min={0} max={5000} unit="instances" onChange={setGceInstances} log />
            <div className="text-xs font-semibold text-ink-muted uppercase pt-1 border-t border-border">Azure</div>
            <SliderInput label="Azure Subscriptions" value={azureSubscriptions} min={0} max={100} unit="subscriptions" onChange={(v) => { setAzureSubscriptions(v); setPresetId(null); }} />
            <SliderInput label="Azure VMs (per subscription)" value={azureVms} min={0} max={5000} unit="VMs" onChange={setAzureVms} log />
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="AWS Metrics" value={fmtNum(c.awsMetrics)} sub={`${awsAccounts} accounts`} color="amber" />
            <ResultCard label="GCP Metrics" value={fmtNum(c.gcpMetrics)} sub={`${gcpProjects} projects`} color="blue" />
            <ResultCard label="Azure Metrics" value={fmtNum(c.azureMetrics)} sub={`${azureSubscriptions} subscriptions`} color="green" />
            <ResultCard label="Total Cloud Metrics" value={fmtNum(c.totalMetrics)} sub="all providers combined" color="violet" />
          </div>

          <SizingBlock title="Per-Resource Metric Counts" icon="📊" rows={[
            { label: 'EC2 instance', value: '~15 metrics', note: 'CPU, network, disk, status checks' },
            { label: 'RDS instance', value: '~25 metrics', note: 'connections, IOPS, storage, CPU' },
            { label: 'Lambda function', value: '~8 metrics', note: 'invocations, duration, errors, throttles' },
            { label: 'GCE instance', value: '~12 metrics', note: 'CPU, disk, network' },
            { label: 'Azure VM', value: '~10 metrics', note: 'CPU, disk, network, memory' },
          ]} />

          <SizingBlock title="Host Billing Equivalents" icon="🖥" rows={[
            { label: 'EC2 instances (total)', value: fmtNum(ec2Instances * awsAccounts), note: 'billed as hosts with agent' },
            { label: 'GCE instances (total)', value: fmtNum(gceInstances * gcpProjects), note: 'billed as hosts with agent' },
            { label: 'Azure VMs (total)', value: fmtNum(azureVms * azureSubscriptions), note: 'billed as hosts with agent' },
            { label: 'Total cloud host equivalents', value: fmtNum(c.hostEquiv) },
          ]} />
        </div>
      </div>

      <SizingBlock title="List Price Estimate" icon="💰" rows={[
        { label: 'Host-equivalent cloud instances', value: fmtNum(c.hostEquiv), note: `$${DD_PRICES.infraHostPro}/host/mo list price` },
        { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no separate usage-API line for cloud metrics — billed as part of Infra Hosts' },
      ]} />

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'AWS Metrics', baseline: c.awsMetrics, unit: '' },
        { label: 'GCP Metrics', baseline: c.gcpMetrics, unit: '' },
        { label: 'Azure Metrics', baseline: c.azureMetrics, unit: '' },
        { label: 'Total Cloud Metrics', baseline: c.totalMetrics, unit: '' },
        { label: 'Cloud Host Equivalents', baseline: c.hostEquiv, unit: '' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── CSPM / Security ──────────────────────────────────────────────────────────

const CSPM_PRESETS = [
  { id: 'small', label: 'Small footprint', sub: '~200 resources', cloudResources: 200, hostsScanned: 20, k8sClusters: 1 },
  { id: 'mid', label: 'Growth', sub: '~1,000 resources', cloudResources: 1000, hostsScanned: 200, k8sClusters: 5 },
  { id: 'large', label: 'Large footprint', sub: '~10,000 resources', cloudResources: 10000, hostsScanned: 1500, k8sClusters: 25 },
  { id: 'enterprise', label: 'Enterprise', sub: '100,000+ resources', cloudResources: 100000, hostsScanned: 10000, k8sClusters: 100 },
];

function CSPMCalculator({ scanData, mode, usageData, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [cloudResources, setCloudResources] = useModeState(mode, 'cspm.cloudResources', 1000);
  const [k8sClusters, setK8sClusters] = useModeState(mode, 'cspm.k8sClusters', 5);
  const [nodesPerCluster, setNodesPerCluster] = useModeState(mode, 'cspm.nodesPerCluster', 20);
  const [hostsScanned, setHostsScanned] = useModeState(mode, 'cspm.hostsScanned', 200);
  const [scanFreqHours, setScanFreqHours] = useModeState(mode, 'cspm.scanFreqHours', 4);
  const [growthRate, setGrowthRate] = useModeState(mode, 'cspm.growthRate', 20);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'cspm.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setCloudResources(0); setK8sClusters(0); setNodesPerCluster(0); setHostsScanned(0);
    setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const totalNodes = k8sClusters * nodesPerCluster;
    const scansPerDay = 24 / scanFreqHours;
    const cloudScansPerDay = cloudResources * scansPerDay;
    const hostScansPerDay = hostsScanned * scansPerDay;
    const k8sScansPerDay = totalNodes * scansPerDay;
    const totalScansPerDay = cloudScansPerDay + hostScansPerDay + k8sScansPerDay;

    // Findings estimate: ~5% misconfiguration rate
    const findingsEstimate = Math.round(totalScansPerDay * 0.05);

    // CSM is billed per host/node monitored (PRO tier, Annual) — cloud resource inventory
    // scanning (S3, IAM, etc.) is agentless and bundled in, not billed per resource.
    const listPriceCost = (hostsScanned + totalNodes) * DD_PRICES.cspmHostAnnual;

    return { totalNodes, scansPerDay, cloudScansPerDay, hostScansPerDay, k8sScansPerDay, totalScansPerDay, findingsEstimate, listPriceCost };
  }, [cloudResources, k8sClusters, nodesPerCluster, hostsScanned, scanFreqHours]);

  const cspmUsage = mode === 'current' ? sumUsageProducts(usageData, ['CSPM Hosts']) : null;

  useEffect(() => {
    if (mode === 'multi') return;
    const realCost = cspmUsage ? cspmUsage.committedCost + cspmUsage.onDemandCost : undefined;
    reportCost({
      id: 'cspm', label: 'Security Posture', icon: '🛡', primaryMetric: `${fmtNum(hostsScanned + c.totalNodes)} hosts/nodes`, listPriceCost: c.listPriceCost, realCost,
      skuLines: [{ sku: 'CSM-HOST-PRO', description: 'Cloud Security Management (Pro)', quantity: hostsScanned + c.totalNodes, unit: 'hosts', rate: DD_PRICES.cspmHostAnnual, amount: c.listPriceCost }],
    });
  }, [mode, hostsScanned, c.totalNodes, c.listPriceCost, cspmUsage, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🛡" title="CSPM / Security Posture Calculator" description="Estimate cloud, host, and container security posture scan coverage and findings volume." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="CSPM Coverage (hosts/nodes)"
          growthRate={growthRate}
          usageUnit="hosts"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['CSPM Hosts']);
            const usage = u?.value ?? r.analytics?.infrastructure.totalHosts ?? null;
            const cost = u ? u.committedCost + u.onDemandCost : (usage != null ? usage * DD_PRICES.cspmHostAnnual : 0);
            return { orgName: r.org.name, orgId: r.org.id, usage, cost, costIsEstimate: !u };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="cspm"
          onLoad={() => {
            setHostsScanned(Math.max(1, scanData.infrastructure.totalHosts));
            const totalCloud = scanData.infrastructure.cloudAccounts.reduce((s, a) => s + a.n, 0);
            if (totalCloud > 0) setCloudResources(totalCloud * 200);
          }}
          items={[
            { label: 'Agent Hosts', actual: String(scanData.infrastructure.totalHosts), note: 'eligible for CWS' },
            { label: 'Cloud Accounts', actual: String(scanData.infrastructure.cloudAccounts.length), note: 'for CSPM cloud rules' },
            { label: 'Containers', actual: scanData.infrastructure.containers != null ? fmtNum(scanData.infrastructure.containers) : '—', note: 'for container posture' },
          ]}
        />
      )}

      <PresetBar
        presets={CSPM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = CSPM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setCloudResources(p.cloudResources);
          setHostsScanned(p.hostsScanned);
          setK8sClusters(p.k8sClusters);
        }}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Scan Scope</h3>
          <SliderInput label="Cloud Resources Scanned" value={cloudResources} min={10} max={500000} unit="resources" hint="S3, EC2, IAM, RDS, GCS, etc." onChange={(v) => { setCloudResources(v); setPresetId(null); }} log />
          <SliderInput label="Kubernetes Clusters" value={k8sClusters} min={0} max={500} unit="clusters" onChange={(v) => { setK8sClusters(v); setPresetId(null); }} />
          <SliderInput label="Nodes per Cluster (avg)" value={nodesPerCluster} min={1} max={1000} unit="nodes" onChange={setNodesPerCluster} />
          <SliderInput label="Hosts Scanned (CWS/CSPM)" value={hostsScanned} min={0} max={50000} unit="hosts" onChange={(v) => { setHostsScanned(v); setPresetId(null); }} log />
          <Advanced>
            <SliderInput
              label="Scan Frequency" value={scanFreqHours} min={1} max={24} unit="hours" hint="1hr = continuous posture; 24hr = daily batch" onChange={setScanFreqHours}
              info="How often each resource is re-evaluated against compliance rules. More frequent scans catch drift faster but generate more findings volume."
            />
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Cloud Resource Checks/day" value={fmtNum(c.cloudScansPerDay)} sub={`${cloudResources} resources × ${c.scansPerDay}/day`} color="violet" />
            <ResultCard label="K8s Node Checks/day" value={fmtNum(c.k8sScansPerDay)} sub={`${c.totalNodes} nodes`} color="blue" />
            <ResultCard label="Total Checks / Day" value={fmtNum(c.totalScansPerDay)} sub="all resources combined" color="gray" />
            <ResultCard label="Est. Findings / Day" value={fmtNum(c.findingsEstimate)} sub="~5% misconfiguration rate" color="amber" />
          </div>

          <SizingBlock title="Coverage Summary" icon="🔍" rows={[
            { label: 'Cloud resources', value: fmtNum(cloudResources), note: 'AWS, GCP, Azure' },
            { label: 'K8s clusters', value: `${k8sClusters}`, note: `${c.totalNodes} total nodes` },
            { label: 'Hosts (CWS)', value: fmtNum(hostsScanned) },
            { label: 'Scan interval', value: `${scanFreqHours}h`, note: `${c.scansPerDay}× per day` },
          ]} />

          <SizingBlock title="Posture Rules Evaluated" icon="✓" rows={[
            { label: 'Cloud compliance rules', value: '~800+', note: 'CIS, PCI, HIPAA, SOC2' },
            { label: 'K8s security rules', value: '~200+', note: 'pod security, RBAC, network policies' },
            { label: 'Host rules', value: '~100+', note: 'CIS benchmarks' },
            { label: 'Custom rules', value: 'unlimited', note: 'Rego-based custom policies' },
          ]} />
        </div>
      </div>

      {mode === 'current' && cspmUsage && (
        <CostSavingsCard
          label="CSPM"
          usageValue={cspmUsage.value}
          usageUnit="resources"
          committedCost={cspmUsage.committedCost}
          onDemandCost={cspmUsage.onDemandCost}
          listPriceCost={c.listPriceCost}
        />
      )}

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Cloud Resources', baseline: cloudResources, unit: '' },
        { label: 'K8s Nodes', baseline: c.totalNodes, unit: '' },
        { label: 'Total Checks/day', baseline: c.totalScansPerDay, unit: '' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── DBM: Database Monitoring ─────────────────────────────────────────────────

const DBM_PRESETS = [
  { id: 'small', label: 'Small app', sub: '~5 DB instances', postgresInstances: 3, mysqlInstances: 2, sqlServerInstances: 0, oracleInstances: 0, mongodbInstances: 0, queriesPerSec: 100 },
  { id: 'mid', label: 'Growth', sub: '~20 DB instances', postgresInstances: 10, mysqlInstances: 5, sqlServerInstances: 2, oracleInstances: 1, mongodbInstances: 2, queriesPerSec: 500 },
  { id: 'large', label: 'Mid-Market', sub: '~95 DB instances', postgresInstances: 50, mysqlInstances: 20, sqlServerInstances: 10, oracleInstances: 5, mongodbInstances: 10, queriesPerSec: 2000 },
  { id: 'enterprise', label: 'Enterprise', sub: '450+ DB instances', postgresInstances: 250, mysqlInstances: 100, sqlServerInstances: 50, oracleInstances: 20, mongodbInstances: 30, queriesPerSec: 5000 },
];

function DBMCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [postgresInstances, setPostgresInstances] = useModeState(mode, 'dbm.postgresInstances', 10);
  const [mysqlInstances, setMysqlInstances] = useModeState(mode, 'dbm.mysqlInstances', 5);
  const [sqlServerInstances, setSqlServerInstances] = useModeState(mode, 'dbm.sqlServerInstances', 2);
  const [oracleInstances, setOracleInstances] = useModeState(mode, 'dbm.oracleInstances', 1);
  const [mongodbInstances, setMongodbInstances] = useModeState(mode, 'dbm.mongodbInstances', 2);
  const [queriesPerSec, setQueriesPerSec] = useModeState(mode, 'dbm.queriesPerSec', 500);
  const [avgNormalizedQueries, setAvgNormalizedQueries] = useModeState(mode, 'dbm.avgNormalizedQueries', 200);
  const [retentionDays, setRetentionDays] = useModeState(mode, 'dbm.retentionDays', 15);
  const [growthRate, setGrowthRate] = useModeState(mode, 'dbm.growthRate', 15);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'dbm.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setPostgresInstances(0); setMysqlInstances(0); setSqlServerInstances(0);
    setOracleInstances(0); setMongodbInstances(0); setQueriesPerSec(0);
    setAvgNormalizedQueries(0); setRetentionDays(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const totalInstances = postgresInstances + mysqlInstances + sqlServerInstances + oracleInstances + mongodbInstances;
    const totalQps = totalInstances * queriesPerSec;
    const samplesPerMin = totalInstances * 10; // agent samples every 10s
    const explainPlansPerHour = totalInstances * avgNormalizedQueries;
    const metricsPerInstance = 150; // wait events, connections, cache hit, etc.
    const totalMetrics = totalInstances * metricsPerInstance;
    const dataGbPerDay = (totalQps * 500 * 86400) / 1e9; // ~500 bytes per query sample

    const listPriceCost = totalInstances * DD_PRICES.dbmInstance;

    return { totalInstances, totalQps, samplesPerMin, explainPlansPerHour, totalMetrics, dataGbPerDay, listPriceCost };
  }, [postgresInstances, mysqlInstances, sqlServerInstances, oracleInstances, mongodbInstances, queriesPerSec, avgNormalizedQueries, retentionDays]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'dbm', label: 'Database Mon.', icon: '🗄', primaryMetric: `${c.totalInstances} DB instances`, listPriceCost: c.listPriceCost,
      skuLines: [
        { sku: 'DBM-POSTGRES', description: 'PostgreSQL Instance', quantity: postgresInstances, unit: 'instances', rate: DD_PRICES.dbmInstance, amount: postgresInstances * DD_PRICES.dbmInstance },
        { sku: 'DBM-MYSQL', description: 'MySQL / MariaDB Instance', quantity: mysqlInstances, unit: 'instances', rate: DD_PRICES.dbmInstance, amount: mysqlInstances * DD_PRICES.dbmInstance },
        { sku: 'DBM-SQLSERVER', description: 'SQL Server Instance', quantity: sqlServerInstances, unit: 'instances', rate: DD_PRICES.dbmInstance, amount: sqlServerInstances * DD_PRICES.dbmInstance },
        { sku: 'DBM-ORACLE', description: 'Oracle Instance', quantity: oracleInstances, unit: 'instances', rate: DD_PRICES.dbmInstance, amount: oracleInstances * DD_PRICES.dbmInstance },
        { sku: 'DBM-MONGODB', description: 'MongoDB Instance', quantity: mongodbInstances, unit: 'instances', rate: DD_PRICES.dbmInstance, amount: mongodbInstances * DD_PRICES.dbmInstance },
      ].filter(l => l.quantity > 0),
    });
  }, [mode, c.totalInstances, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🗄" title="Database Monitoring (DBM) Calculator" description="Estimate query sample volume, explain plan coverage, and metric output from your database fleet." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="DBM Instances (proxy: DB integration checks)"
          growthRate={growthRate}
          usageUnit="instances"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const dbNames = ['postgres', 'mysql', 'sqlserver', 'oracle', 'mongodb', 'redis'];
            const usage = r.analytics
              ? r.analytics.integrations.list.filter(i => dbNames.some(db => i.name.toLowerCase().includes(db))).length
              : null;
            return { orgName: r.org.name, orgId: r.org.id, usage, cost: usage != null ? usage * DD_PRICES.dbmInstance : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (() => {
        const dbChecks = ['postgres', 'mysql', 'sqlserver', 'oracle', 'mongodb', 'redis'].filter(db =>
          scanData.integrations.list.some(i => i.name.toLowerCase().includes(db))
        );
        return dbChecks.length > 0 ? (
          <ScanContext
            id="dbm"
            onLoad={() => {
              const countOf = (needle: string) => scanData.integrations.list.filter(i => i.name.toLowerCase().includes(needle)).length;
              const pg = countOf('postgres');
              const my = countOf('mysql');
              const mssql = countOf('sqlserver');
              const ora = countOf('oracle');
              const mongo = countOf('mongodb');
              if (pg > 0) setPostgresInstances(pg);
              if (my > 0) setMysqlInstances(my);
              if (mssql > 0) setSqlServerInstances(mssql);
              if (ora > 0) setOracleInstances(ora);
              if (mongo > 0) setMongodbInstances(mongo);
            }}
            items={dbChecks.map(db => ({
              label: db.charAt(0).toUpperCase() + db.slice(1),
              actual: String(scanData.integrations.list.filter(i => i.name.toLowerCase().includes(db)).length),
              note: 'check instances detected',
            }))}
          />
        ) : null;
      })()}

      <PresetBar
        presets={DBM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = DBM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setPostgresInstances(p.postgresInstances);
          setMysqlInstances(p.mysqlInstances);
          setSqlServerInstances(p.sqlServerInstances);
          setOracleInstances(p.oracleInstances);
          setMongodbInstances(p.mongodbInstances);
          setQueriesPerSec(p.queriesPerSec);
        }}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Database Fleet</h3>
          <SliderInput label="PostgreSQL Instances" value={postgresInstances} min={0} max={5000} unit="instances" onChange={(v) => { setPostgresInstances(v); setPresetId(null); }} />
          <SliderInput label="MySQL / MariaDB Instances" value={mysqlInstances} min={0} max={5000} unit="instances" onChange={(v) => { setMysqlInstances(v); setPresetId(null); }} />
          <SliderInput label="SQL Server Instances" value={sqlServerInstances} min={0} max={2000} unit="instances" onChange={(v) => { setSqlServerInstances(v); setPresetId(null); }} />
          <SliderInput label="Oracle Instances" value={oracleInstances} min={0} max={2000} unit="instances" onChange={(v) => { setOracleInstances(v); setPresetId(null); }} />
          <SliderInput label="MongoDB Instances" value={mongodbInstances} min={0} max={2000} unit="instances" hint="Sharded clusters: count each shard/replica set member" onChange={(v) => { setMongodbInstances(v); setPresetId(null); }} />
          <SliderInput
            label="Queries per Second (avg per instance)" value={queriesPerSec} min={1} max={100000} unit="QPS" onChange={(v) => { setQueriesPerSec(v); setPresetId(null); }} log hint="DBM captures samples, not every query"
            info="DBM is billed per database host/instance, not by query volume — this input mainly affects data volume and normalized query counts, not cost."
          />
          <Advanced>
            <SliderInput label="Normalized Unique Queries (per instance)" value={avgNormalizedQueries} min={10} max={10000} unit="unique queries" hint="After query normalization/deduplication" onChange={setAvgNormalizedQueries} log />
            <SliderInput label="Query Retention" value={retentionDays} min={1} max={90} unit="days" onChange={setRetentionDays} />
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Total DB Instances" value={String(c.totalInstances)} sub={`${postgresInstances} PG · ${mysqlInstances} MySQL · ${sqlServerInstances} MSSQL · ${oracleInstances} Oracle · ${mongodbInstances} Mongo`} color="violet" />
            <ResultCard label="Total QPS" value={fmtNum(c.totalQps)} sub="across all instances" color="blue" />
            <ResultCard label="DBM Metrics" value={fmtNum(c.totalMetrics)} sub="~150 per instance" color="gray" />
            <ResultCard label="Sample Data / Day" value={`${c.dataGbPerDay.toFixed(2)} GB`} sub="query samples + explain plans" color={c.dataGbPerDay > 100 ? 'amber' : 'green'} />
          </div>

          <SizingBlock title="Agent Collection" icon="🔄" rows={[
            { label: 'Sample collection interval', value: '10 seconds', note: 'pg_stat_activity, performance_schema' },
            { label: 'Explain plans / hour', value: fmtNum(c.explainPlansPerHour), note: `${avgNormalizedQueries} unique queries per instance` },
            { label: 'Wait event samples / min', value: fmtNum(c.samplesPerMin), note: '10 samples per instance/min' },
            { label: 'Metrics per instance', value: '~150', note: 'connections, cache, locks, replication' },
          ]} />

          <SizingBlock title="Retention & Storage" icon="💾" rows={[
            { label: 'Query sample retention', value: `${retentionDays} days` },
            { label: 'Query metrics retention', value: `${retentionDays} days` },
            { label: 'Explain plan retention', value: `${retentionDays} days` },
            { label: 'Est. storage / month', value: `${(c.dataGbPerDay * 30).toFixed(0)} GB` },
          ]} />
        </div>
      </div>

      <SizingBlock title="List Price Estimate" icon="💰" rows={[
        { label: 'DB instances', value: fmtNum(c.totalInstances), note: `$${DD_PRICES.dbmInstance}/instance/mo list price` },
        { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for DBM yet' },
      ]} />

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Total DB Instances', baseline: c.totalInstances, unit: '' },
        { label: 'Total QPS', baseline: c.totalQps, unit: 'req/s' },
        { label: 'DBM Metrics', baseline: c.totalMetrics, unit: '' },
        { label: 'Data / Day', baseline: c.dataGbPerDay, unit: 'GB/day', formatter: (n) => n.toFixed(2) },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── CI Pipeline Visibility ───────────────────────────────────────────────────

const CI_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~10 committers', committers: 10, pipelinesPerDay: 40, testsPerPipeline: 200 },
  { id: 'mid', label: 'Growth', sub: '~50 committers', committers: 50, pipelinesPerDay: 200, testsPerPipeline: 500 },
  { id: 'large', label: 'Large org', sub: '~300 committers', committers: 300, pipelinesPerDay: 1500, testsPerPipeline: 1500 },
  { id: 'enterprise', label: 'Enterprise', sub: '1,500+ committers', committers: 1500, pipelinesPerDay: 8000, testsPerPipeline: 3000 },
];

function CIVisibilityCalculator({ scanData, mode, usageData, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [committers, setCommitters] = useModeState(mode, 'ci.committers', 50);
  const [pipelinesPerDay, setPipelinesPerDay] = useModeState(mode, 'ci.pipelinesPerDay', 200);
  const [testsPerPipeline, setTestsPerPipeline] = useModeState(mode, 'ci.testsPerPipeline', 500);
  const [avgPipelineDurationMin, setAvgPipelineDurationMin] = useModeState(mode, 'ci.avgPipelineDurationMin', 8);
  const [retentionDays, setRetentionDays] = useModeState(mode, 'ci.retentionDays', 30);
  const [growthRate, setGrowthRate] = useModeState(mode, 'ci.growthRate', 25);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'ci.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setCommitters(0); setPipelinesPerDay(0); setTestsPerPipeline(0); setAvgPipelineDurationMin(0);
    setRetentionDays(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const runsPerMonth = pipelinesPerDay * 30;
    const testRunsPerMonth = runsPerMonth * testsPerPipeline;
    const spanDataGbPerDay = (pipelinesPerDay * testsPerPipeline * 800) / 1e9; // ~800 bytes per test span
    const spanDataGbPerMonth = spanDataGbPerDay * 30;
    const retentionStorageGb = spanDataGbPerDay * retentionDays;
    const avgPipelineMinPerDay = pipelinesPerDay * avgPipelineDurationMin;
    const listPriceCost = committers * DD_PRICES.ciCommitter;
    return { runsPerMonth, testRunsPerMonth, spanDataGbPerDay, spanDataGbPerMonth, retentionStorageGb, avgPipelineMinPerDay, listPriceCost };
  }, [pipelinesPerDay, testsPerPipeline, avgPipelineDurationMin, retentionDays, committers]);

  const ciUsage = mode === 'current' ? sumUsageProducts(usageData, ['CI Pipeline Tests']) : null;

  useEffect(() => {
    if (mode === 'multi') return;
    const realCost = ciUsage ? ciUsage.committedCost + ciUsage.onDemandCost : undefined;
    reportCost({
      id: 'ci', label: 'CI Visibility', icon: '🔧', primaryMetric: `${fmtNum(committers)} committers`, listPriceCost: c.listPriceCost, realCost,
      skuLines: [{ sku: 'CI-PIPELINE-VIS', description: 'CI Pipeline Visibility', quantity: committers, unit: 'committers', rate: DD_PRICES.ciCommitter, amount: c.listPriceCost }],
    });
  }, [mode, committers, c.listPriceCost, ciUsage, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔧" title="CI Pipeline Visibility Calculator" description="Estimate pipeline run volume, test span data, and storage for CI Visibility and Test Optimization." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="CI Visibility Committers"
          growthRate={growthRate}
          usageUnit="committers"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['CI Pipeline Tests']);
            const usage = u?.value ?? (r.analytics ? Math.max(5, Math.round(r.analytics.apm.totalServices * 2)) : null);
            const cost = u ? u.committedCost + u.onDemandCost : (usage != null ? usage * DD_PRICES.ciCommitter : 0);
            return { orgName: r.org.name, orgId: r.org.id, usage, cost, costIsEstimate: !u };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="civisibility"
          onLoad={() => {
            if (scanData.apm.totalServices > 0) setCommitters(Math.max(5, Math.round(scanData.apm.totalServices * 2)));
          }}
          items={[
            { label: 'APM Services', actual: String(scanData.apm.totalServices), note: 'proxy for team size' },
            { label: 'Dev Team', actual: scanData.governance.userCount ? String(scanData.governance.userCount) : '—', note: 'DD users (includes non-devs)' },
          ]}
        />
      )}
      <PresetBar
        presets={CI_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = CI_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setCommitters(p.committers);
          setPipelinesPerDay(p.pipelinesPerDay);
          setTestsPerPipeline(p.testsPerPipeline);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">CI Configuration</h3>
          <SliderInput
            label="Active Committers" value={committers} min={1} max={10000} unit="developers" hint="Datadog CI Visibility is billed per committer per month" onChange={(v) => { setCommitters(v); setPresetId(null); }} log
            info="Anyone who pushed a commit in the billing period counts, not just full-time engineers — this is the primary cost driver, independent of pipeline volume."
          />
          <SliderInput label="Pipeline Runs per Day" value={pipelinesPerDay} min={1} max={100000} unit="runs/day" hint="Across all repos and branches (CI + CD pipelines)" onChange={(v) => { setPipelinesPerDay(v); setPresetId(null); }} log />
          <SliderInput label="Tests per Pipeline Run" value={testsPerPipeline} min={1} max={100000} unit="tests" hint="Unit + integration tests executed per run" onChange={(v) => { setTestsPerPipeline(v); setPresetId(null); }} log />
          <Advanced>
            <SliderInput label="Avg Pipeline Duration" value={avgPipelineDurationMin} min={1} max={240} unit="minutes" hint="Affects wall-clock data and span density" onChange={setAvgPipelineDurationMin} />
            <SliderInput label="Data Retention" value={retentionDays} min={7} max={365} unit="days" onChange={setRetentionDays} />
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Committers (billable)" value={fmtNum(committers)} sub="per month" color="violet" />
            <ResultCard label="Pipeline Runs / Month" value={fmtNum(c.runsPerMonth)} sub={`${pipelinesPerDay}/day × 30`} color="blue" />
            <ResultCard label="Test Runs / Month" value={fmtNum(c.testRunsPerMonth)} sub={`${testsPerPipeline} tests/run`} color="gray" />
            <ResultCard label="Span Data / Month" value={`${c.spanDataGbPerMonth.toFixed(1)} GB`} sub="~800 bytes/test span" color={c.spanDataGbPerMonth > 100 ? 'amber' : 'green'} />
          </div>
          <SizingBlock title="Data Volume" icon="📊" rows={[
            { label: 'Test spans / month', value: fmtNum(c.testRunsPerMonth), note: 'each test = 1 span' },
            { label: 'Span data / day', value: `${c.spanDataGbPerDay.toFixed(2)} GB` },
            { label: `Retention storage (${retentionDays}d)`, value: `${c.retentionStorageGb.toFixed(0)} GB` },
            { label: 'CI minutes / day', value: fmtNum(c.avgPipelineMinPerDay), note: 'wall-clock pipeline time' },
          ]} />
          <SizingBlock title="Key Billing Dimensions" icon="💰" rows={[
            { label: 'Pipeline Visibility', value: `$${DD_PRICES.ciCommitter}/committer/mo`, note: 'included in list price estimate above' },
            { label: 'Test Optimization add-on', value: '$20/committer/mo', note: `+$${(committers * 20).toLocaleString()}/mo if enabled — flaky test detection, AI recommendations` },
            { label: 'Data retention', value: `${retentionDays}d`, note: 'pipeline + test trace retention' },
            { label: 'Private locations', value: 'included', note: 'on-prem CI agents supported' },
          ]} />
        </div>
      </div>
      {mode === 'current' && ciUsage && (
        <CostSavingsCard
          label="CI Visibility Committers"
          usageValue={ciUsage.value}
          usageUnit="committers"
          committedCost={ciUsage.committedCost}
          onDemandCost={ciUsage.onDemandCost}
          listPriceCost={c.listPriceCost}
        />
      )}

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Committers', baseline: committers, unit: '' },
        { label: 'Pipeline Runs / Month', baseline: c.runsPerMonth, unit: '' },
        { label: 'Test Runs / Month', baseline: c.testRunsPerMonth, unit: '' },
        { label: 'Span Data / Month', baseline: c.spanDataGbPerMonth, unit: 'GB', formatter: (n) => n.toFixed(1) },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Continuous Profiler ──────────────────────────────────────────────────────

const PROFILER_PRESETS = [
  { id: 'small', label: 'Pilot', sub: '~10 hosts', profiledHosts: 10 },
  { id: 'mid', label: 'Growth', sub: '~50 hosts', profiledHosts: 50 },
  { id: 'large', label: 'Mid-Market', sub: '~500 hosts', profiledHosts: 500 },
  { id: 'enterprise', label: 'Enterprise', sub: '5,000+ hosts', profiledHosts: 5000 },
];

function ProfilerCalculator({ scanData, mode, usageData, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [profiledHosts, setProfiledHosts] = useModeState(mode, 'profiler.profiledHosts', 50);
  const [profilesPerHostPerHour, setProfilesPerHostPerHour] = useModeState(mode, 'profiler.profilesPerHostPerHour', 6);
  const [avgProfileSizeMb, setAvgProfileSizeMb] = useModeState(mode, 'profiler.avgProfileSizeMb', 0.5);
  const [retentionDays, setRetentionDays] = useModeState(mode, 'profiler.retentionDays', 30);
  const [growthRate, setGrowthRate] = useModeState(mode, 'profiler.growthRate', 20);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'profiler.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setProfiledHosts(0); setProfilesPerHostPerHour(0); setAvgProfileSizeMb(0);
    setRetentionDays(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const profilesPerDay = profiledHosts * profilesPerHostPerHour * 24;
    const profilesPerMonth = profilesPerDay * 30;
    const storageGbPerDay = (profilesPerDay * avgProfileSizeMb) / 1024;
    const retentionStorageGb = storageGbPerDay * retentionDays;
    const agentOverheadPctCpu = 1.5;
    const agentOverheadMb = 120;
    const listPriceCost = profiledHosts * DD_PRICES.profilerHost;
    return { profilesPerDay, profilesPerMonth, storageGbPerDay, retentionStorageGb, agentOverheadPctCpu, agentOverheadMb, listPriceCost };
  }, [profiledHosts, profilesPerHostPerHour, avgProfileSizeMb, retentionDays]);

  const profilerUsage = mode === 'current' ? sumUsageProducts(usageData, ['Profiling Hosts']) : null;

  useEffect(() => {
    if (mode === 'multi') return;
    const realCost = profilerUsage ? profilerUsage.committedCost + profilerUsage.onDemandCost : undefined;
    reportCost({
      id: 'profiler', label: 'Continuous Profiler', icon: '⚡', primaryMetric: `${fmtNum(profiledHosts)} hosts`, listPriceCost: c.listPriceCost, realCost,
      skuLines: [{ sku: 'PROFILER-HOST', description: 'Continuous Profiler', quantity: profiledHosts, unit: 'hosts', rate: DD_PRICES.profilerHost, amount: c.listPriceCost }],
    });
  }, [mode, profiledHosts, c.listPriceCost, profilerUsage, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="⚡" title="Continuous Profiler Calculator" description="Estimate profiling data volume and storage for always-on CPU, memory, and lock profiling across your fleet." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Profiling Hosts"
          growthRate={growthRate}
          usageUnit="hosts"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['Profiling Hosts']);
            const usage = u?.value ?? (r.analytics ? Math.round(r.analytics.infrastructure.totalHosts * 0.5) : null);
            const cost = u ? u.committedCost + u.onDemandCost : (usage != null ? usage * DD_PRICES.profilerHost : 0);
            return { orgName: r.org.name, orgId: r.org.id, usage, cost, costIsEstimate: !u };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="profiler"
          onLoad={() => setProfiledHosts(Math.max(1, Math.round(scanData.infrastructure.totalHosts * 0.5)))}
          items={[
            { label: 'Total Hosts', actual: String(scanData.infrastructure.totalHosts), note: 'eligible for profiling' },
            { label: 'APM Services', actual: String(scanData.apm.totalServices), note: 'services to profile' },
            { label: 'Recommended coverage', actual: `${Math.round(scanData.infrastructure.totalHosts * 0.5)}`, note: 'start with 50% of hosts' },
          ]}
        />
      )}
      <PresetBar
        presets={PROFILER_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = PROFILER_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setProfiledHosts(p.profiledHosts);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Profiler Configuration</h3>
          <SliderInput
            label="Profiled Hosts / Containers" value={profiledHosts} min={1} max={50000} unit="hosts" hint="Continuous Profiler billed per profiled host/container per hour" onChange={(v) => { setProfiledHosts(v); setPresetId(null); }} log
            info="Most teams start by profiling a subset (e.g. 50% of hosts running the heaviest services) rather than the whole fleet, then expand coverage."
          />
          <Advanced>
            <SliderInput label="Profiles per Host per Hour" value={profilesPerHostPerHour} min={1} max={60} unit="profiles/hr" hint="Default: 1 profile/min per language (6/hr). CPU + memory = 2×." onChange={setProfilesPerHostPerHour} />
            <SliderInput label="Avg Profile Size" value={avgProfileSizeMb} min={0.1} max={10} step={0.1} unit="MB" hint="Flame graph data. JVM heaps are larger (~2-5MB)." onChange={setAvgProfileSizeMb} />
            <SliderInput label="Retention" value={retentionDays} min={1} max={365} unit="days" hint="Standard: 30 days. Extended retention available." onChange={setRetentionDays} />
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Profiled Hosts" value={fmtNum(profiledHosts)} sub="billed per profiled host" color="violet" />
            <ResultCard label="Profiles / Day" value={fmtNum(c.profilesPerDay)} sub={`${profilesPerHostPerHour}/hr × 24h`} color="blue" />
            <ResultCard label="Storage / Day" value={`${c.storageGbPerDay.toFixed(1)} GB`} sub="flame graph data" color="gray" />
            <ResultCard label={`Retention (${retentionDays}d)`} value={`${c.retentionStorageGb.toFixed(0)} GB`} sub="total storage" color={c.retentionStorageGb > 500 ? 'amber' : 'green'} />
          </div>
          <SizingBlock title="Agent Overhead (per host)" icon="⚙" rows={[
            { label: 'CPU overhead', value: `~${c.agentOverheadPctCpu}%`, note: 'per profiled language runtime' },
            { label: 'Memory overhead', value: `~${c.agentOverheadMb}MB`, note: 'profiler agent per runtime' },
            { label: 'Total fleet CPU', value: `${(profiledHosts * c.agentOverheadPctCpu / 100).toFixed(1)} cores`, note: 'overhead at 1-core hosts' },
            { label: 'Network egress/day', value: `${c.storageGbPerDay.toFixed(1)} GB`, note: 'profile data to Datadog' },
          ]} />
          <SizingBlock title="What Gets Profiled" icon="🔬" rows={[
            { label: 'CPU', value: 'always-on', note: 'call tree, hot functions' },
            { label: 'Heap memory', value: 'always-on', note: 'allocation sites, live objects' },
            { label: 'Lock contention', value: 'Java/Go/Python', note: 'mutex wait time' },
            { label: 'Exceptions', value: 'Java/.NET', note: 'exception frequency' },
          ]} />
        </div>
      </div>
      {mode === 'current' && profilerUsage && (
        <CostSavingsCard
          label="Profiling Hosts"
          usageValue={profilerUsage.value}
          usageUnit="hosts"
          committedCost={profilerUsage.committedCost}
          onDemandCost={profilerUsage.onDemandCost}
          listPriceCost={c.listPriceCost}
        />
      )}

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Profiled Hosts', baseline: profiledHosts, unit: '' },
        { label: 'Profiles / Month', baseline: c.profilesPerMonth, unit: '' },
        { label: 'Storage / Month', baseline: c.storageGbPerDay * 30, unit: 'GB', formatter: (n) => n.toFixed(0) },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Observability Pipelines (OPW) ────────────────────────────────────────────

const OPW_PRESETS = [
  { id: 'small', label: 'Small pipeline', sub: '~20 GB/day', dailyIngestGb: 20, transformationComplexity: 'low' },
  { id: 'mid', label: 'Growth', sub: '~100 GB/day', dailyIngestGb: 100, transformationComplexity: 'medium' },
  { id: 'large', label: 'Large pipeline', sub: '~2,000 GB/day', dailyIngestGb: 2000, transformationComplexity: 'medium' },
  { id: 'enterprise', label: 'Enterprise', sub: '20,000+ GB/day', dailyIngestGb: 20000, transformationComplexity: 'high' },
];

function OPWCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [dailyIngestGb, setDailyIngestGb] = useModeState(mode, 'opw.dailyIngestGb', 100);
  const [filterDropPct, setFilterDropPct] = useModeState(mode, 'opw.filterDropPct', 40);
  const [routeToMultipleDest, setRouteToMultipleDest] = useModeState(mode, 'opw.routeToMultipleDest', 2);
  const [transformationComplexity, setTransformationComplexity] = useModeState(mode, 'opw.transformationComplexity', 'medium');
  const [growthRate, setGrowthRate] = useModeState(mode, 'opw.growthRate', 30);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'opw.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setDailyIngestGb(0); setFilterDropPct(0); setRouteToMultipleDest(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const complexity = transformationComplexity === 'low' ? 1 : transformationComplexity === 'medium' ? 1.5 : 2.5;
    const outboundGb = dailyIngestGb * (1 - filterDropPct / 100) * routeToMultipleDest;
    const gbThroughOPW = dailyIngestGb * complexity;
    const savingsGbPerDay = dailyIngestGb - (dailyIngestGb * (1 - filterDropPct / 100));
    const savingsPct = filterDropPct;
    // Workers sizing: 1 worker handles ~10 GB/hr = 240 GB/day at medium complexity
    const gbPerWorkerPerDay = 240 / complexity;
    const workersNeeded = Math.max(1, Math.ceil(gbThroughOPW / gbPerWorkerPerDay));
    const workerCpuCores = workersNeeded * 2;
    const workerMemGb = workersNeeded * 4;
    const listPriceCost = gbThroughOPW * 30 * DD_PRICES.opwGb;
    return { outboundGb, gbThroughOPW, savingsGbPerDay, savingsPct, workersNeeded, workerCpuCores, workerMemGb, listPriceCost };
  }, [dailyIngestGb, filterDropPct, routeToMultipleDest, transformationComplexity]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'opw', label: 'Obs. Pipelines', icon: '🔀', primaryMetric: `${dailyIngestGb} GB/day`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'OPW-GB', description: 'Observability Pipelines (processed)', quantity: c.gbThroughOPW * 30, unit: 'GB/mo', rate: DD_PRICES.opwGb, amount: c.listPriceCost }],
    });
  }, [mode, dailyIngestGb, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔀" title="Observability Pipelines (OPW)" description="Size OPW workers for log routing, filtering, and transformation. Compare inbound vs outbound data costs." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="OPW Volume (proxy: log ingestion)"
          growthRate={growthRate}
          usageUnit="GB/mo"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['Log Ingestion']);
            const usageGb = u?.value != null ? (u.value / 1e9) * 30 : null;
            const cost = usageGb != null ? usageGb * DD_PRICES.opwGb : 0;
            return { orgName: r.org.name, orgId: r.org.id, usage: usageGb, cost, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="opw"
          onLoad={() => {
            const estimatedGbDay = scanData.logs.totalDailyLimitEvents > 0
              ? (scanData.logs.totalDailyLimitEvents * 2000) / 1e9
              : Math.max(1, scanData.logs.totalIndexes * 10);
            setDailyIngestGb(Math.round(estimatedGbDay));
            setPresetId(null);
          }}
          items={[
            { label: 'Log Indexes', actual: String(scanData.logs.totalIndexes), note: 'potential OPW destinations' },
            { label: 'Pipelines', actual: String(scanData.logs.pipelines), note: 'existing DD pipelines' },
            { label: 'Excl. Filters', actual: String(scanData.logs.totalExclusionFilters), note: 'current filtering in place' },
            { label: 'Rate Limited', actual: String(scanData.logs.rateLimitedCount), note: scanData.logs.rateLimitedCount > 0 ? 'OPW can help cap' : 'none' },
          ]}
        />
      )}
      <PresetBar
        presets={OPW_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = OPW_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setDailyIngestGb(p.dailyIngestGb);
          setTransformationComplexity(p.transformationComplexity);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Pipeline Configuration</h3>
          <SliderInput label="Daily Inbound Volume" value={dailyIngestGb} min={1} max={50000} unit="GB / day" hint="Total log/metric/trace data entering OPW" onChange={(v) => { setDailyIngestGb(v); setPresetId(null); }} log />
          <SliderInput
            label="Filter / Drop Rate" value={filterDropPct} min={0} max={90} unit="% dropped" hint="Events dropped by OPW filters before forwarding" onChange={setFilterDropPct}
            info="Data dropped here never reaches Datadog indexing — this is the main cost-saving lever OPW provides over sending everything raw."
          />
          <SliderInput label="Fan-out Destinations" value={routeToMultipleDest} min={1} max={10} unit="destinations" hint="Same data routed to multiple sinks (SIEM, S3, Datadog)" onChange={setRouteToMultipleDest} />
          <SelectInput
            label="Transformation Complexity"
            value={transformationComplexity}
            onChange={(v) => { setTransformationComplexity(v); setPresetId(null); }}
            options={[
              { value: 'low', label: 'Low — filter-only, no enrichment' },
              { value: 'medium', label: 'Medium — parse + remap fields' },
              { value: 'high', label: 'High — regex, Lua, geo enrichment' },
            ]}
            hint="Affects worker CPU needs and throughput"
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Inbound / Day" value={`${dailyIngestGb} GB`} sub="entering OPW" color="gray" />
            <ResultCard label="Filtered Out / Day" value={`${c.savingsGbPerDay.toFixed(0)} GB`} sub={`${filterDropPct}% dropped`} color="green" />
            <ResultCard label="Outbound / Day" value={`${c.outboundGb.toFixed(0)} GB`} sub={`${routeToMultipleDest} destinations`} color="blue" />
            <ResultCard label="Workers Needed" value={String(c.workersNeeded)} sub={`at ${transformationComplexity} complexity`} color="violet" />
          </div>
          <SizingBlock title="Worker Sizing (K8s / VM)" icon="☸" rows={[
            { label: 'OPW workers needed', value: String(c.workersNeeded), note: 'recommend +1 for HA' },
            { label: 'CPU per worker', value: '2 vCPU', note: 'request; limit 4 vCPU' },
            { label: 'Memory per worker', value: '4 GB', note: 'request; limit 8 GB' },
            { label: 'Total fleet CPU', value: `${c.workerCpuCores} vCPU` },
            { label: 'Total fleet memory', value: `${c.workerMemGb} GB` },
          ]} />
          <SizingBlock title="Cost Impact" icon="💰" rows={[
            { label: 'Data dropped before DD ingest', value: `${c.savingsGbPerDay.toFixed(0)} GB/day`, note: `${filterDropPct}% reduction in indexing` },
            { label: 'OPW billing unit', value: 'per GB processed', note: 'inbound to OPW, not outbound' },
            { label: 'Fan-out overhead', value: `${routeToMultipleDest}× outbound vs inbound`, note: 'each destination gets full copy' },
            { label: 'Monthly inbound', value: `${(dailyIngestGb * 30).toFixed(0)} GB/mo` },
          ]} />
        </div>
      </div>
      <SizingBlock title="List Price Estimate" icon="💰" rows={[
        { label: 'GB processed / month', value: fmtNum(c.gbThroughOPW * 30), note: `$${DD_PRICES.opwGb}/GB processed list price` },
        { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for OPW yet' },
      ]} />

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Inbound / Day', baseline: dailyIngestGb, unit: 'GB/day' },
        { label: 'Outbound / Day', baseline: c.outboundGb, unit: 'GB/day', formatter: (n) => n.toFixed(0) },
        { label: 'Workers', baseline: c.workersNeeded, unit: '' },
        { label: 'Monthly Inbound', baseline: dailyIngestGb * 30, unit: 'GB/mo' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Application Security (ASM) ───────────────────────────────────────────────

const ASM_PRESETS = [
  { id: 'small', label: 'Small app', sub: '~5 services', protectedServices: 5, requestsPerSec: 100 },
  { id: 'mid', label: 'Growth', sub: '~20 services', protectedServices: 20, requestsPerSec: 1000 },
  { id: 'large', label: 'Large platform', sub: '~150 services', protectedServices: 150, requestsPerSec: 10000 },
  { id: 'enterprise', label: 'Enterprise', sub: '1,000+ services', protectedServices: 1000, requestsPerSec: 50000 },
];

function ASMCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [protectedServices, setProtectedServices] = useModeState(mode, 'asm.protectedServices', 20);
  const [requestsPerSec, setRequestsPerSec] = useModeState(mode, 'asm.requestsPerSec', 1000);
  const [threatEventPct, setThreatEventPct] = useModeState(mode, 'asm.threatEventPct', 0.1);
  const [apiSecurityEnabled, setApiSecurityEnabled] = useModeState(mode, 'asm.apiSecurityEnabled', false);
  const [scaEnabled, setScaEnabled] = useModeState(mode, 'asm.scaEnabled', false);
  const [growthRate, setGrowthRate] = useModeState(mode, 'asm.growthRate', 20);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'asm.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setProtectedServices(0); setRequestsPerSec(0); setThreatEventPct(0);
    setApiSecurityEnabled(false); setScaEnabled(false); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const requestsPerMonth = requestsPerSec * 86400 * 30;
    const threatEventsPerMonth = requestsPerMonth * (threatEventPct / 100);
    // API Security: samples 1% of requests for schema analysis
    const apiSchemaSamplesPerMonth = apiSecurityEnabled ? requestsPerMonth * 0.01 : 0;
    // IAST: code-level tracing overhead on tests
    const iastOverheadPct = 5; // ~5% CPU overhead for IAST
    const listPriceCost = protectedServices * DD_PRICES.asmHost;
    return { requestsPerMonth, threatEventsPerMonth, apiSchemaSamplesPerMonth, iastOverheadPct, listPriceCost };
  }, [protectedServices, requestsPerSec, threatEventPct, apiSecurityEnabled]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'asm', label: 'App Security', icon: '🔒', primaryMetric: `${fmtNum(protectedServices)} services`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'ASM-THREAT-HOST', description: 'ASM Threat Management', quantity: protectedServices, unit: 'hosts', rate: DD_PRICES.asmHost, amount: c.listPriceCost }],
    });
  }, [mode, protectedServices, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔒" title="Application Security (ASM) Calculator" description="Estimate threat detection event volumes, API security schema samples, and SCA coverage for your services." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="ASM Protected Services (proxy)"
          growthRate={growthRate}
          usageUnit="services"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const usage = r.analytics?.apm.totalServices ?? null;
            return { orgName: r.org.name, orgId: r.org.id, usage, cost: usage != null ? usage * DD_PRICES.asmHost : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="asm"
          onLoad={() => setProtectedServices(Math.max(1, scanData.apm.totalServices))}
          items={[
            { label: 'APM Services', actual: String(scanData.apm.totalServices), note: 'eligible for ASM' },
            { label: 'With Monitor', actual: String(scanData.apm.svcWithMonitor), note: 'already have alerting' },
            { label: 'In Catalog', actual: String(scanData.apm.svcInCatalog), note: 'have ownership defined' },
            { label: 'Total Hosts', actual: String(scanData.infrastructure.totalHosts), note: 'billed per host for ASM' },
          ]}
        />
      )}
      <PresetBar
        presets={ASM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = ASM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setProtectedServices(p.protectedServices);
          setRequestsPerSec(p.requestsPerSec);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">ASM Configuration</h3>
          <SliderInput label="Protected Services" value={protectedServices} min={1} max={10000} unit="services" hint="ASM is billed per host/container running ASM-enabled services" onChange={(v) => { setProtectedServices(v); setPresetId(null); }} log />
          <SliderInput label="Requests per Second (total)" value={requestsPerSec} min={1} max={1000000} unit="req/s" hint="Total HTTP/gRPC requests across all protected services" onChange={(v) => { setRequestsPerSec(v); setPresetId(null); }} log />
          <SliderInput
            label="Threat Event Rate" value={threatEventPct} min={0.001} max={10} step={0.001} unit="% of requests" hint="Requests flagged as attacks (SQL injection, XSS, SSRF…). Typical: 0.01–1%." onChange={setThreatEventPct}
            info="This doesn't drive ASM cost (which is billed per host) — it only affects how many threat events you'll need to triage."
          />
          <Advanced label="Add-ons & growth">
            <div className="space-y-3">
              <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Add-ons</div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="apisec" checked={apiSecurityEnabled} onChange={(e) => setApiSecurityEnabled(e.target.checked)} className="accent-violet-600" />
                <label htmlFor="apisec" className="text-sm text-ink-muted">API Security (schema discovery + endpoint inventory)</label>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="sca" checked={scaEnabled} onChange={(e) => setScaEnabled(e.target.checked)} className="accent-violet-600" />
                <label htmlFor="sca" className="text-sm text-ink-muted">Software Composition Analysis (SCA / OSS vulnerabilities)</label>
              </div>
            </div>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Protected Services" value={fmtNum(protectedServices)} sub="ASM-enabled" color="violet" />
            <ResultCard label="Requests / Month" value={fmtNum(c.requestsPerMonth)} sub={`${fmtNum(requestsPerSec)} req/s`} color="blue" />
            <ResultCard label="Threat Events / Month" value={fmtNum(c.threatEventsPerMonth)} sub={`${threatEventPct}% flagged`} color={c.threatEventsPerMonth > 1e6 ? 'amber' : 'gray'} />
            {apiSecurityEnabled && (
              <ResultCard label="API Schema Samples / Mo" value={fmtNum(c.apiSchemaSamplesPerMonth)} sub="1% of requests sampled" color="blue" />
            )}
          </div>
          <SizingBlock title="Billing Dimensions" icon="💰" rows={[
            { label: 'ASM billing unit', value: 'per host/container', note: 'same unit as infrastructure' },
            { label: 'Threat Management', value: 'included in ASM', note: 'WAF + RASP + exploit blocking' },
            { label: 'API Security', value: 'add-on', note: `${apiSecurityEnabled ? 'enabled' : 'not enabled'} — schema + risk scoring` },
            { label: 'SCA', value: 'add-on', note: `${scaEnabled ? 'enabled' : 'not enabled'} — OSS CVE tracking` },
            { label: 'Code Security (IAST)', value: 'add-on', note: `~${c.iastOverheadPct}% CPU overhead in test envs` },
          ]} />
          <SizingBlock title="Coverage Assessment" icon="🛡" rows={[
            { label: 'Services protected', value: fmtNum(protectedServices) },
            { label: 'Services without ASM', value: scanData ? fmtNum(Math.max(0, scanData.apm.totalServices - protectedServices)) : '—', note: 'gap from current scan' },
            { label: 'Threat detection latency', value: '< 1ms', note: 'in-process WAF, no proxy' },
            { label: 'Custom WAF rules', value: 'unlimited', note: 'Rego-based detection logic' },
          ]} />
        </div>
      </div>
      <SizingBlock title="List Price Estimate" icon="💰" rows={[
        { label: 'Protected services (host proxy)', value: fmtNum(protectedServices), note: `$${DD_PRICES.asmHost}/host/mo list price` },
        { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for ASM yet' },
      ]} />

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Protected Services', baseline: protectedServices, unit: '' },
        { label: 'Requests / Month', baseline: c.requestsPerMonth, unit: '' },
        { label: 'Threat Events / Month', baseline: c.threatEventsPerMonth, unit: '' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Serverless Monitoring ────────────────────────────────────────────────────

const SERVERLESS_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~20 fns', lambdaFunctions: 20, fargateTasks: 5 },
  { id: 'mid', label: 'Growing org', sub: '~100 fns', lambdaFunctions: 100, fargateTasks: 30 },
  { id: 'large', label: 'Large org', sub: '~500 fns', lambdaFunctions: 500, fargateTasks: 150 },
  { id: 'enterprise', label: 'Enterprise', sub: '3,000+ fns', lambdaFunctions: 3000, fargateTasks: 800 },
];

function ServerlessCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [lambdaFunctions, setLambdaFunctions] = useState(100);
  const [fargateTasks, setFargateTasks] = useState(30);
  const [growthRate, setGrowthRate] = useState(30);
  const [presetId, setPresetId] = useState<string | null>('mid');

  const c = useMemo(() => {
    const listPriceCost = lambdaFunctions * DD_PRICES.serverlessFunction + fargateTasks * DD_PRICES.fargateTask;
    return { listPriceCost, totalUnits: lambdaFunctions + fargateTasks };
  }, [lambdaFunctions, fargateTasks]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'serverless', label: 'Serverless', icon: '⚡', primaryMetric: `${fmtNum(c.totalUnits)} fns/tasks`, listPriceCost: c.listPriceCost,
      skuLines: [
        { sku: 'SERVERLESS-FN', description: 'Serverless Functions (Lambda/Cloud Functions/Azure Functions)', quantity: lambdaFunctions, unit: 'functions', rate: DD_PRICES.serverlessFunction, amount: lambdaFunctions * DD_PRICES.serverlessFunction },
        { sku: 'SERVERLESS-TASK', description: 'Serverless Tasks (Fargate/Cloud Run)', quantity: fargateTasks, unit: 'tasks', rate: DD_PRICES.fargateTask, amount: fargateTasks * DD_PRICES.fargateTask },
      ],
    });
  }, [mode, c.totalUnits, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="⚡" title="Serverless Monitoring" description="Size Lambda functions and Fargate/ECS/EKS tasks under Datadog Serverless Monitoring." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Serverless (proxy: cloud accounts)"
          growthRate={growthRate}
          usageUnit="fns/tasks"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const accounts = r.analytics?.infrastructure.cloudAccounts.reduce((s, a) => s + a.n, 0) ?? null;
            const est = accounts != null ? accounts * 15 : null;
            return { orgName: r.org.name, orgId: r.org.id, usage: est, cost: est != null ? est * DD_PRICES.serverlessFunction : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="serverless"
          onLoad={() => {
            const accounts = scanData.infrastructure.cloudAccounts.reduce((s, a) => s + a.n, 0);
            setLambdaFunctions(Math.max(10, accounts * 15));
            setFargateTasks(Math.max(2, accounts * 4));
            setPresetId(null);
          }}
          items={[
            { label: 'Cloud Accounts', actual: String(scanData.infrastructure.cloudAccounts.length), note: 'potential serverless sources' },
            { label: 'Total Hosts', actual: fmtNum(scanData.infrastructure.totalHosts), note: 'for scale context' },
          ]}
        />
      )}
      <PresetBar
        presets={SERVERLESS_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = SERVERLESS_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setLambdaFunctions(p.lambdaFunctions);
          setFargateTasks(p.fargateTasks);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Fleet Configuration</h3>
          <SliderInput
            label="Lambda Functions" value={lambdaFunctions} min={0} max={20000} unit="functions" log
            onChange={(v) => { setLambdaFunctions(v); setPresetId(null); }}
            info="Every AWS Lambda function monitored via the Datadog Lambda extension/layer, including Azure Functions and Cloud Run equivalents."
          />
          <SliderInput
            label="Fargate / ECS / EKS Tasks" value={fargateTasks} min={0} max={5000} unit="tasks" log
            onChange={(v) => { setFargateTasks(v); setPresetId(null); }}
            info="Running task count, not task definitions — billed per running task."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Lambda Functions" value={fmtNum(lambdaFunctions)} sub={`$${DD_PRICES.serverlessFunction}/function/mo`} color="violet" />
            <ResultCard label="Fargate Tasks" value={fmtNum(fargateTasks)} sub={`$${DD_PRICES.fargateTask}/task/mo`} color="blue" />
          </div>
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Lambda functions', value: fmtNum(lambdaFunctions), note: `$${DD_PRICES.serverlessFunction}/function/mo list price` },
            { label: 'Fargate/ECS/EKS tasks', value: fmtNum(fargateTasks), note: `$${DD_PRICES.fargateTask}/task/mo list price` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for Serverless yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Lambda Functions', baseline: lambdaFunctions, unit: '' },
        { label: 'Fargate Tasks', baseline: fargateTasks, unit: '' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Cloud Cost Management ────────────────────────────────────────────────────

const CCM_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~$10K/mo cloud spend', cloudSpend: 10000 },
  { id: 'mid', label: 'Growing org', sub: '~$100K/mo', cloudSpend: 100000 },
  { id: 'large', label: 'Large org', sub: '~$1M/mo', cloudSpend: 1000000 },
  { id: 'enterprise', label: 'Enterprise', sub: '$5M+/mo', cloudSpend: 5000000 },
];

function CCMCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [cloudSpend, setCloudSpend] = useState(100000);
  const [growthRate, setGrowthRate] = useState(20);
  const [presetId, setPresetId] = useState<string | null>('mid');

  const c = useMemo(() => ({ listPriceCost: cloudSpend * DD_PRICES.ccmPctOfSpend }), [cloudSpend]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'ccm', label: 'Cloud Cost Mgmt', icon: '💵', primaryMetric: `$${fmtNum(cloudSpend)}/mo spend`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'CCM-PCT-SPEND', description: 'Cloud Cost Management', quantity: cloudSpend, unit: '$ managed spend/mo', rate: DD_PRICES.ccmPctOfSpend, amount: c.listPriceCost }],
    });
  }, [mode, cloudSpend, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="💵" title="Cloud Cost Management" description="Estimate CCM cost as a percentage of the cloud spend it manages and optimizes." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="CCM (manual input — no usage proxy)"
          growthRate={growthRate}
          usageUnit="$/mo spend"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => ({ orgName: r.org.name, orgId: r.org.id, usage: null, cost: 0, costIsEstimate: true }))}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="ccm"
          onLoad={() => setPresetId(null)}
          items={[
            { label: 'Cloud Accounts', actual: String(scanData.infrastructure.cloudAccounts.length), note: 'CCM has no spend-amount signal in scan data — enter manually' },
          ]}
        />
      )}
      <PresetBar
        presets={CCM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = CCM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setCloudSpend(p.cloudSpend);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Managed Spend</h3>
          <SliderInput
            label="Managed Cloud Spend" value={cloudSpend} min={1000} max={20000000} unit="$ / mo" log
            onChange={(v) => { setCloudSpend(v); setPresetId(null); }}
            info="Total AWS/GCP/Azure spend CCM ingests and analyzes across connected cloud accounts."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <ResultCard label="Managed Spend" value={`$${fmtNum(cloudSpend)}/mo`} sub={`${(DD_PRICES.ccmPctOfSpend * 100).toFixed(1)}% list rate`} color="violet" />
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Managed cloud spend', value: `$${fmtNum(cloudSpend)}/mo` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for CCM yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Managed Spend', baseline: cloudSpend, unit: '$/mo' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Cloud SIEM ────────────────────────────────────────────────────────────────

const SIEM_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~5 GB/day', analyzedGbDay: 5 },
  { id: 'mid', label: 'Growing org', sub: '~50 GB/day', analyzedGbDay: 50 },
  { id: 'large', label: 'Large org', sub: '~500 GB/day', analyzedGbDay: 500 },
  { id: 'enterprise', label: 'Enterprise', sub: '5,000+ GB/day', analyzedGbDay: 5000 },
];

function CloudSIEMCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [analyzedGbDay, setAnalyzedGbDay] = useState(50);
  const [growthRate, setGrowthRate] = useState(30);
  const [presetId, setPresetId] = useState<string | null>('mid');

  const c = useMemo(() => ({ listPriceCost: analyzedGbDay * 30 * DD_PRICES.cloudSiemGb }), [analyzedGbDay]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'cloud-siem', label: 'Cloud SIEM', icon: '🛰', primaryMetric: `${analyzedGbDay} GB/day analyzed`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'CLOUD-SIEM-GB', description: 'Cloud SIEM (analyzed events)', quantity: analyzedGbDay * 30, unit: 'GB/mo', rate: DD_PRICES.cloudSiemGb, amount: c.listPriceCost }],
    });
  }, [mode, analyzedGbDay, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🛰" title="Cloud SIEM" description="Estimate Cloud SIEM cost from the volume of logs run through detection rules — a distinct SKU from log indexing." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Cloud SIEM (proxy: log ingestion)"
          growthRate={growthRate}
          usageUnit="GB/mo"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['Log Ingestion']);
            const usageGb = u?.value != null ? (u.value / 1e9) * 30 : null;
            return { orgName: r.org.name, orgId: r.org.id, usage: usageGb, cost: usageGb != null ? usageGb * DD_PRICES.cloudSiemGb : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="cloudsiem"
          onLoad={() => {
            setAnalyzedGbDay(Math.max(1, scanData.logs.totalIndexes * 5));
            setPresetId(null);
          }}
          items={[
            { label: 'Log Indexes', actual: String(scanData.logs.totalIndexes), note: 'potential detection rule sources' },
          ]}
        />
      )}
      <PresetBar
        presets={SIEM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = SIEM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setAnalyzedGbDay(p.analyzedGbDay);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Detection Volume</h3>
          <SliderInput
            label="Analyzed Log Volume" value={analyzedGbDay} min={1} max={50000} unit="GB / day" log
            onChange={(v) => { setAnalyzedGbDay(v); setPresetId(null); }}
            info="Logs run through Cloud SIEM detection rules. Billed separately from Log Management indexing."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <ResultCard label="Analyzed / Day" value={`${analyzedGbDay} GB`} sub={`$${DD_PRICES.cloudSiemGb}/GB list rate`} color="violet" />
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Analyzed volume / month', value: `${fmtNum(analyzedGbDay * 30)} GB` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for Cloud SIEM yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Analyzed / Day', baseline: analyzedGbDay, unit: 'GB/day' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Sensitive Data Scanner ────────────────────────────────────────────────────

const SDS_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~5 GB/day', scannedGbDay: 5 },
  { id: 'mid', label: 'Growing org', sub: '~50 GB/day', scannedGbDay: 50 },
  { id: 'large', label: 'Large org', sub: '~1,000 GB/day', scannedGbDay: 1000 },
  { id: 'enterprise', label: 'Enterprise', sub: '10,000+ GB/day', scannedGbDay: 10000 },
];

function SDSCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [scannedGbDay, setScannedGbDay] = useState(50);
  const [growthRate, setGrowthRate] = useState(30);
  const [presetId, setPresetId] = useState<string | null>('mid');

  const c = useMemo(() => ({ listPriceCost: scannedGbDay * 30 * DD_PRICES.sdsScannedGb }), [scannedGbDay]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'sds', label: 'Sensitive Data Scanner', icon: '🕵', primaryMetric: `${scannedGbDay} GB/day scanned`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'SDS-GB', description: 'Sensitive Data Scanner', quantity: scannedGbDay * 30, unit: 'GB/mo', rate: DD_PRICES.sdsScannedGb, amount: c.listPriceCost }],
    });
  }, [mode, scannedGbDay, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🕵" title="Sensitive Data Scanner" description="Estimate SDS cost from the volume of logs (or other data) scanned for PII/PCI/secrets." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Sensitive Data Scanner (proxy: log ingestion)"
          growthRate={growthRate}
          usageUnit="GB/mo"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const u = sumUsageProducts(r.usage, ['Log Ingestion']);
            const usageGb = u?.value != null ? (u.value / 1e9) * 30 : null;
            return { orgName: r.org.name, orgId: r.org.id, usage: usageGb, cost: usageGb != null ? usageGb * DD_PRICES.sdsScannedGb : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="sds"
          onLoad={() => {
            setScannedGbDay(Math.max(1, scanData.logs.totalIndexes * 10));
            setPresetId(null);
          }}
          items={[
            { label: 'Log Indexes', actual: String(scanData.logs.totalIndexes), note: 'potential scan sources' },
          ]}
        />
      )}
      <PresetBar
        presets={SDS_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = SDS_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setScannedGbDay(p.scannedGbDay);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Scan Volume</h3>
          <SliderInput
            label="Scanned Data Volume" value={scannedGbDay} min={1} max={20000} unit="GB / day" log
            onChange={(v) => { setScannedGbDay(v); setPresetId(null); }}
            info="Volume of logs (or other supported data) run through Sensitive Data Scanner rules."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <ResultCard label="Scanned / Day" value={`${scannedGbDay} GB`} sub={`$${DD_PRICES.sdsScannedGb}/GB list rate`} color="violet" />
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Scanned volume / month', value: `${fmtNum(scannedGbDay * 30)} GB` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for SDS yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Scanned / Day', baseline: scannedGbDay, unit: 'GB/day' },
      ]} />
      </>
      )}
    </div>
  );
}

// ─── Universal Service Monitoring ──────────────────────────────────────────────

const USM_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~10 hosts', hosts: 10 },
  { id: 'mid', label: 'Growing org', sub: '~100 hosts', hosts: 100 },
  { id: 'large', label: 'Large org', sub: '~500 hosts', hosts: 500 },
  { id: 'enterprise', label: 'Enterprise', sub: '2,000+ hosts', hosts: 2000 },
];

function USMCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [hosts, setHosts] = useState(100);
  const [growthRate, setGrowthRate] = useState(20);
  const [presetId, setPresetId] = useState<string | null>('mid');

  const c = useMemo(() => ({ listPriceCost: hosts * DD_PRICES.usmHost }), [hosts]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'usm', label: 'Universal Service Mon.', icon: '🧭', primaryMetric: `${fmtNum(hosts)} hosts`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'USM-HOST', description: 'Universal Service Monitoring', quantity: hosts, unit: 'hosts', rate: DD_PRICES.usmHost, amount: c.listPriceCost }],
    });
  }, [mode, hosts, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🧭" title="Universal Service Monitoring" description="Size USM as a per-host add-on giving service-level golden signals without full APM instrumentation." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="USM (proxy: infra hosts)"
          growthRate={growthRate}
          usageUnit="hosts"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const usage = r.analytics?.infrastructure.totalHosts ?? null;
            return { orgName: r.org.name, orgId: r.org.id, usage, cost: usage != null ? usage * DD_PRICES.usmHost : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="usm"
          onLoad={() => { setHosts(Math.max(1, scanData.infrastructure.totalHosts)); setPresetId(null); }}
          items={[
            { label: 'Total Hosts', actual: fmtNum(scanData.infrastructure.totalHosts), note: 'USM candidate fleet' },
            { label: 'APM Services', actual: String(scanData.apm.totalServices), note: 'services not yet instrumented benefit most' },
          ]}
        />
      )}
      <PresetBar
        presets={USM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = USM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setHosts(p.hosts);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Fleet Configuration</h3>
          <SliderInput label="Hosts" value={hosts} min={1} max={50000} unit="hosts" log onChange={(v) => { setHosts(v); setPresetId(null); }} />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <ResultCard label="Hosts" value={fmtNum(hosts)} sub={`$${DD_PRICES.usmHost}/host/mo`} color="violet" />
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Hosts', value: fmtNum(hosts), note: `$${DD_PRICES.usmHost}/host/mo list price` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for USM yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[{ label: 'Hosts', baseline: hosts, unit: '' }]} />
      </>
      )}
    </div>
  );
}

// ─── Data Streams Monitoring ────────────────────────────────────────────────────

const DSM_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~5 hosts', hosts: 5 },
  { id: 'mid', label: 'Growing org', sub: '~30 hosts', hosts: 30 },
  { id: 'large', label: 'Large org', sub: '~150 hosts', hosts: 150 },
  { id: 'enterprise', label: 'Enterprise', sub: '500+ hosts', hosts: 500 },
];

function DSMCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [hosts, setHosts] = useState(30);
  const [growthRate, setGrowthRate] = useState(20);
  const [presetId, setPresetId] = useState<string | null>('mid');

  const c = useMemo(() => ({ listPriceCost: hosts * DD_PRICES.dsmHost }), [hosts]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'dsm', label: 'Data Streams Mon.', icon: '🔗', primaryMetric: `${fmtNum(hosts)} hosts`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'DSM-HOST', description: 'Data Streams Monitoring', quantity: hosts, unit: 'hosts', rate: DD_PRICES.dsmHost, amount: c.listPriceCost }],
    });
  }, [mode, hosts, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔗" title="Data Streams Monitoring" description="Size DSM as a per-host add-on tracking Kafka/messaging pipeline health and latency." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="DSM (manual input — no usage proxy)"
          growthRate={growthRate}
          usageUnit="hosts"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => ({ orgName: r.org.name, orgId: r.org.id, usage: null, cost: 0, costIsEstimate: true }))}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="dsm"
          onLoad={() => setPresetId(null)}
          items={[
            { label: 'Total Hosts', actual: fmtNum(scanData.infrastructure.totalHosts), note: 'DSM has no broker-count signal in scan data — enter manually' },
          ]}
        />
      )}
      <PresetBar
        presets={DSM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = DSM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setHosts(p.hosts);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Fleet Configuration</h3>
          <SliderInput
            label="Kafka / Messaging Hosts" value={hosts} min={1} max={5000} unit="hosts" log
            onChange={(v) => { setHosts(v); setPresetId(null); }}
            info="Hosts running Kafka brokers, consumers, or producers instrumented for DSM."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <ResultCard label="Hosts" value={fmtNum(hosts)} sub={`$${DD_PRICES.dsmHost}/host/mo`} color="violet" />
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Hosts', value: fmtNum(hosts), note: `$${DD_PRICES.dsmHost}/host/mo list price` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for DSM yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[{ label: 'Hosts', baseline: hosts, unit: '' }]} />
      </>
      )}
    </div>
  );
}

// ─── Data Jobs Monitoring ───────────────────────────────────────────────────────

const DJM_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~5 hosts', hosts: 5 },
  { id: 'mid', label: 'Growing org', sub: '~30 hosts', hosts: 30 },
  { id: 'large', label: 'Large org', sub: '~150 hosts', hosts: 150 },
  { id: 'enterprise', label: 'Enterprise', sub: '500+ hosts', hosts: 500 },
];

function DJMCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [hosts, setHosts] = useState(30);
  const [growthRate, setGrowthRate] = useState(20);
  const [presetId, setPresetId] = useState<string | null>('mid');

  const c = useMemo(() => ({ listPriceCost: hosts * DD_PRICES.djmHost }), [hosts]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'djm', label: 'Data Jobs Mon.', icon: '⚙', primaryMetric: `${fmtNum(hosts)} hosts`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'DJM-HOST', description: 'Data Jobs Monitoring', quantity: hosts, unit: 'hosts', rate: DD_PRICES.djmHost, amount: c.listPriceCost }],
    });
  }, [mode, hosts, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="⚙" title="Data Jobs Monitoring" description="Size DJM as a per-compute-host add-on tracking Spark/Databricks job health and cost." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="DJM (manual input — no usage proxy)"
          growthRate={growthRate}
          usageUnit="hosts"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => ({ orgName: r.org.name, orgId: r.org.id, usage: null, cost: 0, costIsEstimate: true }))}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="djm"
          onLoad={() => setPresetId(null)}
          items={[
            { label: 'Total Hosts', actual: fmtNum(scanData.infrastructure.totalHosts), note: 'DJM has no compute-cluster signal in scan data — enter manually' },
          ]}
        />
      )}
      <PresetBar
        presets={DJM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = DJM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setHosts(p.hosts);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Fleet Configuration</h3>
          <SliderInput
            label="Spark / Databricks Compute Hosts" value={hosts} min={1} max={5000} unit="hosts" log
            onChange={(v) => { setHosts(v); setPresetId(null); }}
            info="Worker/executor hosts running Spark, Databricks, or EMR jobs instrumented for DJM."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <ResultCard label="Compute Hosts" value={fmtNum(hosts)} sub={`$${DD_PRICES.djmHost}/host/mo`} color="violet" />
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Compute hosts', value: fmtNum(hosts), note: `$${DD_PRICES.djmHost}/host/mo list price` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for DJM yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[{ label: 'Compute Hosts', baseline: hosts, unit: '' }]} />
      </>
      )}
    </div>
  );
}

// ─── LLM Observability ──────────────────────────────────────────────────────────

const LLM_OBS_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~10K spans/day', spansPerDay: 10000 },
  { id: 'mid', label: 'Growing org', sub: '~100K spans/day', spansPerDay: 100000 },
  { id: 'large', label: 'Large org', sub: '~2M spans/day', spansPerDay: 2000000 },
  { id: 'enterprise', label: 'Enterprise', sub: '20M+ spans/day', spansPerDay: 20000000 },
];

function LLMObsCalculator({ mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [spansPerDay, setSpansPerDay] = useState(100000);
  const [growthRate, setGrowthRate] = useState(50);
  const [presetId, setPresetId] = useState<string | null>('mid');

  const c = useMemo(() => ({ listPriceCost: (spansPerDay * 30 / 1000) * DD_PRICES.llmObsSpan1k }), [spansPerDay]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'llm-obs', label: 'LLM Observability', icon: '🤖', primaryMetric: `${fmtNum(spansPerDay)} spans/day`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'LLMOBS-SPAN', description: 'LLM Observability Spans', quantity: (spansPerDay * 30) / 1000, unit: 'K spans/mo', rate: DD_PRICES.llmObsSpan1k, amount: c.listPriceCost }],
    });
  }, [mode, spansPerDay, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🤖" title="LLM Observability" description="Estimate cost from LLM application span volume — prompts, completions, tool calls, and agent chains." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="LLM Observability (manual input — no usage proxy)"
          growthRate={growthRate}
          usageUnit="spans/day"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => ({ orgName: r.org.name, orgId: r.org.id, usage: null, cost: 0, costIsEstimate: true }))}
        />
      ) : (
      <>
      <PresetBar
        presets={LLM_OBS_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = LLM_OBS_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setSpansPerDay(p.spansPerDay);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Span Volume</h3>
          <SliderInput
            label="LLM Spans / Day" value={spansPerDay} min={100} max={100000000} unit="spans / day" log
            onChange={(v) => { setSpansPerDay(v); setPresetId(null); }}
            info="Every traced LLM call, tool invocation, retrieval step, or agent hop in an instrumented LLM application."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={500} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <ResultCard label="Spans / Day" value={fmtNum(spansPerDay)} sub={`$${DD_PRICES.llmObsSpan1k}/1K spans`} color="violet" />
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Spans / month', value: fmtNum(spansPerDay * 30) },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for LLM Observability yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[{ label: 'Spans / Day', baseline: spansPerDay, unit: '' }]} />
      </>
      )}
    </div>
  );
}

// ─── On-Call / Incident Management ─────────────────────────────────────────────

const ONCALL_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~10 responders', users: 10 },
  { id: 'mid', label: 'Growing org', sub: '~50 responders', users: 50 },
  { id: 'large', label: 'Large org', sub: '~250 responders', users: 250 },
  { id: 'enterprise', label: 'Enterprise', sub: '1,000+ responders', users: 1000 },
];

function OnCallCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [users, setUsers] = useState(50);
  const [growthRate, setGrowthRate] = useState(20);
  const [presetId, setPresetId] = useState<string | null>('mid');

  const c = useMemo(() => ({ listPriceCost: users * DD_PRICES.onCallUser }), [users]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'on-call', label: 'On-Call', icon: '📟', primaryMetric: `${fmtNum(users)} responders`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'ONCALL-SEAT', description: 'On-Call Responder Seat', quantity: users, unit: 'seats', rate: DD_PRICES.onCallUser, amount: c.listPriceCost }],
    });
  }, [mode, users, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="📟" title="On-Call / Incident Management" description="Size On-Call seats for responders participating in escalation policies and incident response." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="On-Call (proxy: platform users)"
          growthRate={growthRate}
          usageUnit="responders"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const usage = r.analytics?.governance.userCount ?? null;
            return { orgName: r.org.name, orgId: r.org.id, usage, cost: usage != null ? usage * DD_PRICES.onCallUser : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="oncall"
          onLoad={() => { setUsers(Math.max(1, scanData.governance.userCount || users)); setPresetId(null); }}
          items={[
            { label: 'Platform Users', actual: scanData.governance.userCount != null ? fmtNum(scanData.governance.userCount) : '—', note: 'proxy for on-call responders — not everyone joins a rotation' },
          ]}
        />
      )}
      <PresetBar
        presets={ONCALL_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = ONCALL_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setUsers(p.users);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Responder Seats</h3>
          <SliderInput label="On-Call Responders" value={users} min={1} max={10000} unit="users" log onChange={(v) => { setUsers(v); setPresetId(null); }} />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <ResultCard label="Responders" value={fmtNum(users)} sub={`$${DD_PRICES.onCallUser}/seat/mo`} color="violet" />
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Responder seats', value: fmtNum(users), note: `$${DD_PRICES.onCallUser}/seat/mo list price` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no direct usage-API mapping for On-Call yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[{ label: 'Responders', baseline: users, unit: '' }]} />
      </>
      )}
    </div>
  );
}

// ─── Cloud Network Monitoring ─────────────────────────────────────────────────

const CNM_PRESETS = [
  { id: 'small', label: 'Single cloud, small', sub: '~10 interfaces', vpcs: 2, natGateways: 1, transitGatewayAttachments: 0 },
  { id: 'mid', label: 'Multi-cloud, growth', sub: '~30 interfaces', vpcs: 8, natGateways: 4, transitGatewayAttachments: 2 },
  { id: 'large', label: 'Multi-cloud, large', sub: '~150 interfaces', vpcs: 30, natGateways: 15, transitGatewayAttachments: 8 },
  { id: 'enterprise', label: 'Enterprise scale', sub: '600+ interfaces', vpcs: 150, natGateways: 60, transitGatewayAttachments: 40 },
];

function CloudNetworkCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [vpcs, setVpcs] = useModeState(mode, 'cnm.vpcs', 8);
  const [natGateways, setNatGateways] = useModeState(mode, 'cnm.natGateways', 4);
  const [transitGatewayAttachments, setTransitGatewayAttachments] = useModeState(mode, 'cnm.tgwAttachments', 2);
  const [growthRate, setGrowthRate] = useModeState(mode, 'cnm.growthRate', 25);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'cnm.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setVpcs(0); setNatGateways(0); setTransitGatewayAttachments(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const monitoredInterfaces = vpcs * 3 + natGateways + transitGatewayAttachments; // ~3 subnets/VPC
    const listPriceCost = monitoredInterfaces * DD_PRICES.cloudNetworkInterface;
    return { monitoredInterfaces, listPriceCost };
  }, [vpcs, natGateways, transitGatewayAttachments]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'cnm', label: 'Cloud Network Mon.', icon: '🌐', primaryMetric: `${fmtNum(c.monitoredInterfaces)} interfaces`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'CNM-INTERFACE', description: 'Cloud Network Monitoring (VPC/NAT GW/Transit GW)', quantity: c.monitoredInterfaces, unit: 'interfaces', rate: DD_PRICES.cloudNetworkInterface, amount: c.listPriceCost }],
    });
  }, [mode, c.monitoredInterfaces, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🌐" title="Cloud Network Monitoring" description="Size Datadog Cloud Network Monitoring for VPC Flow Logs, NAT Gateways, and Transit Gateway attachments — distinct from host-based NPM and device-based NDM." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Cloud Network Monitoring (proxy: cloud accounts)"
          growthRate={growthRate}
          usageUnit="interfaces"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const accounts = r.analytics?.infrastructure.cloudAccounts.reduce((s, a) => s + a.n, 0) ?? null;
            const est = accounts != null ? accounts * 12 : null;
            return { orgName: r.org.name, orgId: r.org.id, usage: est, cost: est != null ? est * DD_PRICES.cloudNetworkInterface : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="cnm"
          onLoad={() => {
            const accounts = scanData.infrastructure.cloudAccounts.reduce((s, a) => s + a.n, 0);
            if (accounts > 0) {
              setVpcs(Math.max(1, accounts * 2));
              setNatGateways(Math.max(1, accounts));
              setTransitGatewayAttachments(Math.max(0, accounts - 1));
            }
            setPresetId(null);
          }}
          items={[
            { label: 'Cloud Accounts', actual: String(scanData.infrastructure.cloudAccounts.length), note: 'potential VPCs to monitor' },
          ]}
        />
      )}
      <PresetBar
        presets={CNM_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = CNM_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setVpcs(p.vpcs);
          setNatGateways(p.natGateways);
          setTransitGatewayAttachments(p.transitGatewayAttachments);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Network Resources</h3>
          <SliderInput
            label="VPCs / VNets" value={vpcs} min={0} max={1000} unit="VPCs" onChange={(v) => { setVpcs(v); setPresetId(null); }}
            info="Each VPC/VNet contributes roughly 3 monitored subnets on average — adjust in Advanced if your topology differs."
          />
          <SliderInput label="NAT Gateways" value={natGateways} min={0} max={500} unit="gateways" onChange={(v) => { setNatGateways(v); setPresetId(null); }} />
          <SliderInput label="Transit Gateway Attachments" value={transitGatewayAttachments} min={0} max={500} unit="attachments" onChange={(v) => { setTransitGatewayAttachments(v); setPresetId(null); }} />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Monitored Interfaces" value={fmtNum(c.monitoredInterfaces)} sub="VPC subnets + NAT + TGW" color="violet" />
            <ResultCard label="Est. Monthly Cost" value={`$${Math.round(c.listPriceCost).toLocaleString()}`} sub={`$${DD_PRICES.cloudNetworkInterface}/interface/mo`} color="blue" />
          </div>
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Monitored interfaces', value: fmtNum(c.monitoredInterfaces), note: `$${DD_PRICES.cloudNetworkInterface}/interface/mo (estimate, unconfirmed)` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no confirmed public rate — verify with Datadog sales' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[{ label: 'Monitored Interfaces', baseline: c.monitoredInterfaces, unit: '' }]} />
      </>
      )}
    </div>
  );
}

// ─── Feature Flags ────────────────────────────────────────────────────────────

const FEATURE_FLAGS_PRESETS = [
  { id: 'small', label: 'Small app', sub: '~20 flags', activeFlags: 20, changesPerFlagPerMonth: 8 },
  { id: 'mid', label: 'Growth', sub: '~100 flags', activeFlags: 100, changesPerFlagPerMonth: 12 },
  { id: 'large', label: 'Large platform', sub: '~500 flags', activeFlags: 500, changesPerFlagPerMonth: 15 },
  { id: 'enterprise', label: 'Enterprise', sub: '2,000+ flags', activeFlags: 2000, changesPerFlagPerMonth: 20 },
];

function FeatureFlagsCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [activeFlags, setActiveFlags] = useModeState(mode, 'ff.activeFlags', 100);
  const [changesPerFlagPerMonth, setChangesPerFlagPerMonth] = useModeState(mode, 'ff.changesPerFlagPerMonth', 12);
  const [growthRate, setGrowthRate] = useModeState(mode, 'ff.growthRate', 30);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'ff.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setActiveFlags(0); setChangesPerFlagPerMonth(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const mfcrsPerMonth = activeFlags * changesPerFlagPerMonth;
    const listPriceCost = (mfcrsPerMonth / 1e6) * DD_PRICES.featureFlagPer1M;
    return { mfcrsPerMonth, listPriceCost };
  }, [activeFlags, changesPerFlagPerMonth]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'feature-flags', label: 'Feature Flags', icon: '🚩', primaryMetric: `${fmtNum(activeFlags)} flags`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'FF-MFCR', description: 'Feature Flags (Monthly Feature Change Requests)', quantity: c.mfcrsPerMonth / 1e6, unit: 'M MFCRs/mo', rate: DD_PRICES.featureFlagPer1M, amount: c.listPriceCost }],
    });
  }, [mode, activeFlags, c.mfcrsPerMonth, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🚩" title="Feature Flags Calculator" description="Estimate Monthly Feature Change Requests (MFCRs) from your flag count and rollout velocity." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Feature Flags (proxy: APM services)"
          growthRate={growthRate}
          usageUnit="flags"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const est = r.analytics ? r.analytics.apm.totalServices * 5 : null;
            const mfcrs = est != null ? (est * 12) / 1e6 : null;
            return { orgName: r.org.name, orgId: r.org.id, usage: est, cost: mfcrs != null ? mfcrs * DD_PRICES.featureFlagPer1M : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="feature-flags"
          onLoad={() => {
            if (scanData.apm.totalServices > 0) setActiveFlags(Math.max(5, scanData.apm.totalServices * 5));
            setPresetId(null);
          }}
          items={[
            { label: 'APM Services', actual: String(scanData.apm.totalServices), note: 'proxy — ~5 flags per service typical' },
          ]}
        />
      )}
      <PresetBar
        presets={FEATURE_FLAGS_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = FEATURE_FLAGS_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setActiveFlags(p.activeFlags);
          setChangesPerFlagPerMonth(p.changesPerFlagPerMonth);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Flag Configuration</h3>
          <SliderInput label="Active Feature Flags" value={activeFlags} min={0} max={20000} unit="flags" log onChange={(v) => { setActiveFlags(v); setPresetId(null); }} />
          <SliderInput
            label="Changes per Flag / Month" value={changesPerFlagPerMonth} min={0} max={200} unit="changes"
            onChange={(v) => { setChangesPerFlagPerMonth(v); setPresetId(null); }}
            info="A 'change' is any flag evaluation config update — targeting rule edits, rollout % changes, kill switches. This is what MFCRs (Monthly Feature Change Requests) count, not flag reads."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="MFCRs / Month" value={fmtNum(c.mfcrsPerMonth)} sub="Monthly Feature Change Requests" color="violet" />
            <ResultCard label="Est. Monthly Cost" value={`$${Math.round(c.listPriceCost).toLocaleString()}`} sub={`$${DD_PRICES.featureFlagPer1M}/1M MFCRs`} color="blue" />
          </div>
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'MFCRs / month', value: `${(c.mfcrsPerMonth / 1e6).toFixed(2)}M`, note: `$${DD_PRICES.featureFlagPer1M}/1M MFCRs/mo list price (confirmed)` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no usage-API mapping for Feature Flags yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[{ label: 'MFCRs / Month', baseline: c.mfcrsPerMonth, unit: '' }]} />
      </>
      )}
    </div>
  );
}

// ─── Workflow Automation ──────────────────────────────────────────────────────

const WORKFLOW_AUTOMATION_PRESETS = [
  { id: 'small', label: 'Small team', sub: '~10 workflows', workflowsActive: 10, executionsPerWorkflowPerMonth: 200 },
  { id: 'mid', label: 'Growth', sub: '~50 workflows', workflowsActive: 50, executionsPerWorkflowPerMonth: 400 },
  { id: 'large', label: 'Large org', sub: '~200 workflows', workflowsActive: 200, executionsPerWorkflowPerMonth: 600 },
  { id: 'enterprise', label: 'Enterprise', sub: '800+ workflows', workflowsActive: 800, executionsPerWorkflowPerMonth: 1000 },
];

function WorkflowAutomationCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [workflowsActive, setWorkflowsActive] = useModeState(mode, 'wfa.workflowsActive', 50);
  const [executionsPerWorkflowPerMonth, setExecutionsPerWorkflowPerMonth] = useModeState(mode, 'wfa.executionsPerWorkflowPerMonth', 400);
  const [growthRate, setGrowthRate] = useModeState(mode, 'wfa.growthRate', 30);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'wfa.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setWorkflowsActive(0); setExecutionsPerWorkflowPerMonth(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const executionsPerMonth = workflowsActive * executionsPerWorkflowPerMonth;
    const listPriceCost = (executionsPerMonth / 100) * DD_PRICES.workflowAutomationPer100;
    return { executionsPerMonth, listPriceCost };
  }, [workflowsActive, executionsPerWorkflowPerMonth]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'workflow-automation', label: 'Workflow Automation', icon: '🔁', primaryMetric: `${fmtNum(workflowsActive)} workflows`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'WFA-EXEC', description: 'Workflow Automation Executions', quantity: c.executionsPerMonth / 100, unit: '100 executions/mo', rate: DD_PRICES.workflowAutomationPer100, amount: c.listPriceCost }],
    });
  }, [mode, workflowsActive, c.executionsPerMonth, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔁" title="Workflow Automation Calculator" description="Estimate monthly execution volume from your active automated workflows (remediation, enrichment, ChatOps)." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Workflow Automation (proxy: monitors)"
          growthRate={growthRate}
          usageUnit="workflows"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const est = r.analytics ? Math.round(r.analytics.observability.monitors / 10) : null;
            const executions = est != null ? est * 400 : null;
            return { orgName: r.org.name, orgId: r.org.id, usage: est, cost: executions != null ? (executions / 100) * DD_PRICES.workflowAutomationPer100 : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData && (
        <ScanContext
          id="workflow-automation"
          onLoad={() => {
            if (scanData.observability.monitors > 0) setWorkflowsActive(Math.max(2, Math.round(scanData.observability.monitors / 10)));
            setPresetId(null);
          }}
          items={[
            { label: 'Monitors', actual: fmtNum(scanData.observability.monitors), note: 'proxy — ~10% of monitors get an automated workflow' },
          ]}
        />
      )}
      <PresetBar
        presets={WORKFLOW_AUTOMATION_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = WORKFLOW_AUTOMATION_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setWorkflowsActive(p.workflowsActive);
          setExecutionsPerWorkflowPerMonth(p.executionsPerWorkflowPerMonth);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Workflow Configuration</h3>
          <SliderInput label="Active Workflows" value={workflowsActive} min={0} max={5000} unit="workflows" log onChange={(v) => { setWorkflowsActive(v); setPresetId(null); }} />
          <SliderInput
            label="Executions per Workflow / Month" value={executionsPerWorkflowPerMonth} min={0} max={100000} unit="executions" log
            onChange={(v) => { setExecutionsPerWorkflowPerMonth(v); setPresetId(null); }}
            info="Each trigger firing (alert-driven, scheduled, or manual) counts as one execution — including sub-workflow calls."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Executions / Month" value={fmtNum(c.executionsPerMonth)} sub="across all workflows" color="violet" />
            <ResultCard label="Est. Monthly Cost" value={`$${Math.round(c.listPriceCost).toLocaleString()}`} sub={`$${DD_PRICES.workflowAutomationPer100}/100 executions`} color="blue" />
          </div>
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Executions / month', value: fmtNum(c.executionsPerMonth), note: `$${DD_PRICES.workflowAutomationPer100}/100 executions/mo list price (confirmed)` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no usage-API mapping for Workflow Automation yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[{ label: 'Executions / Month', baseline: c.executionsPerMonth, unit: '' }]} />
      </>
      )}
    </div>
  );
}

// ─── Product Analytics ────────────────────────────────────────────────────────

const PRODUCT_ANALYTICS_PRESETS = [
  { id: 'small', label: 'Startup', sub: '~100K sessions/mo', mau: 25000, sessionsPerUser: 4 },
  { id: 'mid', label: 'Growth', sub: '~2M sessions/mo', mau: 500000, sessionsPerUser: 4 },
  { id: 'large', label: 'Mid-Market', sub: '~15M sessions/mo', mau: 3000000, sessionsPerUser: 5 },
  { id: 'enterprise', label: 'Enterprise', sub: '100M+ sessions/mo', mau: 20000000, sessionsPerUser: 5 },
];

function ProductAnalyticsCalculator({ scanData, mode, multiOrg, multiOrgLoading, reportCost }: { scanData?: AnalyticsData } & SizingModeProps) {
  const [mau, setMau] = useModeState(mode, 'pa.mau', 500000);
  const [sessionsPerUser, setSessionsPerUser] = useModeState(mode, 'pa.sessionsPerUser', 4);
  const [growthRate, setGrowthRate] = useModeState(mode, 'pa.growthRate', 35);
  const [presetId, setPresetId] = useModeState<string | null>(mode, 'pa.presetId', 'mid');

  useResetOnBlank(mode, () => {
    setMau(0); setSessionsPerUser(0); setGrowthRate(0); setPresetId(null);
  });

  const c = useMemo(() => {
    const totalSessions = mau * sessionsPerUser;
    const listPriceCost = (totalSessions / 1000) * DD_PRICES.productAnalytics1k;
    return { totalSessions, listPriceCost };
  }, [mau, sessionsPerUser]);

  useEffect(() => {
    if (mode === 'multi') return;
    reportCost({
      id: 'product-analytics', label: 'Product Analytics', icon: '📐', primaryMetric: `${fmtNum(c.totalSessions)} sessions/mo`, listPriceCost: c.listPriceCost,
      skuLines: [{ sku: 'PA-SESSION', description: 'Product Analytics Sessions', quantity: c.totalSessions / 1000, unit: 'K sessions/mo', rate: DD_PRICES.productAnalytics1k, amount: c.listPriceCost }],
    });
  }, [mode, c.totalSessions, c.listPriceCost, reportCost]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="📐" title="Product Analytics Calculator" description="Estimate session volume for Datadog Product Analytics — funnels, retention, and user journey analysis, billed separately from RUM Measure." />
      {mode === 'multi' ? (
        <MultiOrgBreakdown
          title="Product Analytics (proxy: RUM apps)"
          growthRate={growthRate}
          usageUnit="sessions/mo"
          isLoading={multiOrgLoading}
          rows={multiOrg.map(r => {
            const est = r.analytics?.rum?.total ? r.analytics.rum.total * 50000 : null;
            return { orgName: r.org.name, orgId: r.org.id, usage: est, cost: est != null ? (est / 1000) * DD_PRICES.productAnalytics1k : 0, costIsEstimate: true };
          })}
        />
      ) : (
      <>
      {scanData?.rum && (
        <ScanContext
          id="product-analytics"
          onLoad={() => {
            if (scanData.rum.total > 0) setMau(Math.max(1000, scanData.rum.total * 50000));
            setPresetId(null);
          }}
          items={[
            { label: 'RUM Applications', actual: String(scanData.rum.total), note: 'proxy for products with analytics potential' },
          ]}
        />
      )}
      <PresetBar
        presets={PRODUCT_ANALYTICS_PRESETS}
        active={presetId}
        onSelect={(id) => {
          const p = PRODUCT_ANALYTICS_PRESETS.find(pp => pp.id === id);
          if (!p) return;
          setPresetId(id);
          setMau(p.mau);
          setSessionsPerUser(p.sessionsPerUser);
        }}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-surface-subtle rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">User Traffic</h3>
          <SliderInput label="Monthly Active Users (MAU)" value={mau} min={1000} max={50000000} unit="users/mo" log onChange={(v) => { setMau(v); setPresetId(null); }} />
          <SliderInput
            label="Sessions per User / Month" value={sessionsPerUser} min={1} max={100} unit="sessions" onChange={(v) => { setSessionsPerUser(v); setPresetId(null); }}
            info="Product Analytics is billed per session, separately from RUM Measure — even if you already pay for RUM, analytics-tier features (funnels, retention cohorts) are a distinct SKU."
          />
          <Advanced>
            <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
          </Advanced>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Sessions / Month" value={fmtNum(c.totalSessions)} sub={`${fmtNum(mau)} MAU × ${sessionsPerUser}`} color="violet" />
            <ResultCard label="Est. Monthly Cost" value={`$${Math.round(c.listPriceCost).toLocaleString()}`} sub={`$${DD_PRICES.productAnalytics1k}/1K sessions`} color="blue" />
          </div>
          <SizingBlock title="List Price Estimate" icon="💰" rows={[
            { label: 'Sessions / month', value: fmtNum(c.totalSessions), note: `$${DD_PRICES.productAnalytics1k}/1K sessions/mo list price (confirmed)` },
            { label: 'Estimated monthly cost', value: `$${Math.round(c.listPriceCost).toLocaleString()}/mo`, note: 'no usage-API mapping for Product Analytics yet' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[{ label: 'Sessions / Month', baseline: c.totalSessions, unit: '' }]} />
      </>
      )}
    </div>
  );
}

// ─── Pricing History ──────────────────────────────────────────────────────────

function PricingHistoryPanel(_props: { scanData?: AnalyticsData } & SizingModeProps) {
  const { data: latest = [], isLoading: latestLoading } = useQuery({
    queryKey: ['pricing-snapshots', 'latest'],
    queryFn: pricingSnapshotsApi.latest,
  });
  const { data: allSnapshots = [] } = useQuery({
    queryKey: ['pricing-snapshots', 'all'],
    queryFn: pricingSnapshotsApi.all,
  });
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  const capturedDates = Array.from(new Set(allSnapshots.map(s => s.capturedAt))).sort();
  const previousCapture = capturedDates.length > 1 ? capturedDates[capturedDates.length - 2] : null;
  const previousByProduct = new Map(
    allSnapshots.filter(s => s.capturedAt === previousCapture).map(s => [s.product, s])
  );

  const history = useMemo(() => {
    const byProduct = new Map<string, PricingSnapshot[]>();
    for (const s of allSnapshots) {
      const list = byProduct.get(s.product) ?? [];
      list.push(s);
      byProduct.set(s.product, list);
    }
    return byProduct;
  }, [allSnapshots]);

  const sources = Array.from(new Set(allSnapshots.map(s => s.sourceUrl)));

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader
        icon="🏷"
        title="Pricing History"
        description="Timestamped snapshots of Datadog's list pricing, so you can see exactly what changed and when."
      />

      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-sm text-blue-400">
        <div className="font-semibold mb-1">📡 {sources.length > 1 ? `${sources.length} sources captured` : 'Source'}</div>
        <div className="text-blue-400 space-y-1">
          {sources.length > 0 && (
            <ul className="list-disc pl-4">
              {sources.map(s => <li key={s} className="break-all">{s}</li>)}
            </ul>
          )}
          <p>
            Public pricing pages and internal sizing sheets render/require access client-side, so there's no reliable
            automated scrape. Snapshots are captured by fetching the source (e.g. by asking Claude to refresh it) and
            recording a timestamped copy here — ask to "refresh Datadog pricing" any time you want a new snapshot to
            diff against. When sources disagree, the internal sizing calculator is treated as authoritative.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="bg-gray-800 text-white px-4 py-2.5 flex items-center gap-2">
          <span>💲</span>
          <span className="text-sm font-semibold">Current List Prices</span>
          {latestLoading && <span className="text-xs text-ink-faint ml-auto">loading…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-subtle text-ink-muted text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">Product</th>
                <th className="text-left px-4 py-2">Tier</th>
                <th className="text-left px-4 py-2">Unit</th>
                <th className="text-right px-4 py-2">Price</th>
                <th className="text-right px-4 py-2">Change vs. previous</th>
                <th className="text-right px-4 py-2">Captured</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {latest.length === 0 && !latestLoading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-faint text-sm">No pricing snapshots captured yet.</td></tr>
              )}
              {latest.map(s => {
                const prev = previousByProduct.get(s.product);
                const delta = prev ? s.price - prev.price : null;
                const deltaPct = prev && prev.price !== 0 ? (delta! / prev.price) * 100 : null;
                const productHistory = history.get(s.product) ?? [];
                const isExpanded = expandedProduct === s.product;
                return (
                  <React.Fragment key={s.id}>
                    <tr
                      className={`bg-surface-subtle even:bg-surface-subtle/40 ${productHistory.length > 1 ? 'cursor-pointer hover:bg-violet-500/30' : ''}`}
                      onClick={() => productHistory.length > 1 && setExpandedProduct(isExpanded ? null : s.product)}
                    >
                      <td className="px-4 py-2.5 font-medium text-ink">
                        {productHistory.length > 1 && <span className="text-ink-faint mr-1.5 inline-block transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▸</span>}
                        {s.product}
                      </td>
                      <td className="px-4 py-2.5 text-ink-muted">{s.tier ?? '—'}</td>
                      <td className="px-4 py-2.5 text-ink-faint text-xs">{s.unit}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-ink">${s.price.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {delta == null ? (
                          <span className="text-ink-faint text-xs">first capture</span>
                        ) : delta === 0 ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          <span className={delta > 0 ? 'text-red-400' : 'text-emerald-400'}>
                            {delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(3)} ({Math.abs(deltaPct!).toFixed(1)}%)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-ink-faint">{new Date(s.capturedAt).toLocaleDateString()}</td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="px-4 py-3 bg-violet-500/30">
                          <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Full history — {s.product}</div>
                          <div className="flex flex-wrap gap-2">
                            {productHistory.map(h => (
                              <div key={h.id} className="bg-surface-subtle border border-border rounded-lg px-3 py-1.5 text-xs">
                                <span className="text-ink-faint">{new Date(h.capturedAt).toLocaleDateString()}</span>
                                <span className="font-mono font-bold text-ink ml-2">${h.price.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-xs text-ink-faint bg-surface-subtle border-t border-border">
          Click a row with a history icon (▸) to see every captured price for that product. {capturedDates.length} capture{capturedDates.length === 1 ? '' : 's'} recorded.
        </div>
      </div>
    </div>
  );
}

// ─── Saved Sizings ────────────────────────────────────────────────────────────

function SavedSizingsPanel(_props: { scanData?: AnalyticsData } & SizingModeProps) {
  const queryClient = useQueryClient();
  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ['sizing-snapshots'],
    queryFn: sizingSnapshotsApi.list,
  });
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [invoiceRecord, setInvoiceRecord] = useState<SizingSnapshotRecord | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  const handleViewInvoice = async (id: string) => {
    setInvoiceId(id);
    setInvoiceLoading(true);
    try {
      const record = await sizingSnapshotsApi.get(id);
      setInvoiceRecord(record);
    } finally {
      setInvoiceLoading(false);
    }
  };

  const handleLoad = async (id: string) => {
    setLoadingId(id);
    try {
      const record = await sizingSnapshotsApi.get(id);
      restorePersistedState(record.state);
      window.location.reload();
    } catch {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await sizingSnapshotsApi.remove(id);
      queryClient.invalidateQueries({ queryKey: ['sizing-snapshots'] });
    } finally {
      setDeletingId(null);
    }
  };

  const toggleCompare = (id: string) => setCompareIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const compared = snapshots.filter(s => compareIds.has(s.id));
  const maxCompareCost = Math.max(1, ...compared.map(s => s.totalRealCost ?? s.totalListPrice));

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader
        icon="💾"
        title="Saved Sizings"
        description="Named snapshots of a full calculator configuration — save one whenever you want to come back to it, or compare it against another scenario later."
      />

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="bg-gray-800 text-white px-4 py-2.5 flex items-center gap-2">
          <span>📋</span>
          <span className="text-sm font-semibold">Saved Sizings</span>
          {isLoading && <span className="text-xs text-ink-faint ml-auto">loading…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-subtle text-ink-muted text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">Compare</th>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Mode</th>
                <th className="text-left px-4 py-2">Org</th>
                <th className="text-right px-4 py-2">Categories</th>
                <th className="text-right px-4 py-2">List Price</th>
                <th className="text-right px-4 py-2">Real Cost</th>
                <th className="text-right px-4 py-2">Saved</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {snapshots.length === 0 && !isLoading && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-ink-faint text-sm">
                  No sizings saved yet — configure a calculator, then use the "Save" button in the Cost Breakdown panel on the right.
                </td></tr>
              )}
              {snapshots.map(s => (
                <tr key={s.id} className="bg-surface-subtle even:bg-surface-subtle/40">
                  <td className="px-4 py-2.5">
                    <input type="checkbox" checked={compareIds.has(s.id)} onChange={() => toggleCompare(s.id)} className="accent-violet-600" />
                  </td>
                  <td className="px-4 py-2.5 font-medium text-ink">{s.name}</td>
                  <td className="px-4 py-2.5 text-ink-muted text-xs capitalize">{s.mode}</td>
                  <td className="px-4 py-2.5 text-ink-muted text-xs">{s.orgName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{s.categoryCount}</td>
                  <td className="px-4 py-2.5 text-right font-mono">${Math.round(s.totalListPrice).toLocaleString()}/mo</td>
                  <td className="px-4 py-2.5 text-right font-mono">{s.totalRealCost != null ? `$${Math.round(s.totalRealCost).toLocaleString()}/mo` : '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-ink-faint">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleViewInvoice(s.id)}
                      disabled={invoiceLoading && invoiceId === s.id}
                      className="text-xs font-semibold text-emerald-400 hover:text-emerald-900 disabled:opacity-40 mr-3"
                    >
                      {invoiceLoading && invoiceId === s.id ? 'Loading…' : '🧾 Invoice'}
                    </button>
                    <button
                      onClick={() => handleLoad(s.id)}
                      disabled={loadingId === s.id}
                      className="text-xs font-semibold text-violet-400 hover:text-violet-400 disabled:opacity-40 mr-3"
                    >
                      {loadingId === s.id ? 'Loading…' : 'Load'}
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id}
                      className="text-xs text-ink-faint hover:text-red-400 disabled:opacity-40"
                    >
                      {deletingId === s.id ? '…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {snapshots.length > 0 && (
          <div className="px-4 py-2 text-xs text-ink-faint bg-surface-subtle border-t border-border">
            Loading a sizing overwrites your current calculator inputs (it reloads the page) — save your current work first if you want to keep it.
          </div>
        )}
      </div>

      {compared.length > 0 && (
        <div className="rounded-xl border border-violet-500/30 overflow-hidden">
          <div className="bg-violet-900 text-white px-4 py-2.5 flex items-center gap-2">
            <span>📊</span>
            <span className="text-sm font-semibold">Comparing {compared.length} sizing{compared.length === 1 ? '' : 's'}</span>
          </div>
          <div className="p-4 space-y-3 bg-surface-subtle">
            {compared.map(s => {
              const cost = s.totalRealCost ?? s.totalListPrice;
              const pct = Math.max(2, (cost / maxCompareCost) * 100);
              return (
                <div key={s.id}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-ink">{s.name}</span>
                    <span className="font-mono font-bold text-ink">${Math.round(cost).toLocaleString()}/mo</span>
                  </div>
                  <div className="h-3 bg-surface-sunken rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {invoiceId && invoiceRecord && (
        <InvoiceDocument record={invoiceRecord} onClose={() => { setInvoiceId(null); setInvoiceRecord(null); }} />
      )}
    </div>
  );
}

// ─── Invoice ──────────────────────────────────────────────────────────────────

function InvoiceDocument({ record, onClose }: { record: SizingSnapshotRecord; onClose: () => void }) {
  // Flatten every category's SKU lines into one billing table. Categories saved before
  // skuLines existed fall back to a single line using their rolled-up cost.
  type Row = { categoryLabel: string; categoryIcon: string; sku: string; description: string; quantity: number; unit: string; rate: number; amount: number; isReal: boolean };
  const rows: Row[] = record.cart.flatMap(item => {
    if (item.skuLines && item.skuLines.length > 0) {
      return item.skuLines.map(line => ({
        categoryLabel: item.label, categoryIcon: item.icon, sku: line.sku, description: line.description,
        quantity: line.quantity, unit: line.unit, rate: line.rate, amount: line.amount, isReal: false,
      }));
    }
    return [{
      categoryLabel: item.label, categoryIcon: item.icon, sku: item.id.toUpperCase(), description: item.primaryMetric,
      quantity: 1, unit: 'category total', rate: item.realCost ?? item.listPriceCost, amount: item.realCost ?? item.listPriceCost, isReal: item.realCost != null,
    }];
  });

  const grandTotal = rows.reduce((s, r) => s + r.amount, 0);
  const invoiceNumber = record.id.slice(0, 8).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6 print:p-0 print:bg-surface-subtle" onClick={onClose}>
      <div
        className="bg-surface-subtle rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto print:max-h-none print:shadow-none print:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-8 space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-ink">Sizing Invoice</h1>
              <p className="text-sm text-ink-faint mt-1">Datadog Architecture Health Check — Estimated List Pricing</p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <button onClick={() => window.print()} className="text-xs font-semibold bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700">🖨 Print / Export PDF</button>
              <button onClick={onClose} className="text-xs font-semibold text-ink-faint hover:text-red-400 px-3 py-1.5">✕ Close</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 text-sm border-y border-border py-4">
            <div className="space-y-1">
              <div><span className="text-ink-faint">Quote name:</span> <span className="font-semibold text-ink">{record.name}</span></div>
              <div><span className="text-ink-faint">Invoice #:</span> <span className="font-mono text-ink">{invoiceNumber}</span></div>
              <div><span className="text-ink-faint">Date:</span> <span className="text-ink">{new Date(record.createdAt).toLocaleDateString()}</span></div>
            </div>
            <div className="space-y-1 text-right">
              <div><span className="text-ink-faint">Org:</span> <span className="text-ink">{record.orgName ?? '—'}</span></div>
              <div><span className="text-ink-faint">Sizing mode:</span> <span className="text-ink capitalize">{record.mode}</span></div>
              <div><span className="text-ink-faint">Categories:</span> <span className="text-ink">{record.categoryCount}</span></div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-faint text-xs uppercase tracking-wide border-b border-border">
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3">Unit</th>
                  <th className="py-2 pr-3 text-right">Rate</th>
                  <th className="py-2 text-right">Amount / mo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3 font-mono text-xs text-ink-faint">{r.sku}</td>
                    <td className="py-2 pr-3 text-ink">{r.description}</td>
                    <td className="py-2 pr-3 text-ink-muted text-xs">{r.categoryIcon} {r.categoryLabel}</td>
                    <td className="py-2 pr-3 text-right font-mono">{r.quantity < 1000 ? r.quantity.toFixed(r.quantity % 1 === 0 ? 0 : 2) : fmtNum(r.quantity)}</td>
                    <td className="py-2 pr-3 text-ink-faint text-xs">{r.unit}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">${r.rate < 1 ? r.rate.toFixed(4) : r.rate.toFixed(2)}</td>
                    <td className="py-2 text-right font-mono font-semibold text-ink">${Math.round(r.amount).toLocaleString()}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-ink-faint">No line items in this sizing.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="w-64 space-y-1.5 text-sm">
              <div className="flex justify-between text-ink-muted"><span>{rows.length} line item{rows.length === 1 ? '' : 's'}</span></div>
              <div className="flex justify-between pt-2 border-t border-border">
                <span className="font-bold text-ink">List Price Total</span>
                <span className="font-mono font-bold text-lg text-emerald-400">${Math.round(grandTotal).toLocaleString()}/mo</span>
              </div>
              {record.totalRealCost != null && (
                <div className="flex justify-between text-xs text-ink-faint">
                  <span>Real cost (where available)</span>
                  <span className="font-mono">${Math.round(record.totalRealCost).toLocaleString()}/mo</span>
                </div>
              )}
            </div>
          </div>

          <p className="text-xs text-ink-faint border-t border-border pt-3">
            Estimated list pricing from Datadog's public pricing page and internal sizing calculator. Enterprise/committed rates are typically 20–50% lower — contact Datadog sales for an official quote.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Cost Breakdown Cart ──────────────────────────────────────────────────────

function CartPanel({ items, activeId, onRemove, onClear, onSave }: {
  items: CartItem[]; activeId: string; onRemove: (id: string) => void; onClear: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const totalList = items.reduce((s, i) => s + i.listPriceCost, 0);
  const totalReal = items.reduce((s, i) => s + (i.realCost ?? i.listPriceCost), 0);
  const anyReal = items.some(i => i.realCost != null);

  const [saveName, setSaveName] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleSave = async () => {
    if (!saveName.trim() || saveStatus === 'saving') return;
    setSaveStatus('saving');
    try {
      await onSave(saveName.trim());
      setSaveStatus('saved');
      setSaveName('');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
    }
  };

  return (
    <div className="w-80 shrink-0 border-l border-border bg-surface-subtle flex flex-col overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-xs font-bold text-ink-muted uppercase tracking-wider flex items-center gap-1.5">🛒 Cost Breakdown</h2>
          <p className="text-xs text-ink-faint mt-0.5">Every category you've configured</p>
        </div>
        {items.length > 0 && (
          <button onClick={onClear} className="text-xs text-ink-faint hover:text-red-400 transition-colors">Clear</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-ink-faint text-center py-8 px-4">
            Configure a calculator on the left — each category you visit shows up here with its estimated cost.
          </div>
        )}
        {items.map(item => (
          <div
            key={item.id}
            className={`rounded-lg border p-3 transition-colors ${
              item.id === activeId ? 'border-violet-500/30 bg-violet-500/10' : 'border-border bg-surface-subtle'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <span className="text-base shrink-0">{item.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink leading-tight truncate">{item.label}</div>
                  <div className="text-xs text-ink-faint leading-tight mt-0.5">{item.primaryMetric}</div>
                </div>
              </div>
              <button onClick={() => onRemove(item.id)} className="text-ink-faint hover:text-red-400 text-xs shrink-0 leading-tight">✕</button>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-xs text-ink-faint">{item.realCost != null ? 'real cost' : 'list price est.'}</span>
              <span className="text-sm font-bold font-mono text-ink tabular-nums">
                ${Math.round(item.realCost ?? item.listPriceCost).toLocaleString()}/mo
              </span>
            </div>
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div className="border-t border-border px-4 py-3 bg-surface-subtle space-y-1">
          <div className="flex items-center justify-between text-xs text-ink-faint">
            <span>{items.length} categor{items.length === 1 ? 'y' : 'ies'}</span>
            <span>List price total: ${Math.round(totalList).toLocaleString()}/mo</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-ink">Estimated Total</span>
            <span className="text-lg font-bold font-mono text-emerald-400 tabular-nums">${Math.round(totalReal).toLocaleString()}/mo</span>
          </div>
          {anyReal && (
            <div className="text-[10px] text-ink-faint">Uses real Usage-API cost where available, list price elsewhere.</div>
          )}

          <div className="pt-2 border-t border-border space-y-1.5">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                placeholder="Name this sizing…"
                className="flex-1 min-w-0 text-xs border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
              <button
                onClick={handleSave}
                disabled={!saveName.trim() || saveStatus === 'saving'}
                className="text-xs font-semibold bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 disabled:opacity-40 disabled:hover:bg-violet-600 shrink-0"
              >
                {saveStatus === 'saving' ? 'Saving…' : '💾 Save'}
              </button>
            </div>
            {saveStatus === 'saved' && <div className="text-[10px] text-emerald-400">Saved — find it under "Saved Sizings" in the sidebar.</div>}
            {saveStatus === 'error' && <div className="text-[10px] text-red-400">Couldn't save — try again.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type CalcDef = { id: string; label: string; icon: string; description: string; group: string; component: React.ComponentType<{ scanData?: AnalyticsData } & SizingModeProps> };

const CALCULATORS: CalcDef[] = [
  { id: 'infra', label: 'Infrastructure', icon: '🖥', description: 'Host, container, and K8s allotments', group: 'Core', component: InfraCalculator },
  { id: 'logs', label: 'Log Pipeline', icon: '🪵', description: 'Ingest, indexing, Flex, and retention', group: 'Core', component: LogsCalculator },
  { id: 'apm', label: 'APM & Traces', icon: '🔍', description: 'Trace ingestion, sampling, and retention', group: 'Core', component: APMCalculator },
  { id: 'metrics', label: 'Custom Metrics', icon: '📈', description: 'Cardinality and allotment forecasting', group: 'Core', component: MetricsCalculator },
  { id: 'rum', label: 'RUM & Sessions', icon: '👤', description: 'Session, replay, and mobile RUM volume', group: 'Frontend', component: RUMCalculator },
  { id: 'product-analytics', label: 'Product Analytics', icon: '📐', description: 'Funnels, retention, and journey session volume', group: 'Frontend', component: ProductAnalyticsCalculator },
  { id: 'synthetics', label: 'Synthetics', icon: '🧪', description: 'Test run estimation and optimization', group: 'Frontend', component: SyntheticsCalculator },
  { id: 'ci', label: 'CI Visibility', icon: '🔧', description: 'Pipeline runs, test spans, committers', group: 'Developer', component: CIVisibilityCalculator },
  { id: 'profiler', label: 'Continuous Profiler', icon: '⚡', description: 'Flame graph storage and agent overhead', group: 'Developer', component: ProfilerCalculator },
  { id: 'feature-flags', label: 'Feature Flags', icon: '🚩', description: 'Monthly Feature Change Request volume', group: 'Developer', component: FeatureFlagsCalculator },
  { id: 'dbm', label: 'Database Mon.', icon: '🗄', description: 'DBM query samples and metric volume', group: 'Data', component: DBMCalculator },
  { id: 'usm', label: 'Universal Service Mon.', icon: '🧭', description: 'Per-host golden signals without full APM', group: 'Data', component: USMCalculator },
  { id: 'dsm', label: 'Data Streams Mon.', icon: '🔗', description: 'Kafka/messaging pipeline health per host', group: 'Data', component: DSMCalculator },
  { id: 'djm', label: 'Data Jobs Mon.', icon: '⚙', description: 'Spark/Databricks job monitoring per host', group: 'Data', component: DJMCalculator },
  { id: 'llm-obs', label: 'LLM Observability', icon: '🤖', description: 'LLM span volume across prompts and agent chains', group: 'Data', component: LLMObsCalculator },
  { id: 'cloud', label: 'Cloud Accounts', icon: '☁', description: 'AWS / GCP / Azure metric volumes', group: 'Cloud', component: CloudCalculator },
  { id: 'serverless', label: 'Serverless', icon: '⚡', description: 'Lambda, Fargate, Cloud Run, Azure Functions', group: 'Cloud', component: ServerlessCalculator },
  { id: 'ccm', label: 'Cloud Cost Mgmt', icon: '💵', description: 'CCM cost as % of managed cloud spend', group: 'Cloud', component: CCMCalculator },
  { id: 'ndm', label: 'Network Devices', icon: '🔌', description: 'SNMP agent sizing for device fleets', group: 'Network', component: NDMCalculator },
  { id: 'npm', label: 'Network Flows', icon: '🌊', description: 'Cloud Network Monitor (CNM) flow data volume and overhead', group: 'Network', component: NPMCalculator },
  { id: 'cnm', label: 'Cloud Network Mon.', icon: '🌐', description: 'VPC Flow Logs, NAT & Transit Gateway monitoring', group: 'Network', component: CloudNetworkCalculator },
  { id: 'opw', label: 'Obs. Pipelines', icon: '🔀', description: 'OPW worker sizing and cost savings', group: 'Pipeline', component: OPWCalculator },
  { id: 'cspm', label: 'Security Posture', icon: '🛡', description: 'CSPM scan coverage and findings', group: 'Security', component: CSPMCalculator },
  { id: 'asm', label: 'App Security', icon: '🔒', description: 'ASM threat events, SCA, API security', group: 'Security', component: ASMCalculator },
  { id: 'cloud-siem', label: 'Cloud SIEM', icon: '🛰', description: 'Detection rule volume, distinct from log ingest', group: 'Security', component: CloudSIEMCalculator },
  { id: 'sds', label: 'Sensitive Data Scanner', icon: '🕵', description: 'PII/PCI/secrets scan volume', group: 'Security', component: SDSCalculator },
  { id: 'on-call', label: 'On-Call', icon: '📟', description: 'Responder seats for escalation and incident response', group: 'Ops', component: OnCallCalculator },
  { id: 'workflow-automation', label: 'Workflow Automation', icon: '🔁', description: 'Automated remediation & ChatOps execution volume', group: 'Ops', component: WorkflowAutomationCalculator },
  { id: 'pricing-history', label: 'Pricing History', icon: '🏷', description: 'List price changes over time', group: 'Reference', component: PricingHistoryPanel },
  { id: 'saved-sizings', label: 'Saved Sizings', icon: '💾', description: 'Save & recall full sizing scenarios', group: 'Reference', component: SavedSizingsPanel },
];

const CALC_GROUPS = ['Core', 'Frontend', 'Developer', 'Data', 'Cloud', 'Network', 'Pipeline', 'Security', 'Ops', 'Reference'];

export default function Calculators() {
  const [activeId, setActiveId] = usePersistedState('page.activeId', 'infra');
  const [mode, setMode] = usePersistedState<SizingMode>('page.mode', 'current');
  const [cart, setCart] = usePersistedState<Record<string, CartItem>>('page.cart', {});
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  const reportCost = React.useCallback((item: CartItem) => {
    setCart(prev => {
      const existing = prev[item.id];
      if (existing && existing.listPriceCost === item.listPriceCost && existing.realCost === item.realCost
        && existing.primaryMetric === item.primaryMetric) return prev;
      return { ...prev, [item.id]: item };
    });
  }, []);
  const removeFromCart = (id: string) => setCart(prev => {
    const next = { ...prev };
    delete next[id];
    return next;
  });
  const clearCart = () => setCart({});

  const saveSizing = async (name: string) => {
    const cartItems = Object.values(cart);
    const totalListPrice = cartItems.reduce((s, i) => s + i.listPriceCost, 0);
    const anyReal = cartItems.some(i => i.realCost != null);
    const totalRealCost = anyReal ? cartItems.reduce((s, i) => s + (i.realCost ?? i.listPriceCost), 0) : undefined;
    const org = orgs.find(o => o.id === selectedOrgId);
    await sizingSnapshotsApi.create({
      name,
      mode,
      orgId: org?.id,
      orgName: org?.name,
      totalListPrice,
      totalRealCost,
      categoryCount: cartItems.length,
      cart: cartItems,
      state: collectPersistedState(),
    });
  };

  const { data: scanData } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId) && mode !== 'blank',
  });

  const { data: usageData } = useQuery({
    queryKey: ['usage', selectedOrgId, selectedScanId],
    queryFn: () => usageApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId) && mode === 'current',
  });

  const multiOrgSizing = useMultiOrgSizing(mode === 'multi');

  const active = CALCULATORS.find(c => c.id === activeId) ?? CALCULATORS[0];
  const ActiveComponent = active.component;
  const effectiveScanData = mode === 'blank' ? undefined : scanData;
  const modeProps: SizingModeProps = {
    mode,
    usageData: mode === 'current' ? usageData : undefined,
    multiOrg: multiOrgSizing.rows,
    multiOrgLoading: multiOrgSizing.isLoading,
    reportCost,
  };

  return (
    <div className="flex h-[calc(100vh-64px)] -mx-6 -my-6 overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 shrink-0 border-r border-border bg-surface-subtle flex flex-col overflow-hidden">
        <div className="px-4 pt-4 pb-2 border-b border-border">
          <h2 className="text-xs font-bold text-ink-muted uppercase tracking-wider">Sizing Calculators</h2>
          <p className="text-xs text-ink-faint mt-0.5">
            {mode === 'blank' ? 'Blank project — org data ignored' : mode === 'multi' ? `Multi-org rollup — ${multiOrgSizing.readyOrgs}/${multiOrgSizing.totalOrgs} orgs ready` : effectiveScanData ? <span className="text-blue-400 font-medium">📡 Scan data loaded</span> : 'Select a scan for current usage'}
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
          {CALC_GROUPS.map(group => {
            const items = CALCULATORS.filter(c => c.group === group);
            return (
              <div key={group}>
                <div className="px-3 py-1 text-[10px] font-bold text-ink-faint uppercase tracking-widest">{group}</div>
                <div className="space-y-0.5">
                  {items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => setActiveId(item.id)}
                      className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-lg transition-colors ${
                        activeId === item.id ? 'bg-violet-600 text-white' : 'text-ink-muted hover:bg-surface-sunken'
                      }`}
                    >
                      <span className="text-base mt-0.5 shrink-0">{item.icon}</span>
                      <div className="min-w-0">
                        <div className={`text-sm font-medium leading-tight ${activeId === item.id ? 'text-white' : 'text-ink'}`}>{item.label}</div>
                        <div className={`text-xs leading-tight mt-0.5 ${activeId === item.id ? 'text-violet-200' : 'text-ink-faint'}`}>{item.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6 min-w-0">
        <div className="mb-4 flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <span className="shrink-0">⚠</span>
          <span>
            <strong>Reference only, not a quote.</strong> These figures use simplified list-price assumptions and
            won't reflect newly released products, your actual contract, committed-use discounts, or plan-specific
            pricing. Use this to gauge order-of-magnitude cost and tradeoffs, then confirm real numbers with your
            Datadog account team.
          </span>
        </div>
        <ModeToggle mode={mode} onChange={setMode} hasOrgs={orgs.length > 0} hasMultipleOrgs={orgs.length > 1} />
        <ActiveComponent scanData={effectiveScanData} {...modeProps} />
      </div>

      <CartPanel items={Object.values(cart)} activeId={activeId} onRemove={removeFromCart} onClear={clearCart} onSave={saveSizing} />
    </div>
  );
}
