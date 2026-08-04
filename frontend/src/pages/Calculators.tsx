import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import type { AnalyticsData } from '../types';

// ─── Shared UI ────────────────────────────────────────────────────────────────

function SliderInput({
  label, value, min, max, step = 1, unit = '', hint, onChange, log: isLog = false,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  unit?: string; hint?: string; onChange: (v: number) => void; log?: boolean;
}) {
  const toSlider = (v: number) => isLog ? Math.log10(Math.max(v, 1)) : v;
  const fromSlider = (s: number) => isLog ? Math.round(Math.pow(10, s)) : s;
  const sliderMin = isLog ? Math.log10(Math.max(min, 1)) : min;
  const sliderMax = isLog ? Math.log10(max) : max;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-gray-700 leading-tight">{label}</label>
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
            className="w-24 text-right text-sm font-bold text-violet-700 border border-violet-200 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          {unit && <span className="text-xs text-gray-400 w-16 leading-tight">{unit}</span>}
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
      {hint && <p className="text-xs text-gray-400 leading-tight">{hint}</p>}
    </div>
  );
}

function SelectInput({
  label, value, options, onChange, hint,
}: {
  label: string; value: string | number;
  options: Array<{ value: string | number; label: string }>;
  onChange: (v: string) => void; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
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
    gray: 'bg-gray-50 border-gray-200 text-gray-800',
    violet: 'bg-violet-50 border-violet-200 text-violet-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    green: 'bg-green-50 border-green-200 text-green-800',
    red: 'bg-red-50 border-red-200 text-red-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5 leading-tight">{sub}</div>}
    </div>
  );
}

function SizingBlock({ title, icon, rows }: {
  title: string; icon: string; rows: Array<{ label: string; value: string; note?: string }>;
}) {
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-800 text-white flex items-center gap-2">
        <span>{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5 bg-white even:bg-gray-50/50">
            <span className="text-sm text-gray-600">{r.label}</span>
            <div className="text-right">
              <span className="text-sm font-mono font-bold text-gray-900">{r.value}</span>
              {r.note && <div className="text-xs text-gray-400">{r.note}</div>}
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
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-gray-800 text-white px-4 py-2.5 flex items-center gap-2">
        <span>📈</span>
        <span className="text-sm font-semibold">Growth Projection ({growthRate}% YoY)</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <th className="text-left px-4 py-2">Metric</th>
            <th className="text-right px-4 py-2">Now</th>
            <th className="text-right px-4 py-2 bg-violet-50 text-violet-700">+1 Year</th>
            <th className="text-right px-4 py-2">+2 Years</th>
            <th className="text-right px-4 py-2">+3 Years</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={i} className="bg-white even:bg-gray-50/40">
              <td className="px-4 py-2.5 text-gray-700">{r.label}</td>
              <td className="px-4 py-2.5 text-right font-mono font-semibold text-gray-900">
                {fmt(r.baseline, r.formatter)} <span className="text-xs font-normal text-gray-400">{r.unit}</span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono font-bold text-violet-700 bg-violet-50/40">
                {fmt(project(r.baseline, 1), r.formatter)} <span className="text-xs font-normal">{r.unit}</span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-gray-700">
                {fmt(project(r.baseline, 2), r.formatter)} <span className="text-xs font-normal text-gray-400">{r.unit}</span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-gray-700">
                {fmt(project(r.baseline, 3), r.formatter)} <span className="text-xs font-normal text-gray-400">{r.unit}</span>
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
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
    </div>
  );
}

