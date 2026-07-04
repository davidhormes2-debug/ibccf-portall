import { ShieldAlert } from "lucide-react";

export type WeakSessionSecretBannerFlags = {
  weakSessionSecretAllowed: boolean;
  isProduction: boolean;
} | null;

interface Props {
  flags: WeakSessionSecretBannerFlags;
}

export function WeakSessionSecretBanner({ flags }: Props) {
  if (!flags?.weakSessionSecretAllowed) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="relative z-20 px-4 sm:px-6 py-2.5 flex items-center gap-3 text-sm border-b border-orange-500/40 bg-gradient-to-r from-orange-900/60 via-orange-900/50 to-orange-900/60 text-orange-100"
      data-testid="banner-weak-session-secret"
    >
      <div className="flex items-center gap-2 min-w-0">
        <ShieldAlert className="h-4 w-4 flex-shrink-0 text-orange-300" />
        <span className="truncate">
          <span className="font-semibold">Security warning:</span>{" "}
          <span className="font-mono text-orange-200">
            ALLOW_WEAK_SESSION_SECRET=1
          </span>{" "}
          is active
          {flags.isProduction ? (
            <span className="text-orange-200">
              {" "}
              in this <span className="font-semibold">production</span>{" "}
              deployment
            </span>
          ) : (
            <span className="text-orange-300/80">
              {" "}
              — this escape hatch is intended for local development only
            </span>
          )}
          . Remove it from your environment variables.
        </span>
      </div>
    </div>
  );
}
