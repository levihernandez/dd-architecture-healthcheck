import clsx from 'clsx';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'default' | 'green' | 'red' | 'amber' | 'blue' | 'purple';
  onClick?: () => void;
}

const COLOR_CLASSES = {
  default: 'text-gray-900',
  green: 'text-green-600',
  red: 'text-red-600',
  amber: 'text-amber-600',
  blue: 'text-blue-600',
  purple: 'text-dd-purple',
};

export default function MetricCard({ label, value, subtitle, icon, color = 'default', onClick }: MetricCardProps) {
  return (
    <div
      className={clsx('card', onClick && 'cursor-pointer hover:shadow-md transition-shadow')}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className={clsx('text-3xl font-bold mt-1', COLOR_CLASSES[color])}>
            {value}
          </p>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        {icon && (
          <div className="text-2xl ml-3">{icon}</div>
        )}
      </div>
    </div>
  );
}
