import { Loader2, ShieldCheck, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  text?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

export function LoadingSpinner({ size = 'md', className = '', text }: LoadingSpinnerProps) {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`} data-testid="loading-spinner">
      <Loader2 className={`${sizeClasses[size]} animate-spin text-blue-600`} />
      {text && <span className="text-sm text-slate-600">{text}</span>}
    </div>
  );
}

interface FullPageLoaderProps {
  text?: string;
  showLogo?: boolean;
}

export function FullPageLoader({ text = 'Loading...', showLogo = true }: FullPageLoaderProps) {
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center z-50" data-testid="full-page-loader">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-4"
      >
        {showLogo && (
          <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-full flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
        )}
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-slate-600 font-medium">{text}</p>
      </motion.div>
    </div>
  );
}

interface CardSkeletonProps {
  rows?: number;
  showHeader?: boolean;
  showAvatar?: boolean;
}

export function CardSkeleton({ rows = 3, showHeader = true, showAvatar = false }: CardSkeletonProps) {
  return (
    <Card className="overflow-hidden" data-testid="card-skeleton">
      {showHeader && (
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            {showAvatar && <Skeleton className="w-10 h-10 rounded-full" />}
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </CardHeader>
      )}
      <CardContent className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${100 - (i * 15)}%` }} />
        ))}
      </CardContent>
    </Card>
  );
}

export function ListSkeleton({ items = 3 }: { items?: number }) {
  return (
    <div className="space-y-3" data-testid="list-skeleton">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 bg-white rounded-lg border">
          <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="w-8 h-8 rounded" />
        </div>
      ))}
    </div>
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="border rounded-lg overflow-hidden" data-testid="table-skeleton">
      <div className="bg-slate-50 border-b p-3">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="p-3">
            <div className="flex gap-4">
              {Array.from({ length: columns }).map((_, colIdx) => (
                <Skeleton 
                  key={colIdx} 
                  className="h-4 flex-1" 
                  style={{ opacity: 1 - (rowIdx * 0.1) }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center" data-testid="empty-state">
      {icon && (
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-400">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-slate-700 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-slate-500 max-w-sm mb-4">{description}</p>
      )}
      {action}
    </div>
  );
}

interface RefreshButtonProps {
  isRefreshing: boolean;
  onRefresh: () => void;
  className?: string;
}

export function RefreshButton({ isRefreshing, onRefresh, className = '' }: RefreshButtonProps) {
  return (
    <button
      onClick={onRefresh}
      disabled={isRefreshing}
      className={`p-2 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50 ${className}`}
      data-testid="refresh-button"
    >
      <RefreshCw className={`w-5 h-5 text-slate-600 ${isRefreshing ? 'animate-spin' : ''}`} />
    </button>
  );
}

interface InlineLoaderProps {
  text?: string;
}

export function InlineLoader({ text = 'Loading...' }: InlineLoaderProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500" data-testid="inline-loader">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span>{text}</span>
    </div>
  );
}

export default {
  LoadingSpinner,
  FullPageLoader,
  CardSkeleton,
  ListSkeleton,
  TableSkeleton,
  EmptyState,
  RefreshButton,
  InlineLoader,
};
