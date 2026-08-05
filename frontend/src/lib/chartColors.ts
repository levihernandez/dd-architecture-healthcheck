/**
 * Validated chart palette (see dataviz skill: references/palette.md).
 * Categorical order is the CVD-safety mechanism — always assign in this fixed
 * order, never cycle or reorder per-chart. Status colors are reserved for
 * state (good/warning/serious/critical) and never reused as series colors.
 */

export const CATEGORICAL = [
  '#2a78d6', // 1 blue
  '#008300', // 2 green
  '#e87ba4', // 3 magenta
  '#eda100', // 4 yellow
  '#1baf7a', // 5 aqua
  '#eb6834', // 6 orange
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
] as const;

export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

// Sequential single-hue ramp (blue), light -> dark, for ordered/magnitude encodings.
export const SEQUENTIAL_BLUE = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec',
  '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95',
] as const;

export const CHART_INK = {
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  gridline: '#e1e0d9',
} as const;

/** Picks an evenly-spaced step from the sequential ramp for `index` of `count`. */
export function sequentialStep(index: number, count: number): string {
  if (count <= 1) return SEQUENTIAL_BLUE[Math.floor(SEQUENTIAL_BLUE.length / 2)];
  const pos = Math.round((index / (count - 1)) * (SEQUENTIAL_BLUE.length - 1));
  return SEQUENTIAL_BLUE[Math.max(0, Math.min(SEQUENTIAL_BLUE.length - 1, pos))];
}

/**
 * A light tint of a mark color, for a meter's unfilled track — "the fill
 * carries severity; the unfilled track is a lighter step of the same ramp,
 * so state reads across the whole bar" (marks-and-anatomy.md).
 */
export function trackTint(hex: string, alpha = 0.14): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
