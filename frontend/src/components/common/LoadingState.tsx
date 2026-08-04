interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
}

export default function LoadingState({ message = 'Loading...', size = 'md' }: LoadingStateProps) {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className={`animate-spin rounded-full border-2 border-gray-300 border-t-dd-purple ${sizes[size]}`} />
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}

export function ErrorState({ message = 'An error occurred', onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600 text-xl">✗</div>
      <p className="text-sm text-gray-700">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-xs px-3 py-1.5">
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message = 'No data found', action }: { message?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 text-xl">○</div>
      <p className="text-sm text-gray-500">{message}</p>
      {action}
    </div>
  );
}
