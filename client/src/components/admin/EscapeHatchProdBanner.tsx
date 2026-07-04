import { ShieldAlert } from "lucide-react";

export type EscapeHatchProdBannerFlags = {
  weakAdminPasswordAllowed: boolean;
  weakAdminUsernameAllowed: boolean;
  weakSessionSecretAllowed: boolean;
  isProduction: boolean;
} | null;

interface Props {
  flags: EscapeHatchProdBannerFlags;
}

export function EscapeHatchProdBanner({ flags }: Props) {
  if (!flags || !flags.isProduction) return null;

  const activeFlags: string[] = [];
  if (flags.weakAdminPasswordAllowed) activeFlags.push("ALLOW_WEAK_ADMIN_PASSWORD=1");
  if (flags.weakAdminUsernameAllowed) activeFlags.push("ALLOW_WEAK_ADMIN_USERNAME=1");
  if (flags.weakSessionSecretAllowed) activeFlags.push("ALLOW_WEAK_SESSION_SECRET=1");

  if (activeFlags.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="relative z-20 px-4 sm:px-6 py-2.5 flex items-center gap-3 text-sm border-b border-red-500/40 bg-gradient-to-r from-red-900/70 via-red-900/60 to-red-900/70 text-red-100"
      data-testid="banner-escape-hatch-prod"
    >
      <ShieldAlert className="h-4 w-4 flex-shrink-0 text-red-300 mt-0.5" aria-hidden />
      <span className="min-w-0">
        <span className="font-semibold">Production security alert:</span>{" "}
        {activeFlags.length === 1 ? (
          <>
            the escape-hatch flag{" "}
            <span className="font-mono text-red-200">{activeFlags[0]}</span>{" "}
            is active in this{" "}
            <span className="font-semibold">production</span> deployment.
          </>
        ) : (
          <>
            the following escape-hatch flags are active in this{" "}
            <span className="font-semibold">production</span> deployment:{" "}
            {activeFlags.map((f, i) => (
              <span key={f}>
                <span className="font-mono text-red-200">{f}</span>
                {i < activeFlags.length - 1 ? ", " : ""}
              </span>
            ))}
            .
          </>
        )}{" "}
        Remove {activeFlags.length === 1 ? "it" : "them"} from your
        environment variables immediately.
      </span>
    </div>
  );
}
