// Shared parsing for usage_summary's raw usage/cost JSON blobs — the single place
// that turns Datadog's /api/v1/usage/summary + /api/v2/usage/estimated_cost
// responses into structured data, reused by the usage route and cost rules alike
// so there's exactly one parser to keep correct.

export interface CostCharge {
  charge_type: string;
  product_name: string;
  cost: number;
}

export interface ProductBreakdownRow {
  name: string;
  metricKey: string;
  value: number | null;
  unit: string;
  committedCost: number;
  onDemandCost: number;
  hasOnDemand: boolean;
}

// Metadata keys present in the usage/summary response that aren't numeric metrics.
// Everything else numeric is treated as a real usage metric — no allowlist.
const NON_METRIC_KEYS = new Set(['date', 'org_name', 'public_id', 'region']);

export function parseUsageSummary(usageJson: string | null): {
  usageHistory: Array<Record<string, unknown>>;
  latestUsage: Record<string, unknown>;
} {
  let usageHistory: Array<Record<string, unknown>> = [];
  try {
    if (usageJson) {
      const parsed = JSON.parse(usageJson) as { usage?: Array<Record<string, unknown>> };
      usageHistory = parsed?.usage ?? [];
    }
  } catch { /* empty */ }
  return { usageHistory, latestUsage: usageHistory.at(-1) ?? {} };
}

export function parseCostJson(costJson: string | null): CostCharge[] {
  try {
    if (!costJson) return [];
    const parsed = JSON.parse(costJson) as {
      data?: Array<{ attributes?: { charges?: CostCharge[] } }>;
    };
    return parsed?.data?.flatMap((d) => d.attributes?.charges ?? []) ?? [];
  } catch {
    return [];
  }
}

// Exact product_name -> {committed, on_demand} totals. No substring/fuzzy matching —
// every product Datadog actually billed gets its own entry.
export function groupChargesByProduct(charges: CostCharge[]): Record<string, { committed: number; on_demand: number }> {
  const byProduct: Record<string, { committed: number; on_demand: number }> = {};
  for (const c of charges) {
    if (!byProduct[c.product_name]) byProduct[c.product_name] = { committed: 0, on_demand: 0 };
    if (c.charge_type === 'on_demand') byProduct[c.product_name].on_demand += c.cost;
    else byProduct[c.product_name].committed += c.cost;
  }
  return byProduct;
}

// Inferred from the key name so the frontend can still format bytes as
// GB/TB — there's no fixed per-metric unit list to consult anymore.
function inferUnit(key: string): string {
  if (key.includes('bytes')) return 'bytes';
  if (key.includes('host')) return 'hosts';
  if (key.includes('session')) return 'sessions';
  if (key.includes('container')) return 'containers';
  if (key.includes('test')) return 'tests';
  return '';
}

function prettifyMetricKey(key: string): string {
  const suffixes: Array<[RegExp, string]> = [
    [/_top99p$/, ' (p99)'],
    [/_avg$/, ' (avg)'],
    [/_sum$/, ' (total)'],
    [/_hwm$/, ' (high-water mark)'],
    [/_count$/, ' (count)'],
  ];
  let suffix = '';
  let base = key;
  for (const [re, label] of suffixes) {
    if (re.test(base)) { suffix = label; base = base.replace(re, ''); break; }
  }
  const label = base
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return `${label}${suffix}`;
}

// Best-effort link between a usage metric's implied product words and a billed
// product name — used only to pair a usage value with its cost when possible.
// An unmatched usage metric still shows (with no cost); an unmatched billed
// product still shows (with no usage value) — nothing is hidden either way.
function findCostMatch(
  metricKey: string,
  costByProduct: Record<string, { committed: number; on_demand: number }>
): { productName: string; cost: { committed: number; on_demand: number } } | null {
  const words = metricKey.replace(/_(top99p|avg|sum|hwm|count)$/, '').split('_');
  for (const [productName, cost] of Object.entries(costByProduct)) {
    const productWords = productName.toLowerCase().split(/\s+/);
    if (words.some((w) => w.length > 3 && productWords.some((pw) => pw.includes(w) || w.includes(pw)))) {
      return { productName, cost };
    }
  }
  return null;
}

// Every usage metric found (not a curated 14-item list) paired with cost where a
// match is found, PLUS a row for every billed product with no matching usage
// metric — so no product Datadog actually billed is ever left off this table.
export function buildProductBreakdown(
  usage: Record<string, unknown>,
  charges: CostCharge[]
): ProductBreakdownRow[] {
  const costByProduct = groupChargesByProduct(charges);
  const matchedProducts = new Set<string>();
  const rows: ProductBreakdownRow[] = [];

  for (const [key, rawValue] of Object.entries(usage)) {
    if (NON_METRIC_KEYS.has(key) || typeof rawValue !== 'number') continue;
    const match = findCostMatch(key, costByProduct);
    if (match) matchedProducts.add(match.productName);
    rows.push({
      name: match?.productName ?? prettifyMetricKey(key),
      metricKey: key,
      value: rawValue,
      unit: inferUnit(key),
      committedCost: match?.cost.committed ?? 0,
      onDemandCost: match?.cost.on_demand ?? 0,
      hasOnDemand: (match?.cost.on_demand ?? 0) > 0,
    });
  }

  for (const [productName, cost] of Object.entries(costByProduct)) {
    if (matchedProducts.has(productName)) continue;
    rows.push({
      name: productName,
      metricKey: '',
      value: null,
      unit: '',
      committedCost: cost.committed,
      onDemandCost: cost.on_demand,
      hasOnDemand: cost.on_demand > 0,
    });
  }

  return rows.filter((r) => r.value !== null || r.committedCost > 0 || r.onDemandCost > 0);
}
