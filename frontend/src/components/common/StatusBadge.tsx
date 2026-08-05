import clsx from 'clsx';
import type { FindingSeverity, ScoreGrade, CollectorResult } from '../../types';
import { GRADE_LABELS, GRADE_COLORS } from '../../types';

interface SeverityBadgeProps { severity: FindingSeverity }
export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const classes: Record<FindingSeverity, string> = {
    critical: 'bg-red-500/15 text-red-400',
    high: 'bg-orange-500/15 text-orange-400',
    medium: 'bg-amber-500/15 text-amber-400',
    low: 'bg-blue-500/15 text-blue-400',
    info: 'bg-surface-sunken text-ink-muted',
  };
  return (
    <span className={clsx('badge uppercase', classes[severity])}>
      {severity}
    </span>
  );
}

interface GradeBadgeProps { grade: ScoreGrade; score?: number }
export function GradeBadge({ grade, score }: GradeBadgeProps) {
  const classes: Record<ScoreGrade, string> = {
    excellent: 'bg-green-500/15 text-green-400',
    good: 'bg-blue-500/15 text-blue-400',
    needs_attention: 'bg-amber-500/15 text-amber-400',
    critical: 'bg-red-500/15 text-red-400',
  };
  return (
    <span className={clsx('badge', classes[grade])}>
      {score !== undefined && `${score} — `}{GRADE_LABELS[grade]}
    </span>
  );
}

interface CollectorStatusBadgeProps { status: CollectorResult['status'] }
export function CollectorStatusBadge({ status }: CollectorStatusBadgeProps) {
  const config: Record<string, { label: string; cls: string }> = {
    success: { label: 'Success', cls: 'bg-green-500/15 text-green-400' },
    permission_denied: { label: 'Permission Denied', cls: 'bg-red-500/15 text-red-400' },
    not_available: { label: 'Not Available', cls: 'bg-surface-sunken text-ink-muted' },
    not_detected: { label: 'Not Detected', cls: 'bg-surface-sunken text-ink-muted' },
    error: { label: 'Error', cls: 'bg-red-500/15 text-red-400' },
  };
  const { label, cls } = config[status] ?? { label: status, cls: 'bg-surface-sunken text-ink-muted' };
  return <span className={clsx('badge', cls)}>{label}</span>;
}

interface ScanStatusBadgeProps { status: string }
export function ScanStatusBadge({ status }: ScanStatusBadgeProps) {
  const config: Record<string, { label: string; cls: string; dot?: boolean }> = {
    pending: { label: 'Pending', cls: 'bg-surface-sunken text-ink-muted' },
    running: { label: 'Running', cls: 'bg-blue-500/15 text-blue-400', dot: true },
    completed: { label: 'Completed', cls: 'bg-green-500/15 text-green-400' },
    failed: { label: 'Failed', cls: 'bg-red-500/15 text-red-400' },
    success: { label: 'Success', cls: 'bg-green-500/15 text-green-400' },
    error: { label: 'Error', cls: 'bg-red-500/15 text-red-400' },
  };
  const { label, cls, dot } = config[status] ?? { label: status, cls: 'bg-surface-sunken text-ink-muted' };
  return (
    <span className={clsx('badge', cls)}>
      {dot && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse mr-1 inline-block" />}
      {label}
    </span>
  );
}
