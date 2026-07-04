import { Skeleton } from "@/components/ui/skeleton";

export function CaseDialogHeaderSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading case header">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <Skeleton className="h-5 w-52" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-18 rounded-full" />
        <div className="ml-auto flex items-center gap-1">
          <Skeleton className="h-7 w-24 rounded-md" />
          <Skeleton className="h-7 w-24 rounded-md" />
          <Skeleton className="h-7 w-24 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-3.5 w-80 mt-2" />
    </div>
  );
}

export function CaseTabContentSkeleton() {
  return (
    <div className="space-y-5 py-1" aria-busy="true" aria-label="Loading case details">
      <div className="flex flex-wrap gap-1.5 mb-2">
        {[88, 76, 80, 64, 96, 64, 56].map((w, i) => (
          <Skeleton key={i} className="h-8 rounded-md" style={{ width: w }} />
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="rounded-xl border border-slate-800/50 bg-slate-900/40 p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            {[1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="rounded-xl border border-slate-800/50 bg-slate-900/40 p-4 space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded flex-shrink-0" />
              <Skeleton
                className="h-4"
                style={{ width: `${[72, 55, 64][i - 1]}%` }}
              />
            </div>
          ))}
          <Skeleton className="h-8 w-32 mt-1 rounded-md" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="rounded-xl border border-slate-800/50 bg-slate-900/40 p-4 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <div className="flex items-center gap-2 pt-1">
            <Skeleton className="h-7 w-24 rounded-md" />
            <Skeleton className="h-7 w-24 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
