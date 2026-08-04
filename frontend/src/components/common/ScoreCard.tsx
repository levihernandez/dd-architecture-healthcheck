import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';
import clsx from 'clsx';
import type { OrgScorecard, CategoryScore, ScoreGrade } from '../../types';
import { GRADE_LABELS, GRADE_COLORS, CATEGORY_LABELS } from '../../types';
import { GradeBadge } from './StatusBadge';

interface ScoreGaugeProps {
  score: number;
  grade: ScoreGrade;
  size?: 'sm' | 'md' | 'lg';
}

export function ScoreGauge({ score, grade, size = 'md' }: ScoreGaugeProps) {
  const sizes = { sm: 80, md: 120, lg: 160 };
  const fontSize = { sm: 'text-xl', md: 'text-3xl', lg: 'text-5xl' };
  const color = GRADE_COLORS[grade];
  const data = [{ value: score, fill: color }];

  return (
    <div className="relative" style={{ width: sizes[size], height: sizes[size] }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%" cy="50%"
          innerRadius="70%" outerRadius="100%"
          barSize={10} data={data}
          startAngle={180} endAngle={-180}
        >
          <RadialBar background dataKey="value" cornerRadius={5} max={100} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={clsx('font-bold leading-none', fontSize[size])} style={{ color }}>
          {score}
        </span>
        <span className="text-xs text-gray-500 mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

interface OrgScorecardCardProps {
  scorecard: OrgScorecard;
  onCategoryClick?: (category: CategoryScore) => void;
}

export function OrgScorecardCard({ scorecard, onCategoryClick }: OrgScorecardCardProps) {
  return (
    <div className="card">
      <div className="flex items-center gap-6 mb-6">
        <ScoreGauge score={scorecard.overallScore} grade={scorecard.overallGrade} size="lg" />
        <div>
          <h2 className="text-xl font-bold text-gray-900">Overall Health Score</h2>
          <GradeBadge grade={scorecard.overallGrade} />
          <div className="mt-2 flex gap-4 text-sm text-gray-600">
            <span className="text-red-600 font-medium">{scorecard.criticalFindings} critical</span>
            <span className="text-orange-500 font-medium">{scorecard.highFindings} high</span>
            <span className="text-gray-500">{scorecard.totalFindings} total findings</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {scorecard.categoryScores.map((cat) => (
          <CategoryScoreCard
            key={cat.category}
            score={cat}
            onClick={onCategoryClick ? () => onCategoryClick(cat) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

interface CategoryScoreCardProps {
  score: CategoryScore;
  onClick?: () => void;
}

export function CategoryScoreCard({ score, onClick }: CategoryScoreCardProps) {
  const color = GRADE_COLORS[score.grade];
  const barWidth = `${score.percentage}%`;

  return (
    <div
      className={clsx('p-3 rounded-lg border border-gray-200 bg-gray-50',
        onClick && 'cursor-pointer hover:border-dd-purple hover:bg-white transition-all')}
      onClick={onClick}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="text-xs font-medium text-gray-700 leading-tight">
          {CATEGORY_LABELS[score.category]}
        </span>
        <span className="text-sm font-bold ml-2" style={{ color }}>
          {score.percentage}
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: barWidth, backgroundColor: color }}
        />
      </div>
      <div className="mt-1.5 flex gap-1 text-xs text-gray-500">
        {score.findingCounts.critical > 0 && (
          <span className="text-red-600">{score.findingCounts.critical}C</span>
        )}
        {score.findingCounts.high > 0 && (
          <span className="text-orange-500">{score.findingCounts.high}H</span>
        )}
        {score.findingCounts.medium > 0 && (
          <span className="text-amber-500">{score.findingCounts.medium}M</span>
        )}
        {score.findingCounts.critical === 0 && score.findingCounts.high === 0 && score.findingCounts.medium === 0 && (
          <span className="text-green-600">✓ Clean</span>
        )}
      </div>
    </div>
  );
}
