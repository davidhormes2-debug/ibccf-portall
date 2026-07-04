import { Skeleton } from "@/components/ui/skeleton";

interface PortalSkeletonProps {
  variant?: "card" | "list" | "stat";
  count?: number;
  className?: string;
}

function PortalCardSkeleton() {
  return (
    <div
      className="rounded-2xl glass-dark-premium card-depth overflow-hidden"
      data-testid="portal-skeleton-card"
      aria-hidden="true"
    >
      <div className="p-5 flex items-start gap-4 border-b border-white/10">
        <Skeleton className="w-12 h-12 rounded-xl shrink-0 bg-white/10" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4 bg-white/10" />
          <Skeleton className="h-3 w-1/2 bg-white/10" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full bg-white/10 shrink-0" />
      </div>
      <div className="p-5 space-y-3">
        <Skeleton className="h-3 w-full bg-white/10" />
        <Skeleton className="h-3 w-5/6 bg-white/10" />
        <div className="flex gap-3 pt-1">
          <Skeleton className="h-8 flex-1 rounded-xl bg-white/10" />
          <Skeleton className="h-8 flex-1 rounded-xl bg-white/10" />
        </div>
      </div>
    </div>
  );
}

function PortalListSkeleton() {
  return (
    <div
      className="rounded-xl border border-white/10 p-4 flex items-start gap-4"
      style={{ background: "rgba(255,255,255,0.04)" }}
      data-testid="portal-skeleton-list"
      aria-hidden="true"
    >
      <Skeleton className="w-10 h-10 rounded-xl shrink-0 bg-white/10" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3 bg-white/10" />
        <Skeleton className="h-3 w-1/2 bg-white/10" />
      </div>
      <Skeleton className="h-5 w-14 rounded-full bg-white/10 shrink-0" />
    </div>
  );
}

function PortalStatSkeleton() {
  return (
    <div
      className="p-3 sm:p-4 rounded-xl text-center border border-white/10"
      style={{ background: "rgba(255,255,255,0.04)" }}
      data-testid="portal-skeleton-stat"
      aria-hidden="true"
    >
      <Skeleton className="w-5 h-5 mx-auto mb-2 rounded bg-white/10" />
      <Skeleton className="h-7 w-10 mx-auto mb-1.5 rounded bg-white/10" />
      <Skeleton className="h-2.5 w-16 mx-auto rounded bg-white/10" />
    </div>
  );
}

export function PortalSkeleton({
  variant = "card",
  count = 2,
  className = "",
}: PortalSkeletonProps) {
  const items = Array.from({ length: count });

  if (variant === "stat") {
    return (
      <div
        className={`grid grid-cols-3 gap-3 sm:gap-4 ${className}`}
        role="status"
        aria-label="Loading"
      >
        {items.map((_, i) => (
          <PortalStatSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div
        className={`space-y-3 ${className}`}
        role="status"
        aria-label="Loading"
      >
        {items.map((_, i) => (
          <PortalListSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`space-y-4 ${className}`}
      role="status"
      aria-label="Loading"
    >
      {items.map((_, i) => (
        <PortalCardSkeleton key={i} />
      ))}
    </div>
  );
}
