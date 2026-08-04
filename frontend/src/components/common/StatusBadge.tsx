import clsx from 'clsx';
import type { FindingSeverity, ScoreGrade, CollectorResult } from '../../types';
import { GRADE_LABELS, GRADE_COLORS } from '../../types';

interface SeverityBadgeProps { severity: FindingSeverity }
export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const classes: Record<FindingSeverity, string> = {
    critical: 'bg-red-100 text-red-800',
    high: 'bg-orange-100 text-orange-800',
    medium: 'bg-amber-100 text-amber-800',
    low: 'bg-blue-100 text-blue-800',
    info: 'bg-gray-100 text-gray-700',
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
    excellent: 'bg-green-100 text-green-800',
    good: 'bg-blue-100 text-blue-800',
    needs_attention: 'bg-amber-100 text-amber-800',
    critical: 'bg-red-100 text-red-800',
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
    success: { label: 'Success', cls: 'bg-green-100 text-green-800' },
    permission_denied: { label: 'Permission Denied', cls: 'bg-red-100 text-red-800' },
    not_available: { label: 'Not Available', cls: 'bg-gray-100 text-gray-600' },
    not_detected: { label: 'Not Detected', cls: 'bg-gray-100 text-gray-600' },
    error: { label: 'Error', cls: 'bg-red-100 text-red-800' },
  };
  const { label, cls } = config[status] ?? { label: status, cls: 'bg-gray-100 text-gray-700' };
  return <span className={clsx('badge', cls)}>{label}</span>;
}

interface ScanStatusBadgeProps { status: string }
export function ScanStatusBadge({ status }: ScanStatusBadgeProps) {
  const config: Record<string, { label: string; cls: string; dot?: boolean }> = {
    pending: { label: 'Pending', cls: 'bg-gray-100 text-gray-600' },
    running: { label: 'Running', cls: 'bg-blue-100 text-blue-800', dot: true },
    completed: { label: 'Completed', cls: 'bg-green-100 text-green-800' },
    failed: { label: 'Failed', cls: 'bg-red-100 text-red-800' },
    success: { label: 'Success', cls: 'bg-green-100 text-green-800' },
    error: { label: 'Error', cls: 'bg-red-100 text-red-800' },
  };
  const { label, cls, dot } = config[status] ?? { label: status, cls: 'bg-gray-100 text-gray-700' };
  return (
    <span className={clsx('badge', cls)}>
      {dot && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse mr-1 inline-block" />}
      {label}
    </span>
  );
}