function ScanContext({
  items, onLoad,
}: {
  items: Array<{ label: string; actual: string; note?: string }>;
  onLoad?: () => void;
}) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-1">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-blue-600 text-base">📡</span>
          <span className="text-sm font-semibold text-blue-800">Current Usage — last scan</span>
        </div>
        {onLoad && (
          <button
            onClick={onLoad}
            className="text-xs bg-blue-600 text-white px-3 py-1 rounded-full font-medium hover:bg-blue-700 transition-colors shrink-0"
          >
            Load scan values ↓
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {items.map((item, i) => (
          <div key={i} className="bg-white/80 rounded-lg px-3 py-2">
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

const DD_PRICES = {
  infraHostPro: 18,
  infraHostEnt: 27,
  containerPerHr: 0.002,
  apmHost: 31,
  logsIngestGb: 0.10,
  logsIndexMillion: 1.70,
  logsFlexHotGb: 0.05,
  logsFlexFrozenGb: 0.01,
  customMetricsPer100: 5,
  syntheticsApi10k: 5,
  syntheticsBrowser1k: 12,
  rumSession1k: 1.50,
  rumMobileSession1k: 1.50,
  rumReplay1k: 1.80,
  npmHost: 5,
  dbmInstance: 70,
  profilerHost: 5,
  ciCommitter: 26,
  ndmDevice: 7,
  cspmResource: 0.50,
  opwGb: 0.35,
  asmHost: 1.50,
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

type PriceLine = { label: string; qty: number; unit: string; rate: string; monthly: number };

function PricingEstimate({ lines, note }: { lines: PriceLine[]; note?: string }) {
  const active = lines.filter(l => l.monthly > 0.5);
  const total = active.reduce((s, l) => s + l.monthly, 0);
  if (!active.length) return null;
  return (
    <div className="rounded-xl border border-emerald-200 overflow-hidden">
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
      <div className="divide-y divide-gray-100 bg-white">
        {active.map((l, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5 even:bg-gray-50/40 hover:bg-violet-50/20">
            <span className="text-sm text-gray-700">{l.label}</span>
            <div className="text-right">
              <div className="text-xs text-gray-400 font-mono">{l.qty.toLocaleString()} {l.unit} @ {l.rate}</div>
              <div className="text-sm font-bold font-mono text-gray-900">${Math.round(l.monthly).toLocaleString()}</div>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3 bg-emerald-50">
          <span className="font-bold text-gray-900">Total Estimated</span>
          <span className="text-xl font-bold font-mono text-emerald-800">${Math.round(total).toLocaleString()}/mo</span>
        </div>
      </div>
      {note && <div className="px-4 py-2.5 bg-amber-50 text-xs text-amber-700 border-t border-amber-100">ⓘ {note}</div>}
      <div className="px-4 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
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
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-gray-700 text-white px-4 py-2.5 flex items-center gap-2">
        <span>📊</span>
        <span className="text-sm font-semibold">Industry Baselines — {tier}</span>
        <span className="text-xs text-gray-300 ml-auto">Typical ranges for your org size</span>
      </div>
      <div className="p-4 space-y-4 bg-white">
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
                <span className="font-medium text-gray-700">{r.label}</span>
                <span className={`font-semibold px-2 py-0.5 rounded-full text-[10px] ${inRange ? 'bg-green-100 text-green-700' : below ? 'bg-blue-100 text-blue-700' : current > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                  {current > 0 ? (inRange ? '✓ Typical' : below ? '↓ Below typical' : '↑ Above typical') : 'No scan data'}
                  {current > 0 ? ` · ${fmtNum(current)}${r.unit ? ` ${r.unit}` : ''}` : ''}
                </span>
              </div>
              <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
                <div className="absolute top-0 h-full bg-green-200" style={{ left: `${lowPct}%`, width: `${Math.max(0, highPct - lowPct)}%` }} />
                {current > 0 && <div className="absolute top-0 h-full w-1 bg-violet-600" style={{ left: `${currPct}%` }} />}
              </div>
              <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                <span>{fmtNum(r.low)}</span>
                <span className="text-green-600 text-center flex-1">typical range</span>
                <span>{fmtNum(r.high)}</span>
              </div>
            </div>
          );
        })}
        <div className="flex items-center gap-4 pt-1 border-t border-gray-100 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-4 h-2 bg-green-200 rounded inline-block border border-green-300" /> Typical range</span>
          <span className="flex items-center gap-1"><span className="w-1 h-3 bg-violet-600 rounded inline-block" /> Your value</span>
          <span className="ml-auto">Based on Datadog deployment patterns by org size</span>
        </div>
      </div>
    </div>
  );
}

// ─── NDM: Network Device Monitoring ──────────────────────────────────────────

function NDMCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [devices, setDevices] = useState(5000);
  const [interfaces, setInterfaces] = useState(12);
  const [pollSec, setPollSec] = useState('60');
  const [deviceMetrics, setDeviceMetrics] = useState(60);
  const [buffer, setBuffer] = useState(30);
  const [growthRate, setGrowthRate] = useState(20);

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

    return {
      poll, devPerAgent, baseAgents, totalAgents,
      metricsPerDevice, totalMetrics,
      agentCpuM, agentMemMi, totalCpuCores, totalMemGi,
      vmCpu, vmRamGb, bwMbps,
      d1: projDevices(1), d2: projDevices(2), d3: projDevices(3),
      a1: projAgents(projDevices(1)), a2: projAgents(projDevices(2)), a3: projAgents(projDevices(3)),
    };
  }, [devices, interfaces, pollSec, deviceMetrics, buffer, growthRate]);

  const ndmNdpIntegCount = scanData
    ? scanData.integrations.list.filter(i => ['snmp', 'network', 'ndm', 'cisco', 'juniper', 'palo_alto'].some(k => i.name.toLowerCase().includes(k))).length
    : 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔌" title="Network Device Monitoring Sizing" description="Size Datadog NDM agents for SNMP polling across your device fleet. Outputs K8s and VM deployment specs." />
      {scanData && (
        <ScanContext items={[
          { label: 'Agent Hosts', actual: fmtNum(scanData.infrastructure.totalHosts), note: 'eligible for NDM collector role' },
          { label: 'Network Integrations', actual: String(ndmNdpIntegCount), note: 'SNMP-related checks detected' },
          { label: 'Cloud Accounts', actual: String(scanData.infrastructure.cloudAccounts.length), note: 'network-connected clouds' },
        ]} />
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Fleet Configuration</h3>
          <SliderInput label="Network Devices" value={devices} min={10} max={100000} step={100} unit="devices" onChange={setDevices} log />
          <SliderInput label="Interfaces per Device" value={interfaces} min={1} max={200} unit="interfaces" hint="Average across fleet. Core switches: 48+, routers: 4-24, firewalls: 4-16" onChange={setInterfaces} />
          <SelectInput
            label="SNMP Poll Interval"
            value={pollSec}
            onChange={setPollSec}
            options={[
              { value: '30', label: '30 seconds (high-freq monitoring)' },
              { value: '60', label: '60 seconds (recommended)' },
              { value: '120', label: '2 minutes' },
              { value: '300', label: '5 minutes (large fleets)' },
              { value: '600', label: '10 minutes (capacity only)' },
            ]}
            hint={`At ${pollSec}s interval: up to ${fmtNum(c.devPerAgent)} devices per agent`}
          />
          <SliderInput label="Device-Level Metrics" value={deviceMetrics} min={10} max={300} unit="metrics/device" hint="CPU, memory, BGP peers, OSPF, HSRP, chassis metrics" onChange={setDeviceMetrics} />
          <SliderInput label="Agent Headroom Buffer" value={buffer} min={10} max={100} unit="%" hint="Extra agents for redundancy and traffic spikes" onChange={setBuffer} />
          <SliderInput label="Annual Device Growth" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
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

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Devices', baseline: devices, unit: '' },
        { label: 'Agents Required', baseline: c.totalAgents, unit: '' },
        { label: 'Total Metrics', baseline: c.totalMetrics, unit: '' },
        { label: 'K8s CPU (cores)', baseline: Number(c.totalCpuCores), unit: 'cores', formatter: (n) => n.toFixed(1) },
        { label: 'K8s Memory', baseline: Number(c.totalMemGi), unit: 'Gi', formatter: (n) => `${n.toFixed(0)}` },
      ]} />
    </div>
  );
}

// ─── Logs Calculator ──────────────────────────────────────────────────────────

function LogsCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [ingestGbDay, setIngestGbDay] = useState(50);
  const [indexRate, setIndexRate] = useState(15);
  const [retentionDays, setRetentionDays] = useState(15);
  const [flexRate, setFlexRate] = useState(0);
  const [pipelines, setPipelines] = useState(5);
  const [growthRate, setGrowthRate] = useState(30);

  const c = useMemo(() => {
    const eventsPerGb = 500000; // ~2KB/event compressed
    const eventsPerDay = ingestGbDay * eventsPerGb;
    const indexedPerDay = eventsPerDay * (indexRate / 100);
    const flexPerDay = eventsPerDay * (flexRate / 100);
    const droppedPerDay = eventsPerDay * ((100 - indexRate - flexRate) / 100);

    // Storage estimate (compressed indexed)
    const bytesPerIndexedEvent = 500; // compressed+indexed overhead
    const indexStorageGbPerDay = (indexedPerDay * bytesPerIndexedEvent) / 1e9;
    const totalIndexStorageGb = indexStorageGbPerDay * retentionDays;

    // Flex storage (object storage, ~5x cheaper storage but retrieval cost)
    const flexStorageGbPerDay = (flexPerDay * 200) / 1e9; // compressed for object storage
    const totalFlexStorageGb = flexStorageGbPerDay * 90; // flex usually 90d+

    const droppedPct = Math.max(0, 100 - indexRate - flexRate);

    return {
      eventsPerDay, indexedPerDay, flexPerDay, droppedPerDay,
      indexStorageGbPerDay, totalIndexStorageGb, totalFlexStorageGb,
      droppedPct, droppedRate: droppedPct,
    };
  }, [ingestGbDay, indexRate, flexRate, retentionDays, pipelines]);

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
      {scanData && (
        <ScanContext
          onLoad={() => {
            setPipelines(scanData.logs.pipelines || pipelines);
            if (avgRetention) setRetentionDays(avgRetention);
            setFlexRate(scanData.logs.flexIndexCount > 0 ? 20 : 0);
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

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Pipeline Configuration</h3>
          <SliderInput label="Daily Log Ingestion" value={ingestGbDay} min={1} max={10000} unit="GB / day" onChange={setIngestGbDay} log hint={`~${fmtNum(ingestGbDay * 500000)} events/day at 2KB avg`} />
          <SliderInput label="Online Index Rate" value={indexRate} min={0} max={100} unit="%" hint="Events sent to searchable online indexes" onChange={setIndexRate} />
          <SliderInput label="Flex Logs Rate" value={flexRate} min={0} max={Math.max(0, 100 - indexRate)} unit="%" hint="Events archived to Flex (cheap storage, on-demand rehydration)" onChange={setFlexRate} />
          <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-700 space-y-0.5">
            <div className="font-semibold">Routing summary</div>
            <div>Online indexed: <strong>{indexRate}%</strong> · Flex: <strong>{flexRate}%</strong> · Dropped/excluded: <strong>{Math.max(0, 100 - indexRate - flexRate)}%</strong></div>
          </div>
          <SliderInput label="Online Retention" value={retentionDays} min={3} max={365} unit="days" hint="Standard tiers: 3, 7, 15, 30, 45, 60, 90, 180, 365 days" onChange={setRetentionDays} />
          <SliderInput label="Processing Pipelines" value={pipelines} min={1} max={100} unit="pipelines" hint="Parsing, enrichment, and routing pipelines" onChange={setPipelines} />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Events / Day (total)" value={fmtNum(c.eventsPerDay)} sub={`${ingestGbDay} GB ingested`} color="gray" />
            <ResultCard label="Indexed Events / Day" value={fmtNum(c.indexedPerDay)} sub={`${indexRate}% of ingest`} color="violet" />
            <ResultCard label="Flex Events / Day" value={fmtNum(c.flexPerDay)} sub={`${flexRate}% to object storage`} color="blue" />
            <ResultCard label="Dropped / Day" value={fmtNum(c.droppedPerDay)} sub={`${c.droppedPct.toFixed(0)}% via exclusion filters`} color={c.droppedPct > 70 ? 'green' : 'amber'} />
          </div>

          <SizingBlock title="Storage Estimate" icon="💾" rows={[
            { label: 'Index storage / day', value: `${c.indexStorageGbPerDay.toFixed(1)} GB`, note: 'compressed + index overhead' },
            { label: `Total online storage (${retentionDays}d)`, value: `${c.totalIndexStorageGb.toFixed(0)} GB` },
            { label: 'Flex storage / day', value: `${((c.flexPerDay * 200) / 1e9).toFixed(2)} GB`, note: 'object storage (compressed)' },
            { label: 'Flex total (90d)', value: `${c.totalFlexStorageGb.toFixed(0)} GB`, note: 'S3/GCS/Azure Blob' },
          ]} />

          <SizingBlock title="Cost Levers" icon="💰" rows={[
            { label: 'Reduce index rate by 10%', value: `−${fmtNum(c.eventsPerDay * 0.1)} events/day`, note: 'add exclusion filters' },
            { label: 'Move 20% to Flex', value: `−${fmtNum(c.eventsPerDay * 0.2)} indexed events/day`, note: 'significant cost reduction' },
            { label: 'Shorten retention 30→7d', value: `~76% storage reduction`, note: 'evaluate with data teams' },
            { label: 'Pipelines active', value: `${pipelines} pipelines`, note: 'enrichment overhead' },
          ]} />
        </div>
      </div>

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Daily Ingestion', baseline: ingestGbDay, unit: 'GB/day' },
        { label: 'Indexed Events/Day', baseline: c.indexedPerDay, unit: '' },
        { label: 'Online Storage Total', baseline: c.totalIndexStorageGb, unit: 'GB', formatter: (n) => `${n.toFixed(0)}` },
        { label: 'Monthly Ingest', baseline: ingestGbDay * 30, unit: 'GB/mo' },
      ]} />
    </div>
  );
}

// ─── APM / Traces ─────────────────────────────────────────────────────────────

function APMCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [services, setServices] = useState(20);
  const [rps, setRps] = useState(100);
  const [spansPerTrace, setSpansPerTrace] = useState(8);
  const [samplingRate, setSamplingRate] = useState(10);
  const [indexedPct, setIndexedPct] = useState(5);
  const [retentionDays, setRetentionDays] = useState(15);
  const [growthRate, setGrowthRate] = useState(25);

  const c = useMemo(() => {
    const totalRps = services * rps;
    const ingestedSpansPerSec = totalRps * spansPerTrace * (samplingRate / 100);
    const ingestedSpansPerMin = ingestedSpansPerSec * 60;
    const ingestedGbPerDay = (ingestedSpansPerSec * 2000 * 86400) / 1e9; // ~2KB/span

    const indexedSpansPerMin = ingestedSpansPerMin * (indexedPct / 100);
    const indexedGbPerDay = (indexedSpansPerMin * 60 * 24 * 2000) / 1e9 * (indexedPct / 100);

    const retentionStorageGb = indexedGbPerDay * retentionDays;

    return {
      totalRps, ingestedSpansPerSec, ingestedSpansPerMin,
      ingestedGbPerDay, indexedSpansPerMin, indexedGbPerDay, retentionStorageGb,
    };
  }, [services, rps, spansPerTrace, samplingRate, indexedPct, retentionDays]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔍" title="APM & Traces Calculator" description="Estimate trace ingestion volume, indexed spans, and retention storage for your APM configuration." />
      {scanData && (
        <ScanContext
          onLoad={() => setServices(Math.max(1, scanData.apm.totalServices))}
          items={[
            { label: 'APM Services', actual: String(scanData.apm.totalServices), note: 'detected in scan' },
            { label: 'In Service Catalog', actual: String(scanData.apm.svcInCatalog), note: `${scanData.apm.totalServices > 0 ? Math.round(scanData.apm.svcInCatalog / scanData.apm.totalServices * 100) : 0}% coverage` },
            { label: 'With Monitor', actual: String(scanData.apm.svcWithMonitor), note: 'services monitored' },
            { label: 'With SLO', actual: String(scanData.apm.svcWithSLO), note: 'services with SLO' },
          ]}
        />
      )}
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">APM Configuration</h3>
          <SliderInput label="Services Instrumented" value={services} min={1} max={5000} unit="services" onChange={setServices} log />
          <SliderInput label="Requests per Second (avg per service)" value={rps} min={1} max={100000} unit="req/s" onChange={setRps} log hint="Across all environments (prod + staging)" />
          <SliderInput label="Spans per Trace" value={spansPerTrace} min={1} max={200} unit="spans" hint="Avg spans per distributed trace (entry → downstream calls)" onChange={setSpansPerTrace} />
          <SliderInput label="Ingestion Sampling Rate" value={samplingRate} min={1} max={100} unit="%" hint="% of traces ingested. 100% = full fidelity (highest cost)" onChange={setSamplingRate} />
          <SliderInput label="Indexed (Retention Filters)" value={indexedPct} min={0.1} max={100} step={0.1} unit="% of ingested" hint="Indexed spans are searchable & queryable long-term" onChange={setIndexedPct} />
          <SliderInput label="Retention Period" value={retentionDays} min={1} max={365} unit="days" onChange={setRetentionDays} />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Total RPS (all services)" value={fmtNum(c.totalRps)} sub="across fleet" color="gray" />
            <ResultCard label="Ingested Spans / min" value={fmtNum(c.ingestedSpansPerMin)} sub={`at ${samplingRate}% sampling`} color="violet" />
            <ResultCard label="Ingest Volume / day" value={`${c.ingestedGbPerDay.toFixed(1)} GB`} sub="before indexing" color="blue" />
            <ResultCard label="Indexed Spans / min" value={fmtNum(c.indexedSpansPerMin)} sub={`${indexedPct}% of ingested`} color={c.indexedSpansPerMin > 1e6 ? 'amber' : 'green'} />
          </div>

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

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Total RPS', baseline: c.totalRps, unit: 'req/s' },
        { label: 'Ingested Spans/min', baseline: c.ingestedSpansPerMin, unit: '' },
        { label: 'Daily Ingest', baseline: c.ingestedGbPerDay, unit: 'GB/day', formatter: (n) => n.toFixed(1) },
        { label: 'Monthly Ingest', baseline: c.ingestedGbPerDay * 30, unit: 'GB/mo', formatter: (n) => n.toFixed(0) },
      ]} />
    </div>
  );
}

// ─── Infrastructure ───────────────────────────────────────────────────────────

function InfraCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [hosts, setHosts] = useState(200);
  const [containersPerHost, setContainersPerHost] = useState(20);
  const [k8sNodes, setK8sNodes] = useState(50);
  const [podsPerNode, setPodsPerNode] = useState(30);
  const [cloudAccounts, setCloudAccounts] = useState(3);
  const [resourcesPerAccount, setResourcesPerAccount] = useState(500);
  const [allotmentPlan, setAllotmentPlan] = useState('100');
  const [growthRate, setGrowthRate] = useState(20);

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

    return {
      totalHosts, totalContainers, cmAllotment, cloudMetrics,
      infraMetrics, containerMetrics, totalMetrics, utilizationPct,
      totalAgentCpu, totalAgentMemGi,
    };
  }, [hosts, containersPerHost, k8sNodes, podsPerNode, cloudAccounts, resourcesPerAccount, allotmentPlan]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🖥" title="Infrastructure Sizing Calculator" description="Model host, container, and K8s allotment consumption. Estimate agent resource footprint across your fleet." />
      {scanData && (
        <ScanContext
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

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Fleet Composition</h3>
          <SliderInput label="Traditional Hosts (VMs/bare-metal)" value={hosts} min={0} max={50000} step={10} unit="hosts" onChange={setHosts} log />
          <SliderInput label="Containers per VM Host" value={containersPerHost} min={0} max={500} unit="containers" hint="Docker/ECS containers running on traditional hosts" onChange={setContainersPerHost} />
          <SliderInput label="Kubernetes Nodes" value={k8sNodes} min={0} max={10000} step={5} unit="nodes" onChange={setK8sNodes} log />
          <SliderInput label="Pods per K8s Node" value={podsPerNode} min={1} max={250} unit="pods" hint="Depends on node size. t3.large: ~30, m5.2xl: ~100" onChange={setPodsPerNode} />
          <SliderInput label="Cloud Accounts (AWS/GCP/Azure)" value={cloudAccounts} min={0} max={500} unit="accounts" onChange={setCloudAccounts} />
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
          />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Total Host Count" value={fmtNum(c.totalHosts)} sub={`${hosts} VMs + ${k8sNodes} K8s nodes`} color="violet" />
            <ResultCard label="Total Containers" value={fmtNum(c.totalContainers)} sub={`${containersPerHost}/host + ${podsPerNode} pods/node`} color="blue" />
            <ResultCard label="CM Allotment" value={fmtNum(c.cmAllotment)} sub={`${allotmentPlan}/host plan`} color="gray" />
            <ResultCard label="Est. Custom Metrics" value={fmtNum(c.totalMetrics)} sub={`${c.utilizationPct}% of allotment`} color={c.utilizationPct > 90 ? 'red' : c.utilizationPct > 70 ? 'amber' : 'green'} />
          </div>

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

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Total Hosts', baseline: c.totalHosts, unit: '' },
        { label: 'Total Containers', baseline: c.totalContainers, unit: '' },
        { label: 'Est. Custom Metrics', baseline: c.totalMetrics, unit: '' },
        { label: 'CM Allotment', baseline: c.cmAllotment, unit: '' },
      ]} />
    </div>
  );
}

// ─── RUM ──────────────────────────────────────────────────────────────────────

function RUMCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [mau, setMau] = useState(100000);
  const [sessionsPerUser, setSessionsPerUser] = useState(4);
  const [pageviewsPerSession, setPageviewsPerSession] = useState(8);
  const [replayRate, setReplayRate] = useState(5);
  const [mobileUsers, setMobileUsers] = useState(30);
  const [errorTracking, setErrorTracking] = useState(true);
  const [growthRate, setGrowthRate] = useState(35);

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

    return {
      totalSessions, browserSessions, mobileSessions, replaySessions,
      totalPageviews, totalActions, errorsTracked, replayStorageGb,
    };
  }, [mau, sessionsPerUser, pageviewsPerSession, replayRate, mobileUsers]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="👤" title="RUM & Session Calculator" description="Estimate session volumes, replay coverage, and data footprint for Browser and Mobile RUM." />
      {scanData?.rum && (
        <ScanContext
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

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">User Traffic</h3>
          <SliderInput label="Monthly Active Users (MAU)" value={mau} min={1000} max={50000000} unit="users/mo" onChange={setMau} log />
          <SliderInput label="Sessions per User / Month" value={sessionsPerUser} min={1} max={100} unit="sessions" hint="A session = 15 min of continuous activity" onChange={setSessionsPerUser} />
          <SliderInput label="Page Views per Session" value={pageviewsPerSession} min={1} max={100} unit="pageviews" onChange={setPageviewsPerSession} />
          <SliderInput label="Mobile Users" value={mobileUsers} min={0} max={100} unit="%" hint="Mobile SDK sessions billed separately" onChange={setMobileUsers} />
          <SliderInput label="Session Replay Rate" value={replayRate} min={0} max={100} unit="% of browser sessions" hint="100% = full fidelity but highest data volume. 5-10% typical." onChange={setReplayRate} />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Total Sessions / Month" value={fmtNum(c.totalSessions)} sub={`${fmtNum(mau)} MAU × ${sessionsPerUser} sessions`} color="violet" />
            <ResultCard label="Replay Sessions / Month" value={fmtNum(c.replaySessions)} sub={`${replayRate}% of browser sessions`} color={replayRate > 30 ? 'amber' : 'blue'} />
            <ResultCard label="Page Views / Month" value={fmtNum(c.totalPageviews)} sub={`${pageviewsPerSession} views/session`} color="gray" />
            <ResultCard label="Replay Storage" value={`${c.replayStorageGb.toFixed(0)} GB/mo`} sub="~2MB per replay session" color="gray" />
          </div>

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

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'MAU', baseline: mau, unit: 'users' },
        { label: 'Sessions / Month', baseline: c.totalSessions, unit: '' },
        { label: 'Replay Sessions / Month', baseline: c.replaySessions, unit: '' },
        { label: 'Page Views / Month', baseline: c.totalPageviews, unit: '' },
      ]} />
    </div>
  );
}

// ─── Synthetics ───────────────────────────────────────────────────────────────

function SyntheticsCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [apiTests, setApiTests] = useState(50);
  const [apiLocations, setApiLocations] = useState(3);
  const [apiFreqMin, setApiFreqMin] = useState(5);
  const [browserTests, setBrowserTests] = useState(20);
  const [browserLocations, setBrowserLocations] = useState(2);
  const [browserFreqMin, setBrowserFreqMin] = useState(60);
  const [multiStepTests, setMultiStepTests] = useState(10);
  const [stepsPerTest, setStepsPerTest] = useState(5);
  const [growthRate, setGrowthRate] = useState(20);

  const c = useMemo(() => {
    const apiRunsPerMonth = apiTests * apiLocations * (30 * 24 * 60 / apiFreqMin);
    const browserRunsPerMonth = browserTests * browserLocations * (30 * 24 * 60 / browserFreqMin);
    const multiStepRunsPerMonth = multiStepTests * 2 * (30 * 24 * 60 / 15); // 2 locations, 15 min
    const multiStepChecksPerMonth = multiStepRunsPerMonth * stepsPerTest;
    const totalRunsPerMonth = apiRunsPerMonth + browserRunsPerMonth + multiStepRunsPerMonth;

    // Browser step estimate (~5 steps per browser test)
    const browserStepsPerMonth = browserRunsPerMonth * 5;

    return {
      apiRunsPerMonth, browserRunsPerMonth, multiStepRunsPerMonth,
      multiStepChecksPerMonth, totalRunsPerMonth, browserStepsPerMonth,
    };
  }, [apiTests, apiLocations, apiFreqMin, browserTests, browserLocations, browserFreqMin, multiStepTests, stepsPerTest]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🧪" title="Synthetics Test Calculator" description="Estimate monthly test runs, browser steps, and optimization opportunities across your Synthetics suite." />
      {scanData && (scanData.synthetics.apiTests + scanData.synthetics.browserTests) > 0 && (
        <ScanContext
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

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Test Configuration</h3>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-1">API Tests</div>
          <SliderInput label="API Tests" value={apiTests} min={0} max={10000} unit="tests" onChange={setApiTests} />
          <SliderInput label="Locations per API Test" value={apiLocations} min={1} max={30} unit="locations" onChange={setApiLocations} />
          <SliderInput label="API Test Frequency" value={apiFreqMin} min={1} max={1440} unit="min interval" hint="1min = highest frequency; 60min = hourly" onChange={setApiFreqMin} />
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-1 border-t border-gray-100">Browser Tests</div>
          <SliderInput label="Browser Tests" value={browserTests} min={0} max={5000} unit="tests" onChange={setBrowserTests} />
          <SliderInput label="Locations per Browser Test" value={browserLocations} min={1} max={20} unit="locations" onChange={setBrowserLocations} />
          <SliderInput label="Browser Test Frequency" value={browserFreqMin} min={5} max={1440} unit="min interval" hint="60min typical; browser tests are expensive, run less frequently" onChange={setBrowserFreqMin} />
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-1 border-t border-gray-100">Multi-Step API</div>
          <SliderInput label="Multi-Step API Tests" value={multiStepTests} min={0} max={2000} unit="tests" onChange={setMultiStepTests} />
          <SliderInput label="Steps per Multi-Step Test" value={stepsPerTest} min={2} max={50} unit="steps" hint="Billed per step, not per run" onChange={setStepsPerTest} />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="API Runs / Month" value={fmtNum(c.apiRunsPerMonth)} sub={`${apiTests} tests × ${apiLocations} loc`} color="violet" />
            <ResultCard label="Browser Runs / Month" value={fmtNum(c.browserRunsPerMonth)} sub={`${browserTests} tests × ${browserLocations} loc`} color="blue" />
            <ResultCard label="Browser Steps / Month" value={fmtNum(c.browserStepsPerMonth)} sub="~5 steps avg per run" color="amber" />
            <ResultCard label="Total Runs / Month" value={fmtNum(c.totalRunsPerMonth)} sub="all test types" color="gray" />
          </div>

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

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'API Runs / Month', baseline: c.apiRunsPerMonth, unit: '' },
        { label: 'Browser Runs / Month', baseline: c.browserRunsPerMonth, unit: '' },
        { label: 'Browser Steps / Month', baseline: c.browserStepsPerMonth, unit: '' },
        { label: 'Total Runs / Month', baseline: c.totalRunsPerMonth, unit: '' },
      ]} />
    </div>
  );
}

// ─── Custom Metrics ───────────────────────────────────────────────────────────

function MetricsCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [services, setServices] = useState(30);
  const [metricsPerService, setMetricsPerService] = useState(50);
  const [avgTags, setAvgTags] = useState(5);
  const [avgCardinalityPerTag, setAvgCardinalityPerTag] = useState(10);
  const [hosts, setHosts] = useState(100);
  const [allotmentPerHost, setAllotmentPerHost] = useState(100);
  const [thirdPartyIntegrations, setThirdPartyIntegrations] = useState(10);
  const [metricsPerIntegration, setMetricsPerIntegration] = useState(200);
  const [growthRate, setGrowthRate] = useState(20);

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

    return { serviceMetrics, integMetrics, totalMetrics, allotment, onDemand, utilizationPct, perMetricCardinality };
  }, [services, metricsPerService, avgTags, avgCardinalityPerTag, hosts, allotmentPerHost, thirdPartyIntegrations, metricsPerIntegration]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="📈" title="Custom Metrics Calculator" description="Model custom metric cardinality, allotment utilization, and on-demand risk from services and integrations." />
      {scanData && (
        <ScanContext
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

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Metric Sources</h3>
          <SliderInput label="Application Services" value={services} min={1} max={5000} unit="services" onChange={setServices} />
          <SliderInput label="Custom Metrics per Service" value={metricsPerService} min={1} max={1000} unit="metrics" hint="Business + technical metrics emitted per service" onChange={setMetricsPerService} />
          <SliderInput label="Tags per Metric (avg)" value={avgTags} min={1} max={15} unit="tags" hint="Tags multiply cardinality exponentially" onChange={setAvgTags} />
          <SliderInput label="Cardinality per Tag (avg)" value={avgCardinalityPerTag} min={2} max={10000} unit="values" hint="env:3, service:50, region:5, version:10..." onChange={setAvgCardinalityPerTag} log />
          <div className="border-t border-gray-100 pt-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Allotment</div>
          <SliderInput label="Infrastructure Hosts" value={hosts} min={0} max={50000} unit="hosts" onChange={setHosts} />
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
          <div className="border-t border-gray-100 pt-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Integrations</div>
          <SliderInput label="3rd-Party Integrations" value={thirdPartyIntegrations} min={0} max={500} unit="integrations" onChange={setThirdPartyIntegrations} />
          <SliderInput label="Metrics per Integration (avg)" value={metricsPerIntegration} min={10} max={5000} unit="metrics" onChange={setMetricsPerIntegration} />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Service Metrics" value={fmtNum(c.serviceMetrics)} sub={`${services} svc × ${metricsPerService} metrics × cardinality`} color="violet" />
            <ResultCard label="Integration Metrics" value={fmtNum(c.integMetrics)} sub={`${thirdPartyIntegrations} integrations`} color="blue" />
            <ResultCard label="Total Custom Metrics" value={fmtNum(c.totalMetrics)} sub="estimated unique timeseries" color={c.utilizationPct > 100 ? 'red' : c.utilizationPct > 80 ? 'amber' : 'green'} />
            <ResultCard label="Allotment" value={fmtNum(c.allotment)} sub={`${allotmentPerHost}/host × ${fmtNum(hosts)} hosts`} color="gray" />
          </div>

          {c.onDemand > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="text-sm font-bold text-red-700 mb-1">⚠ On-Demand Overage Detected</div>
              <div className="text-sm text-red-600">{fmtNum(c.onDemand)} metrics ({c.utilizationPct - 100}% over allotment) will incur on-demand charges.</div>
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

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Total Custom Metrics', baseline: c.totalMetrics, unit: '' },
        { label: 'Allotment', baseline: c.allotment, unit: '' },
        { label: 'On-Demand Overage', baseline: Math.max(0, c.onDemand), unit: '' },
      ]} />
    </div>
  );
}

// ─── NPM: Network Performance Monitoring ──────────────────────────────────────

function NPMCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [hostsMonitored, setHostsMonitored] = useState(200);
  const [avgConnectionsPerHost, setAvgConnectionsPerHost] = useState(500);
  const [flowsPerSec, setFlowsPerSec] = useState(10000);
  const [retentionDays, setRetentionDays] = useState(7);
  const [ebpfEnabled, setEbpfEnabled] = useState(true);
  const [growthRate, setGrowthRate] = useState(20);

  const c = useMemo(() => {
    const totalConnections = hostsMonitored * avgConnectionsPerHost;
    const flowsPerMin = flowsPerSec * 60;
    const dataGbPerDay = (flowsPerSec * 200 * 86400) / 1e9; // ~200 bytes per flow record
    const totalStorageGb = dataGbPerDay * retentionDays;

    // Agent overhead per host
    const agentCpuPct = ebpfEnabled ? 3 : 1; // % CPU overhead
    const agentMemMb = ebpfEnabled ? 150 : 50;

    return { totalConnections, flowsPerMin, dataGbPerDay, totalStorageGb, agentCpuPct, agentMemMb };
  }, [hostsMonitored, avgConnectionsPerHost, flowsPerSec, retentionDays, ebpfEnabled]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🌊" title="Network Performance Monitoring (NPM)" description="Estimate NPM flow data volume, connection tracking, and agent resource overhead for your host fleet." />
      {scanData && (
        <ScanContext
          onLoad={() => setHostsMonitored(Math.max(1, scanData.infrastructure.totalHosts))}
          items={[
            { label: 'Agent Hosts', actual: String(scanData.infrastructure.totalHosts), note: 'eligible for NPM' },
            { label: 'NPM Integration', actual: scanData.integrations.list.some(i => i.name.toLowerCase().includes('network')) ? 'Detected' : 'Not detected', note: 'network check active' },
          ]}
        />
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">NPM Configuration</h3>
          <SliderInput label="Hosts with NPM Agent" value={hostsMonitored} min={1} max={50000} unit="hosts" onChange={setHostsMonitored} log />
          <SliderInput label="Active Connections per Host" value={avgConnectionsPerHost} min={10} max={50000} unit="connections" hint="Active TCP/UDP connections tracked simultaneously" onChange={setAvgConnectionsPerHost} log />
          <SliderInput label="Network Flows per Second" value={flowsPerSec} min={100} max={10000000} unit="flows/sec" hint="Total across all monitored hosts" onChange={setFlowsPerSec} log />
          <SliderInput label="Data Retention" value={retentionDays} min={1} max={90} unit="days" onChange={setRetentionDays} />
          <div className="flex items-center gap-3">
            <input type="checkbox" id="ebpf" checked={ebpfEnabled} onChange={(e) => setEbpfEnabled(e.target.checked)} className="accent-violet-600" />
            <label htmlFor="ebpf" className="text-sm text-gray-700">eBPF kernel-level tracing (higher fidelity, more overhead)</label>
          </div>
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
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

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Hosts Monitored', baseline: hostsMonitored, unit: '' },
        { label: 'Flows / Second', baseline: flowsPerSec, unit: 'flows/s' },
        { label: 'Data / Day', baseline: c.dataGbPerDay, unit: 'GB/day', formatter: (n) => n.toFixed(1) },
        { label: 'Storage Total', baseline: c.totalStorageGb, unit: 'GB', formatter: (n) => n.toFixed(0) },
      ]} />
    </div>
  );
}

// ─── Cloud Integration Metrics ────────────────────────────────────────────────

function CloudCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [awsAccounts, setAwsAccounts] = useState(5);
  const [ec2Instances, setEc2Instances] = useState(200);
  const [rdsInstances, setRdsInstances] = useState(20);
  const [lambdaFunctions, setLambdaFunctions] = useState(100);
  const [gcpProjects, setGcpProjects] = useState(2);
  const [gceInstances, setGceInstances] = useState(50);
  const [azureSubscriptions, setAzureSubscriptions] = useState(1);
  const [azureVms, setAzureVms] = useState(30);
  const [growthRate, setGrowthRate] = useState(25);

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

    return { awsMetrics, gcpMetrics, azureMetrics, totalMetrics, hostEquiv };
  }, [awsAccounts, ec2Instances, rdsInstances, lambdaFunctions, gcpProjects, gceInstances, azureSubscriptions, azureVms]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="☁" title="Cloud Integration Metrics Calculator" description="Estimate CloudWatch, GCP Monitoring, and Azure Monitor metric volumes from your cloud footprint." />
      {scanData && scanData.infrastructure.cloudAccounts.length > 0 && (
        <ScanContext
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

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Cloud Resources</h3>
          <div className="text-xs font-semibold text-gray-500 uppercase pt-1">AWS</div>
          <SliderInput label="AWS Accounts" value={awsAccounts} min={0} max={500} unit="accounts" onChange={setAwsAccounts} />
          <SliderInput label="EC2 Instances (per account)" value={ec2Instances} min={0} max={10000} unit="instances" onChange={setEc2Instances} log />
          <SliderInput label="RDS Instances (per account)" value={rdsInstances} min={0} max={1000} unit="instances" onChange={setRdsInstances} />
          <SliderInput label="Lambda Functions (per account)" value={lambdaFunctions} min={0} max={10000} unit="functions" onChange={setLambdaFunctions} log />
          <div className="text-xs font-semibold text-gray-500 uppercase pt-1 border-t border-gray-100">GCP</div>
          <SliderInput label="GCP Projects" value={gcpProjects} min={0} max={200} unit="projects" onChange={setGcpProjects} />
          <SliderInput label="GCE Instances (per project)" value={gceInstances} min={0} max={5000} unit="instances" onChange={setGceInstances} log />
          <div className="text-xs font-semibold text-gray-500 uppercase pt-1 border-t border-gray-100">Azure</div>
          <SliderInput label="Azure Subscriptions" value={azureSubscriptions} min={0} max={100} unit="subscriptions" onChange={setAzureSubscriptions} />
          <SliderInput label="Azure VMs (per subscription)" value={azureVms} min={0} max={5000} unit="VMs" onChange={setAzureVms} log />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
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

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'AWS Metrics', baseline: c.awsMetrics, unit: '' },
        { label: 'GCP Metrics', baseline: c.gcpMetrics, unit: '' },
        { label: 'Azure Metrics', baseline: c.azureMetrics, unit: '' },
        { label: 'Total Cloud Metrics', baseline: c.totalMetrics, unit: '' },
        { label: 'Cloud Host Equivalents', baseline: c.hostEquiv, unit: '' },
      ]} />
    </div>
  );
}

// ─── CSPM / Security ──────────────────────────────────────────────────────────

function CSPMCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [cloudResources, setCloudResources] = useState(1000);
  const [k8sClusters, setK8sClusters] = useState(5);
  const [nodesPerCluster, setNodesPerCluster] = useState(20);
  const [hostsScanned, setHostsScanned] = useState(200);
  const [scanFreqHours, setScanFreqHours] = useState(4);
  const [growthRate, setGrowthRate] = useState(20);

  const c = useMemo(() => {
    const totalNodes = k8sClusters * nodesPerCluster;
    const scansPerDay = 24 / scanFreqHours;
    const cloudScansPerDay = cloudResources * scansPerDay;
    const hostScansPerDay = hostsScanned * scansPerDay;
    const k8sScansPerDay = totalNodes * scansPerDay;
    const totalScansPerDay = cloudScansPerDay + hostScansPerDay + k8sScansPerDay;

    // Findings estimate: ~5% misconfiguration rate
    const findingsEstimate = Math.round(totalScansPerDay * 0.05);

    return { totalNodes, scansPerDay, cloudScansPerDay, hostScansPerDay, k8sScansPerDay, totalScansPerDay, findingsEstimate };
  }, [cloudResources, k8sClusters, nodesPerCluster, hostsScanned, scanFreqHours]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🛡" title="CSPM / Security Posture Calculator" description="Estimate cloud, host, and container security posture scan coverage and findings volume." />
      {scanData && (
        <ScanContext
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

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Scan Scope</h3>
          <SliderInput label="Cloud Resources Scanned" value={cloudResources} min={10} max={500000} unit="resources" hint="S3, EC2, IAM, RDS, GCS, etc." onChange={setCloudResources} log />
          <SliderInput label="Kubernetes Clusters" value={k8sClusters} min={0} max={500} unit="clusters" onChange={setK8sClusters} />
          <SliderInput label="Nodes per Cluster (avg)" value={nodesPerCluster} min={1} max={1000} unit="nodes" onChange={setNodesPerCluster} />
          <SliderInput label="Hosts Scanned (CWS/CSPM)" value={hostsScanned} min={0} max={50000} unit="hosts" onChange={setHostsScanned} log />
          <SliderInput label="Scan Frequency" value={scanFreqHours} min={1} max={24} unit="hours" hint="1hr = continuous posture; 24hr = daily batch" onChange={setScanFreqHours} />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
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

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Cloud Resources', baseline: cloudResources, unit: '' },
        { label: 'K8s Nodes', baseline: c.totalNodes, unit: '' },
        { label: 'Total Checks/day', baseline: c.totalScansPerDay, unit: '' },
      ]} />
    </div>
  );
}

// ─── DBM: Database Monitoring ─────────────────────────────────────────────────

function DBMCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [postgresInstances, setPostgresInstances] = useState(10);
  const [mysqlInstances, setMysqlInstances] = useState(5);
  const [sqlServerInstances, setSqlServerInstances] = useState(2);
  const [queriesPerSec, setQueriesPerSec] = useState(500);
  const [avgNormalizedQueries, setAvgNormalizedQueries] = useState(200);
  const [retentionDays, setRetentionDays] = useState(15);
  const [growthRate, setGrowthRate] = useState(15);

  const c = useMemo(() => {
    const totalInstances = postgresInstances + mysqlInstances + sqlServerInstances;
    const totalQps = totalInstances * queriesPerSec;
    const samplesPerMin = totalInstances * 10; // agent samples every 10s
    const explainPlansPerHour = totalInstances * avgNormalizedQueries;
    const metricsPerInstance = 150; // wait events, connections, cache hit, etc.
    const totalMetrics = totalInstances * metricsPerInstance;
    const dataGbPerDay = (totalQps * 500 * 86400) / 1e9; // ~500 bytes per query sample

    return { totalInstances, totalQps, samplesPerMin, explainPlansPerHour, totalMetrics, dataGbPerDay };
  }, [postgresInstances, mysqlInstances, sqlServerInstances, queriesPerSec, avgNormalizedQueries, retentionDays]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🗄" title="Database Monitoring (DBM) Calculator" description="Estimate query sample volume, explain plan coverage, and metric output from your database fleet." />
      {scanData && (() => {
        const dbChecks = ['postgres', 'mysql', 'sqlserver', 'oracle', 'mongodb', 'redis'].filter(db =>
          scanData.integrations.list.some(i => i.name.toLowerCase().includes(db))
        );
        return dbChecks.length > 0 ? (
          <ScanContext
            onLoad={() => {
              const pg = scanData.integrations.list.filter(i => i.name.toLowerCase().includes('postgres')).length;
              const my = scanData.integrations.list.filter(i => i.name.toLowerCase().includes('mysql')).length;
              if (pg > 0) setPostgresInstances(pg);
              if (my > 0) setMysqlInstances(my);
            }}
            items={dbChecks.map(db => ({
              label: db.charAt(0).toUpperCase() + db.slice(1),
              actual: String(scanData.integrations.list.filter(i => i.name.toLowerCase().includes(db)).length),
              note: 'check instances detected',
            }))}
          />
        ) : null;
      })()}

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Database Fleet</h3>
          <SliderInput label="PostgreSQL Instances" value={postgresInstances} min={0} max={5000} unit="instances" onChange={setPostgresInstances} />
          <SliderInput label="MySQL / MariaDB Instances" value={mysqlInstances} min={0} max={5000} unit="instances" onChange={setMysqlInstances} />
          <SliderInput label="SQL Server Instances" value={sqlServerInstances} min={0} max={2000} unit="instances" onChange={setSqlServerInstances} />
          <SliderInput label="Queries per Second (avg per instance)" value={queriesPerSec} min={1} max={100000} unit="QPS" onChange={setQueriesPerSec} log hint="DBM captures samples, not every query" />
          <SliderInput label="Normalized Unique Queries (per instance)" value={avgNormalizedQueries} min={10} max={10000} unit="unique queries" hint="After query normalization/deduplication" onChange={setAvgNormalizedQueries} log />
          <SliderInput label="Query Retention" value={retentionDays} min={1} max={90} unit="days" onChange={setRetentionDays} />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <ResultCard label="Total DB Instances" value={String(c.totalInstances)} sub={`${postgresInstances} PG · ${mysqlInstances} MySQL · ${sqlServerInstances} MSSQL`} color="violet" />
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

      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Total DB Instances', baseline: c.totalInstances, unit: '' },
        { label: 'Total QPS', baseline: c.totalQps, unit: 'req/s' },
        { label: 'DBM Metrics', baseline: c.totalMetrics, unit: '' },
        { label: 'Data / Day', baseline: c.dataGbPerDay, unit: 'GB/day', formatter: (n) => n.toFixed(2) },
      ]} />
    </div>
  );
}

// ─── CI Pipeline Visibility ───────────────────────────────────────────────────

function CIVisibilityCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [committers, setCommitters] = useState(50);
  const [pipelinesPerDay, setPipelinesPerDay] = useState(200);
  const [testsPerPipeline, setTestsPerPipeline] = useState(500);
  const [avgPipelineDurationMin, setAvgPipelineDurationMin] = useState(8);
  const [retentionDays, setRetentionDays] = useState(30);
  const [growthRate, setGrowthRate] = useState(25);

  const c = useMemo(() => {
    const runsPerMonth = pipelinesPerDay * 30;
    const testRunsPerMonth = runsPerMonth * testsPerPipeline;
    const spanDataGbPerDay = (pipelinesPerDay * testsPerPipeline * 800) / 1e9; // ~800 bytes per test span
    const spanDataGbPerMonth = spanDataGbPerDay * 30;
    const retentionStorageGb = spanDataGbPerDay * retentionDays;
    const avgPipelineMinPerDay = pipelinesPerDay * avgPipelineDurationMin;
    return { runsPerMonth, testRunsPerMonth, spanDataGbPerDay, spanDataGbPerMonth, retentionStorageGb, avgPipelineMinPerDay };
  }, [pipelinesPerDay, testsPerPipeline, avgPipelineDurationMin, retentionDays]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔧" title="CI Pipeline Visibility Calculator" description="Estimate pipeline run volume, test span data, and storage for CI Visibility and Test Optimization." />
      {scanData && (
        <ScanContext
          onLoad={() => {
            if (scanData.apm.totalServices > 0) setCommitters(Math.max(5, Math.round(scanData.apm.totalServices * 2)));
          }}
          items={[
            { label: 'APM Services', actual: String(scanData.apm.totalServices), note: 'proxy for team size' },
            { label: 'Dev Team', actual: scanData.governance.userCount ? String(scanData.governance.userCount) : '—', note: 'DD users (includes non-devs)' },
          ]}
        />
      )}
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">CI Configuration</h3>
          <SliderInput label="Active Committers" value={committers} min={1} max={10000} unit="developers" hint="Datadog CI Visibility is billed per committer per month" onChange={setCommitters} log />
          <SliderInput label="Pipeline Runs per Day" value={pipelinesPerDay} min={1} max={100000} unit="runs/day" hint="Across all repos and branches (CI + CD pipelines)" onChange={setPipelinesPerDay} log />
          <SliderInput label="Tests per Pipeline Run" value={testsPerPipeline} min={1} max={100000} unit="tests" hint="Unit + integration tests executed per run" onChange={setTestsPerPipeline} log />
          <SliderInput label="Avg Pipeline Duration" value={avgPipelineDurationMin} min={1} max={240} unit="minutes" hint="Affects wall-clock data and span density" onChange={setAvgPipelineDurationMin} />
          <SliderInput label="Data Retention" value={retentionDays} min={7} max={365} unit="days" onChange={setRetentionDays} />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
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
            { label: 'Primary billing unit', value: 'per committer/month', note: 'active code contributors' },
            { label: 'Test Optimization add-on', value: 'per committer/month', note: 'flaky test detection, AI recommendations' },
            { label: 'Data retention', value: `${retentionDays}d`, note: 'pipeline + test trace retention' },
            { label: 'Private locations', value: 'included', note: 'on-prem CI agents supported' },
          ]} />
        </div>
      </div>
      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Committers', baseline: committers, unit: '' },
        { label: 'Pipeline Runs / Month', baseline: c.runsPerMonth, unit: '' },
        { label: 'Test Runs / Month', baseline: c.testRunsPerMonth, unit: '' },
        { label: 'Span Data / Month', baseline: c.spanDataGbPerMonth, unit: 'GB', formatter: (n) => n.toFixed(1) },
      ]} />
    </div>
  );
}

// ─── Continuous Profiler ──────────────────────────────────────────────────────

function ProfilerCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [profiledHosts, setProfiledHosts] = useState(50);
  const [profilesPerHostPerHour, setProfilesPerHostPerHour] = useState(6);
  const [avgProfileSizeMb, setAvgProfileSizeMb] = useState(0.5);
  const [retentionDays, setRetentionDays] = useState(30);
  const [growthRate, setGrowthRate] = useState(20);

  const c = useMemo(() => {
    const profilesPerDay = profiledHosts * profilesPerHostPerHour * 24;
    const profilesPerMonth = profilesPerDay * 30;
    const storageGbPerDay = (profilesPerDay * avgProfileSizeMb) / 1024;
    const retentionStorageGb = storageGbPerDay * retentionDays;
    const agentOverheadPctCpu = 1.5;
    const agentOverheadMb = 120;
    return { profilesPerDay, profilesPerMonth, storageGbPerDay, retentionStorageGb, agentOverheadPctCpu, agentOverheadMb };
  }, [profiledHosts, profilesPerHostPerHour, avgProfileSizeMb, retentionDays]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="⚡" title="Continuous Profiler Calculator" description="Estimate profiling data volume and storage for always-on CPU, memory, and lock profiling across your fleet." />
      {scanData && (
        <ScanContext
          onLoad={() => setProfiledHosts(Math.max(1, Math.round(scanData.infrastructure.totalHosts * 0.5)))}
          items={[
            { label: 'Total Hosts', actual: String(scanData.infrastructure.totalHosts), note: 'eligible for profiling' },
            { label: 'APM Services', actual: String(scanData.apm.totalServices), note: 'services to profile' },
            { label: 'Recommended coverage', actual: `${Math.round(scanData.infrastructure.totalHosts * 0.5)}`, note: 'start with 50% of hosts' },
          ]}
        />
      )}
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Profiler Configuration</h3>
          <SliderInput label="Profiled Hosts / Containers" value={profiledHosts} min={1} max={50000} unit="hosts" hint="Continuous Profiler billed per profiled host/container per hour" onChange={setProfiledHosts} log />
          <SliderInput label="Profiles per Host per Hour" value={profilesPerHostPerHour} min={1} max={60} unit="profiles/hr" hint="Default: 1 profile/min per language (6/hr). CPU + memory = 2×." onChange={setProfilesPerHostPerHour} />
          <SliderInput label="Avg Profile Size" value={avgProfileSizeMb} min={0.1} max={10} step={0.1} unit="MB" hint="Flame graph data. JVM heaps are larger (~2-5MB)." onChange={setAvgProfileSizeMb} />
          <SliderInput label="Retention" value={retentionDays} min={1} max={365} unit="days" hint="Standard: 30 days. Extended retention available." onChange={setRetentionDays} />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
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
      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Profiled Hosts', baseline: profiledHosts, unit: '' },
        { label: 'Profiles / Month', baseline: c.profilesPerMonth, unit: '' },
        { label: 'Storage / Month', baseline: c.storageGbPerDay * 30, unit: 'GB', formatter: (n) => n.toFixed(0) },
      ]} />
    </div>
  );
}

// ─── Observability Pipelines (OPW) ────────────────────────────────────────────

function OPWCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [dailyIngestGb, setDailyIngestGb] = useState(100);
  const [filterDropPct, setFilterDropPct] = useState(40);
  const [routeToMultipleDest, setRouteToMultipleDest] = useState(2);
  const [transformationComplexity, setTransformationComplexity] = useState('medium');
  const [growthRate, setGrowthRate] = useState(30);

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
    return { outboundGb, gbThroughOPW, savingsGbPerDay, savingsPct, workersNeeded, workerCpuCores, workerMemGb };
  }, [dailyIngestGb, filterDropPct, routeToMultipleDest, transformationComplexity]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔀" title="Observability Pipelines (OPW)" description="Size OPW workers for log routing, filtering, and transformation. Compare inbound vs outbound data costs." />
      {scanData && (
        <ScanContext
          items={[
            { label: 'Log Indexes', actual: String(scanData.logs.totalIndexes), note: 'potential OPW destinations' },
            { label: 'Pipelines', actual: String(scanData.logs.pipelines), note: 'existing DD pipelines' },
            { label: 'Excl. Filters', actual: String(scanData.logs.totalExclusionFilters), note: 'current filtering in place' },
            { label: 'Rate Limited', actual: String(scanData.logs.rateLimitedCount), note: scanData.logs.rateLimitedCount > 0 ? 'OPW can help cap' : 'none' },
          ]}
        />
      )}
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Pipeline Configuration</h3>
          <SliderInput label="Daily Inbound Volume" value={dailyIngestGb} min={1} max={50000} unit="GB / day" hint="Total log/metric/trace data entering OPW" onChange={setDailyIngestGb} log />
          <SliderInput label="Filter / Drop Rate" value={filterDropPct} min={0} max={90} unit="% dropped" hint="Events dropped by OPW filters before forwarding" onChange={setFilterDropPct} />
          <SliderInput label="Fan-out Destinations" value={routeToMultipleDest} min={1} max={10} unit="destinations" hint="Same data routed to multiple sinks (SIEM, S3, Datadog)" onChange={setRouteToMultipleDest} />
          <SelectInput
            label="Transformation Complexity"
            value={transformationComplexity}
            onChange={setTransformationComplexity}
            options={[
              { value: 'low', label: 'Low — filter-only, no enrichment' },
              { value: 'medium', label: 'Medium — parse + remap fields' },
              { value: 'high', label: 'High — regex, Lua, geo enrichment' },
            ]}
            hint="Affects worker CPU needs and throughput"
          />
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
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
      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Inbound / Day', baseline: dailyIngestGb, unit: 'GB/day' },
        { label: 'Outbound / Day', baseline: c.outboundGb, unit: 'GB/day', formatter: (n) => n.toFixed(0) },
        { label: 'Workers', baseline: c.workersNeeded, unit: '' },
        { label: 'Monthly Inbound', baseline: dailyIngestGb * 30, unit: 'GB/mo' },
      ]} />
    </div>
  );
}

// ─── Application Security (ASM) ───────────────────────────────────────────────

function ASMCalculator({ scanData }: { scanData?: AnalyticsData }) {
  const [protectedServices, setProtectedServices] = useState(20);
  const [requestsPerSec, setRequestsPerSec] = useState(1000);
  const [threatEventPct, setThreatEventPct] = useState(0.1);
  const [apiSecurityEnabled, setApiSecurityEnabled] = useState(false);
  const [scaEnabled, setScaEnabled] = useState(false);
  const [growthRate, setGrowthRate] = useState(20);

  const c = useMemo(() => {
    const requestsPerMonth = requestsPerSec * 86400 * 30;
    const threatEventsPerMonth = requestsPerMonth * (threatEventPct / 100);
    // API Security: samples 1% of requests for schema analysis
    const apiSchemaSamplesPerMonth = apiSecurityEnabled ? requestsPerMonth * 0.01 : 0;
    // IAST: code-level tracing overhead on tests
    const iastOverheadPct = 5; // ~5% CPU overhead for IAST
    return { requestsPerMonth, threatEventsPerMonth, apiSchemaSamplesPerMonth, iastOverheadPct };
  }, [protectedServices, requestsPerSec, threatEventPct, apiSecurityEnabled]);

  return (
    <div className="space-y-6 max-w-5xl">
      <CalcHeader icon="🔒" title="Application Security (ASM) Calculator" description="Estimate threat detection event volumes, API security schema samples, and SCA coverage for your services." />
      {scanData && (
        <ScanContext
          onLoad={() => setProtectedServices(Math.max(1, scanData.apm.totalServices))}
          items={[
            { label: 'APM Services', actual: String(scanData.apm.totalServices), note: 'eligible for ASM' },
            { label: 'With Monitor', actual: String(scanData.apm.svcWithMonitor), note: 'already have alerting' },
            { label: 'In Catalog', actual: String(scanData.apm.svcInCatalog), note: 'have ownership defined' },
            { label: 'Total Hosts', actual: String(scanData.infrastructure.totalHosts), note: 'billed per host for ASM' },
          ]}
        />
      )}
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-5 bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">ASM Configuration</h3>
          <SliderInput label="Protected Services" value={protectedServices} min={1} max={10000} unit="services" hint="ASM is billed per host/container running ASM-enabled services" onChange={setProtectedServices} log />
          <SliderInput label="Requests per Second (total)" value={requestsPerSec} min={1} max={1000000} unit="req/s" hint="Total HTTP/gRPC requests across all protected services" onChange={setRequestsPerSec} log />
          <SliderInput label="Threat Event Rate" value={threatEventPct} min={0.001} max={10} step={0.001} unit="% of requests" hint="Requests flagged as attacks (SQL injection, XSS, SSRF…). Typical: 0.01–1%." onChange={setThreatEventPct} />
          <div className="space-y-3 border-t border-gray-100 pt-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add-ons</div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="apisec" checked={apiSecurityEnabled} onChange={(e) => setApiSecurityEnabled(e.target.checked)} className="accent-violet-600" />
              <label htmlFor="apisec" className="text-sm text-gray-700">API Security (schema discovery + endpoint inventory)</label>
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="sca" checked={scaEnabled} onChange={(e) => setScaEnabled(e.target.checked)} className="accent-violet-600" />
              <label htmlFor="sca" className="text-sm text-gray-700">Software Composition Analysis (SCA / OSS vulnerabilities)</label>
            </div>
          </div>
          <SliderInput label="Annual Growth Rate" value={growthRate} min={0} max={200} unit="% / year" onChange={setGrowthRate} />
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
      <GrowthTable growthRate={growthRate} rows={[
        { label: 'Protected Services', baseline: protectedServices, unit: '' },
        { label: 'Requests / Month', baseline: c.requestsPerMonth, unit: '' },
        { label: 'Threat Events / Month', baseline: c.threatEventsPerMonth, unit: '' },
      ]} />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type CalcDef = { id: string; label: string; icon: string; description: string; group: string; component: React.ComponentType<{ scanData?: AnalyticsData }> };

const CALCULATORS: CalcDef[] = [
  { id: 'infra', label: 'Infrastructure', icon: '🖥', description: 'Host, container, and K8s allotments', group: 'Core', component: InfraCalculator },
  { id: 'logs', label: 'Log Pipeline', icon: '🪵', description: 'Ingest, indexing, Flex, and retention', group: 'Core', component: LogsCalculator },
  { id: 'apm', label: 'APM & Traces', icon: '🔍', description: 'Trace ingestion, sampling, and retention', group: 'Core', component: APMCalculator },
  { id: 'metrics', label: 'Custom Metrics', icon: '📈', description: 'Cardinality and allotment forecasting', group: 'Core', component: MetricsCalculator },
  { id: 'rum', label: 'RUM & Sessions', icon: '👤', description: 'Session, replay, and mobile RUM volume', group: 'Frontend', component: RUMCalculator },
  { id: 'synthetics', label: 'Synthetics', icon: '🧪', description: 'Test run estimation and optimization', group: 'Frontend', component: SyntheticsCalculator },
  { id: 'ci', label: 'CI Visibility', icon: '🔧', description: 'Pipeline runs, test spans, committers', group: 'Developer', component: CIVisibilityCalculator },
  { id: 'profiler', label: 'Continuous Profiler', icon: '⚡', description: 'Flame graph storage and agent overhead', group: 'Developer', component: ProfilerCalculator },
  { id: 'dbm', label: 'Database Mon.', icon: '🗄', description: 'DBM query samples and metric volume', group: 'Data', component: DBMCalculator },
  { id: 'cloud', label: 'Cloud Accounts', icon: '☁', description: 'AWS / GCP / Azure metric volumes', group: 'Cloud', component: CloudCalculator },
  { id: 'ndm', label: 'Network Devices', icon: '🔌', description: 'SNMP agent sizing for device fleets', group: 'Network', component: NDMCalculator },
  { id: 'npm', label: 'Network Flows', icon: '🌊', description: 'NPM flow data volume and overhead', group: 'Network', component: NPMCalculator },
  { id: 'opw', label: 'Obs. Pipelines', icon: '🔀', description: 'OPW worker sizing and cost savings', group: 'Pipeline', component: OPWCalculator },
  { id: 'cspm', label: 'Security Posture', icon: '🛡', description: 'CSPM scan coverage and findings', group: 'Security', component: CSPMCalculator },
  { id: 'asm', label: 'App Security', icon: '🔒', description: 'ASM threat events, SCA, API security', group: 'Security', component: ASMCalculator },
];

const CALC_GROUPS = ['Core', 'Frontend', 'Developer', 'Data', 'Cloud', 'Network', 'Pipeline', 'Security'];

export default function Calculators() {
  const [activeId, setActiveId] = useState('infra');
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  const { data: scanData } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const active = CALCULATORS.find(c => c.id === activeId) ?? CALCULATORS[0];
  const ActiveComponent = active.component;

  return (
    <div className="flex h-[calc(100vh-64px)] -mx-6 -my-6 overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Sizing Calculators</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {scanData ? <span className="text-blue-600 font-medium">📡 Scan data loaded</span> : 'Select a scan for current usage'}
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
          {CALC_GROUPS.map(group => {
            const items = CALCULATORS.filter(c => c.group === group);
            return (
              <div key={group}>
                <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{group}</div>
                <div className="space-y-0.5">
                  {items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => setActiveId(item.id)}
                      className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-lg transition-colors ${
                        activeId === item.id ? 'bg-violet-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <span className="text-base mt-0.5 shrink-0">{item.icon}</span>
                      <div className="min-w-0">
                        <div className={`text-sm font-medium leading-tight ${activeId === item.id ? 'text-white' : 'text-gray-800'}`}>{item.label}</div>
                        <div className={`text-xs leading-tight mt-0.5 ${activeId === item.id ? 'text-violet-200' : 'text-gray-400'}`}>{item.description}</div>
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
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <ActiveComponent scanData={scanData} />
      </div>
    </div>
  );
}
