import { AlertTriangle } from "lucide-react";

export type EscapeHatchDevBannerFlags = {
  weakAdminPasswordAllowed: boolean;
  weakAdminUsernameAllowed: boolean;
  weakSessionSecretAllowed: boolean;
  isProduction: boolean;
} | null;

interface Props {
  flags: EscapeHatchDevBannerFlags;
}

export function EscapeHatchDevBanner({ flags }: Props) {
  if (!flags || flags.isProduction) return null;

  const activeFlags: string[] = [];
  if (flags.weakAdminPasswordAllowed) activeFlags.push("ALLOW_WEAK_ADMIN_PASSWORD=1");
  if (flags.weakAdminUsernameAllowed) activeFlags.push("ALLOW_WEAK_ADMIN_USERNAME=1");
  if (flags.weakSessionSecretAllowed) activeFlags.push("ALLOW_WEAK_SESSION_SECRET=1");

  if (activeFlags.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="relative z-20 px-4 sm:px-6 py-2.5 flex items-center gap-3 text-sm border-b border-amber-500/40 bg-gradient-to-r from-amber-900/50 via-amber-900/40 to-amber-900/50 text-amber-100"
      data-testid="banner-escape-hatch-dev"
    >
      <div className="flex items-start gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-400 mt-0.5" />
        <span className="min-w-0">
          <span className="font-semibold">Non-production warning:</span>{" "}
          {activeFlags.length === 1 ? (
            <>
              the escape-hatch flag{" "}
              <span className="font-mono text-amber-200">{activeFlags[0]}</span>{" "}
              is active — it bypasses a security check intended for production.
            </>
          ) : (
            <>
              the following escape-hatch flags are active — each bypasses a
              security check intended for production:{" "}
              {activeFlags.map((f, i) => (
                <span key={f}>
                  <span className="font-mono text-amber-200">{f}</span>
                  {i < activeFlags.length - 1 ? ", " : ""}
                </span>
              ))}
              .
            </>
          )}{" "}
          Remove {activeFlags.length === 1 ? "it" : "them"} before deploying to
          production.
        </span>
      </div>
    </div>
  );
}
