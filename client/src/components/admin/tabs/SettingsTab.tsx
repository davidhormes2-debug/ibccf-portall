import { useEffect, useState } from "react";
import { formatAuditValue, getAuditActionLabel } from "@/components/admin/auditValueFormatter";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { DeclarationReadAttempt } from "../shared";
import {
  Zap,
  ChevronDown,
  ChevronRight,
  Settings,
  History,
  Eye,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Clock,
  Mail,
  FileText,
  ExternalLink,
  Edit3,
  BarChart3,
  TrendingUp,
  Upload,
  FolderOpen,
  Key,
  Users,
  User,
  Activity,
  Globe,
  Languages,
  Moon,
  Sun,
  Plus,
  Trash2,
  RefreshCw,
  X,
  Send,
  Network,
  ListOrdered,
  AlertTriangle,
  Volume2,
  Fingerprint,
  Smartphone,
  Loader2,
} from "lucide-react";
import { SoundSettingsPanel } from "../SoundSettingsPanel";
import { ServiceHealthPanel } from "../ServiceHealthPanel";
import { useAdminDashboard } from "../AdminDashboardContext";
import { useToast } from "@/hooks/use-toast";
import { QRCodeSVG } from "qrcode.react";
import { WEAK_PASSWORD_DISMISSED_KEY } from "../WeakPasswordBanner";
import {
  getPasswordStrength,
  getPasswordStrengthDetail,
  PASSWORD_WEAK_HINTS,
  getUsernameTrivialReason,
  USERNAME_TRIVIAL_HINTS,
} from "../../../../../shared/passwordStrength";
import { EscapeHatchFlagCallout } from "../EscapeHatchFlagCallout";
import { useServiceHealth } from "@/hooks/useServiceHealth";

function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\//i.test(ua)) return "Opera";
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return "Chrome";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Safari\//i.test(ua)) return "Safari";
  return "Browser";
}

// Tracks the admin-managed blocked-IP denylist surfaced in the "By IP"
// panel. Kept local to the Settings view (rather than threading through
// AdminDashboardContext) because it's only used here. Reload is fired
// after every block/unblock so the row badges stay in sync.
function useBlockedIps() {
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [pendingIp, setPendingIp] = useState<string | null>(null);
  const reload = async () => {
    try {
      const token = sessionStorage.getItem('adminToken') ?? '';
      const res = await fetch('/api/admin/blocked-ips', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      const now = Date.now();
      // Match the server-side filter: rows past expires_at are treated
      // as not-blocked (the middleware ignores them too).
      const set = new Set<string>(
        items
          .filter(
            (r: { expiresAt: string | null }) =>
              !r.expiresAt || new Date(r.expiresAt).getTime() > now,
          )
          .map((r: { ipAddress: string }) => r.ipAddress),
      );
      setBlockedSet(set);
    } catch (err) {
      console.error('Failed to load blocked IPs:', err);
    }
  };
  useEffect(() => {
    reload();
  }, []);
  const block = async (ipAddress: string, reason: string) => {
    setPendingIp(ipAddress);
    try {
      const token = sessionStorage.getItem('adminToken') ?? '';
      const res = await fetch('/api/admin/blocked-ips', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ipAddress, reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      await reload();
    } finally {
      setPendingIp(null);
    }
  };
  const unblock = async (ipAddress: string) => {
    setPendingIp(ipAddress);
    try {
      const token = sessionStorage.getItem('adminToken') ?? '';
      const res = await fetch(
        `/api/admin/blocked-ips/${encodeURIComponent(ipAddress)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok && res.status !== 404) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      await reload();
    } finally {
      setPendingIp(null);
    }
  };
  return { blockedSet, pendingIp, block, unblock };
}

// Per-IP drilldown state for the Declaration Scans "By IP" tab. Stored
// here (vs. context) because it's pure UI state local to this view —
// expanding a row triggers a one-off fetch of that IP's attempts so we
// don't have to ship the full feed up-front.
function useDeclarationReadIpDrilldown() {
  const [expandedIp, setExpandedIp] = useState<string | null>(null);
  const [ipAttempts, setIpAttempts] = useState<DeclarationReadAttempt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const toggle = async (ip: string) => {
    if (expandedIp === ip) {
      setExpandedIp(null);
      setIpAttempts([]);
      return;
    }
    setExpandedIp(ip);
    setIpAttempts([]);
    setIsLoading(true);
    try {
      const token = sessionStorage.getItem('adminToken') ?? '';
      const res = await fetch(
        `/api/audit-logs/declaration-read-attempts?limit=100&ip=${encodeURIComponent(ip)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const data = await res.json();
        setIpAttempts(Array.isArray(data?.items) ? data.items : []);
      }
    } catch (err) {
      console.error('Failed to load per-IP declaration-read attempts:', err);
    } finally {
      setIsLoading(false);
    }
  };
  return { expandedIp, ipAttempts, isLoading, toggle };
}

// ─── Biometric / Passkey management ─────────────────────────────────────────

interface StoredCredentialInfo {
  id: string;
  deviceName: string;
  createdAt: string;
  transports: string[];
}

function BiometricSettingsView({
  authToken,
  onBack,
}: {
  authToken: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [credentials, setCredentials] = useState<StoredCredentialInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadCredentials = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/webauthn/credentials", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        setCredentials(await res.json());
      }
    } catch {
      // network error — leave empty
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadCredentials(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegister = async () => {
    setIsRegistering(true);
    try {
      // 1. Get registration options from server
      const optRes = await fetch("/api/webauthn/registration/options", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!optRes.ok) throw new Error("Failed to get registration options");
      const { options, sessionKey } = await optRes.json();

      // 2. Trigger browser biometric enrollment (Touch ID / Windows Hello / etc.)
      const { startRegistration } = await import("@simplewebauthn/browser");
      const registration = await startRegistration({ optionsJSON: options });

      // 3. Verify with server and store
      const verifyRes = await fetch("/api/webauthn/registration/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ sessionKey, registration, deviceName: deviceName.trim() || undefined }),
      });

      if (verifyRes.ok) {
        toast({ title: "Passkey registered", description: "Biometric login is now available on this device." });
        setDeviceName("");
        await loadCredentials();
      } else {
        const d = await verifyRes.json().catch(() => ({}));
        toast({ variant: "destructive", title: "Registration failed", description: d.error ?? "Unknown error" });
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "NotAllowedError") {
        toast({ variant: "destructive", title: "Registration error", description: err.message });
      }
    } finally {
      setIsRegistering(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/webauthn/credentials/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        toast({ title: "Passkey removed" });
        await loadCredentials();
      } else {
        toast({ variant: "destructive", title: "Failed to remove passkey" });
      }
    } finally {
      setDeletingId(null);
    }
  };

  const transportLabel = (t: string) => {
    const map: Record<string, string> = { internal: "Built-in", usb: "USB", nfc: "NFC", ble: "Bluetooth", hybrid: "Hybrid" };
    return map[t] ?? t;
  };

  return (
    <>
      <div className="flex items-center gap-4 mb-4">
        <Button variant="ghost" onClick={onBack} className="text-slate-400">
          <X className="h-4 w-4 mr-2" /> Back
        </Button>
        <h2 className="text-xl font-bold text-white">Biometric Login (Passkeys)</h2>
      </div>

      <div className="max-w-lg mx-auto space-y-5">
        {/* Intro card */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-5">
            <div className="flex gap-4 items-start">
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 shrink-0">
                <Fingerprint className="h-7 w-7 text-blue-400" />
              </div>
              <div>
                <h3 className="text-white font-semibold mb-1">Passwordless admin login</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Register your device's biometric (Touch ID, Face ID, Windows Hello, or a fingerprint sensor) as a passkey.
                  You can then sign in to the admin panel without typing your password — just a tap or a glance.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Register new passkey */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Plus className="h-4 w-4 text-green-400" /> Register a new passkey
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                Device label <span className="text-slate-600 normal-case font-normal">(optional)</span>
              </label>
              <Input
                placeholder="e.g. MacBook Touch ID, iPhone Face ID…"
                value={deviceName}
                onChange={e => setDeviceName(e.target.value)}
                className="bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-600"
                maxLength={64}
              />
            </div>
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleRegister}
              disabled={isRegistering}
            >
              {isRegistering ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Waiting for biometric…</>
              ) : (
                <><Fingerprint className="h-4 w-4 mr-2" /> Register this device</>
              )}
            </Button>
            <p className="text-slate-500 text-xs">
              Your browser will prompt for fingerprint, face, or PIN verification. The credential never leaves your device.
            </p>
          </CardContent>
        </Card>

        {/* Registered passkeys list */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-slate-400" />
              Registered passkeys
              {credentials.length > 0 && (
                <Badge className="ml-auto bg-blue-600/20 text-blue-300 border-blue-500/30">{credentials.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
              </div>
            ) : credentials.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-sm">
                No passkeys registered yet. Add one above.
              </div>
            ) : (
              <div className="space-y-2">
                {credentials.map(cred => (
                  <div key={cred.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-800/60 border border-slate-700/60">
                    <div className="flex items-center gap-3 min-w-0">
                      <Fingerprint className="h-4 w-4 text-blue-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{cred.deviceName}</p>
                        <p className="text-slate-500 text-xs">
                          {new Date(cred.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                          {cred.transports?.length > 0 && (
                            <> · {cred.transports.map(transportLabel).join(", ")}</>
                          )}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                      disabled={deletingId === cred.id}
                      onClick={() => handleDelete(cred.id)}
                    >
                      {deletingId === cred.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {credentials.length > 0 && (
          <p className="text-slate-500 text-xs text-center">
            Remove a passkey to revoke biometric login from that device.
          </p>
        )}
      </div>
    </>
  );
}

type AdminUserRow = {
  id: number;
  username: string;
  role: string;
  displayName: string | null;
  email: string | null;
  isActive: boolean | null;
  twoFactorEnabled: boolean | null;
  lastLoginAt: string | null;
};

function SubAdmin2faSetupView({
  authToken,
  onBack,
}: {
  authToken: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<{ twoFactorEnabled: boolean; hasBackupCodes: boolean; lastVerifiedAt: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupData, setSetupData] = useState<{ otpauth: string; backupCodes: string[] } | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin-users/me/2fa", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) setStatus(await res.json());
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to load 2FA status" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSetup = async () => {
    try {
      const res = await fetch("/api/admin-users/me/2fa/setup", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Error", description: data.error ?? "Setup failed" });
        return;
      }
      setSetupData(data);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to start 2FA setup" });
    }
  };

  const handleConfirm = async () => {
    if (!confirmCode.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Enter the code from your authenticator app" });
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch("/api/admin-users/me/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ code: confirmCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Invalid code", description: data.error ?? "Verification failed" });
        return;
      }
      toast({ title: "2FA enabled", description: "Two-factor authentication is now active on your account" });
      setSetupData(null);
      setConfirmCode("");
      await loadStatus();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to confirm 2FA" });
    } finally {
      setConfirming(false);
    }
  };

  const handleDisable = async () => {
    setDisabling(true);
    try {
      const res = await fetch("/api/admin-users/me/2fa", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ variant: "destructive", title: "Error", description: data.error ?? "Failed to disable 2FA" });
        return;
      }
      toast({ title: "2FA disabled", description: "Two-factor authentication has been removed from your account" });
      await loadStatus();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to disable 2FA" });
    } finally {
      setDisabling(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-4 mb-4">
        <Button variant="ghost" onClick={onBack} className="text-slate-400">
          <X className="h-4 w-4 mr-2" /> Back
        </Button>
        <h2 className="text-xl font-bold text-white">My Two-Factor Authentication</h2>
      </div>

      <div className="max-w-lg mx-auto space-y-5">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : status === null ? null : status.twoFactorEnabled ? (
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="pt-5 space-y-4">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                  <ShieldCheck className="h-7 w-7 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-1">2FA is active</h3>
                  <p className="text-slate-400 text-sm">Your account is protected with a time-based one-time password (TOTP) authenticator app.</p>
                  {status.lastVerifiedAt && (
                    <p className="text-slate-500 text-xs mt-1">Last verified: {new Date(status.lastVerifiedAt).toLocaleString()}</p>
                  )}
                  {status.hasBackupCodes && (
                    <p className="text-emerald-400 text-xs mt-1">✓ Backup codes are available</p>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                onClick={handleDisable}
                disabled={disabling}
              >
                {disabling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Disable 2FA
              </Button>
            </CardContent>
          </Card>
        ) : setupData ? (
          <>
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <Key className="h-4 w-4 text-amber-400" /> Scan QR code
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-slate-400 text-sm">Open your authenticator app (Google Authenticator, Authy, 1Password, etc.) and scan this code.</p>
                <div className="flex justify-center p-4 bg-white rounded-xl">
                  <QRCodeSVG value={setupData.otpauth} size={180} />
                </div>
                <p className="text-slate-500 text-xs text-center">Can't scan? Copy the setup URI manually from the address bar after clicking "Open in app".</p>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <Key className="h-4 w-4 text-blue-400" /> Save your backup codes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-slate-400 text-sm">Save these 10 backup codes somewhere secure. Each one can be used once if you lose access to your authenticator app.</p>
                <div className="grid grid-cols-2 gap-1.5 font-mono text-sm p-3 bg-slate-800 rounded-lg border border-slate-700">
                  {setupData.backupCodes.map((code) => (
                    <span key={code} className="text-emerald-300">{code}</span>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/50 border-emerald-800/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" /> Verify & activate
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-slate-400 text-sm">Enter the 6-digit code from your authenticator to confirm setup.</p>
                <Input
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  placeholder="000000"
                  maxLength={8}
                  className="bg-slate-800 border-slate-700 text-white font-mono text-center tracking-widest"
                />
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1 text-slate-400" onClick={() => { setSetupData(null); setConfirmCode(""); }}>Cancel</Button>
                  <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleConfirm} disabled={confirming}>
                    {confirming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Activate 2FA
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="pt-5 space-y-4">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-slate-700/60 border border-slate-600 shrink-0">
                  <ShieldAlert className="h-7 w-7 text-slate-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-1">2FA is not set up</h3>
                  <p className="text-slate-400 text-sm">Add a second layer of security to your admin account using any TOTP authenticator app.</p>
                </div>
              </div>
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSetup}>
                <Key className="h-4 w-4 mr-2" /> Set up two-factor authentication
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function AdminUsersView({
  adminUsers,
  loadAdminUsers,
  authToken,
  onBack,
}: {
  adminUsers: AdminUserRow[];
  loadAdminUsers: () => void | Promise<void>;
  authToken: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"viewer" | "agent" | "admin">("agent");
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<string>("");
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [resetting2faId, setResetting2faId] = useState<number | null>(null);

  const handleReset2fa = async (user: AdminUserRow) => {
    setResetting2faId(user.id);
    try {
      const res = await fetch(`/api/admin-users/${user.id}/2fa`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ variant: "destructive", title: "Error", description: data.error ?? "Failed to reset 2FA" });
        return;
      }
      toast({ title: "2FA reset", description: `2FA has been disabled for ${user.username}` });
      loadAdminUsers();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to reset 2FA" });
    } finally {
      setResetting2faId(null);
    }
  };

  const roleBadgeClass = (role: string) =>
    role === "super_admin" ? "bg-red-500/20 text-red-300" :
    role === "admin"       ? "bg-purple-500/20 text-purple-300" :
    role === "agent"       ? "bg-blue-500/20 text-blue-300" :
                             "bg-slate-600 text-slate-300";

  const handleCreate = async () => {
    if (!newUsername || !newPassword) {
      toast({ variant: "destructive", title: "Error", description: "Username and password are required" });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole, email: newEmail || undefined, displayName: newDisplayName || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Error", description: data.error ?? "Failed to create admin user" });
        return;
      }
      toast({ title: "Admin user created", description: `${newUsername} (${newRole}) added successfully` });
      setNewUsername(""); setNewPassword(""); setNewRole("agent"); setNewEmail(""); setNewDisplayName("");
      setShowCreate(false);
      loadAdminUsers();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to create admin user" });
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (user: AdminUserRow) => {
    setEditingId(user.id);
    setEditRole(user.role);
    setEditEmail(user.email ?? "");
    setEditDisplayName(user.displayName ?? "");
    setEditPassword("");
  };

  const handleSave = async (id: number) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { role: editRole, email: editEmail, displayName: editDisplayName };
      if (editPassword) body.password = editPassword;
      const res = await fetch(`/api/admin-users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Error", description: data.error ?? "Failed to update admin user" });
        return;
      }
      toast({ title: "Saved", description: "Admin user updated" });
      setEditingId(null);
      loadAdminUsers();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update admin user" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (user: AdminUserRow) => {
    try {
      const res = await fetch(`/api/admin-users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ variant: "destructive", title: "Error", description: data.error ?? "Failed to update" });
        return;
      }
      toast({ title: user.isActive ? "Account disabled" : "Account enabled", description: `${user.username} is now ${user.isActive ? "disabled" : "active"}` });
      loadAdminUsers();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update admin user" });
    }
  };

  const handleDelete = async () => {
    if (confirmDeleteId === null) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin-users/${confirmDeleteId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ variant: "destructive", title: "Error", description: data.error ?? "Failed to delete" });
        return;
      }
      toast({ title: "Deleted", description: "Admin user removed" });
      setConfirmDeleteId(null);
      loadAdminUsers();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete admin user" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-4 mb-4">
        <Button variant="ghost" onClick={onBack} className="text-slate-400">
          <X className="h-4 w-4 mr-2" /> Back
        </Button>
        <h2 className="text-xl font-bold text-white">Admin Users</h2>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadAdminUsers()} className="border-slate-600">
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="h-4 w-4 mr-2" /> Add Admin
          </Button>
        </div>
      </div>

      {showCreate && (
        <Card className="bg-slate-900/50 border-emerald-800/40 mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Plus className="h-4 w-4 text-emerald-400" /> New Admin User
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-400 text-xs">Username *</Label>
                <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="e.g. support_alice" className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-400 text-xs">Password *</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 8 characters" className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-400 text-xs">Role *</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as "viewer" | "agent" | "admin")}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="viewer" className="text-white">viewer — read-only</SelectItem>
                    <SelectItem value="agent" className="text-white">agent — standard</SelectItem>
                    <SelectItem value="admin" className="text-white">admin — elevated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-400 text-xs">Display Name</Label>
                <Input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="Optional" className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-slate-400 text-xs">Email</Label>
                <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Optional" className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setShowCreate(false)} className="text-slate-400">Cancel</Button>
              <Button onClick={handleCreate} disabled={creating} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-slate-900/50 border-slate-800">
        <CardContent className="p-4">
          <div className="space-y-3">
            {adminUsers.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No sub-admin users configured</p>
                <p className="text-xs mt-1">Click "Add Admin" to create the first sub-admin account</p>
              </div>
            ) : (
              adminUsers.map((user) => (
                <div key={user.id} className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                  {editingId === user.id ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-slate-400 text-xs">Role</Label>
                          <Select value={editRole} onValueChange={setEditRole}>
                            <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-700">
                              <SelectItem value="viewer" className="text-white">viewer</SelectItem>
                              <SelectItem value="agent" className="text-white">agent</SelectItem>
                              <SelectItem value="admin" className="text-white">admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-slate-400 text-xs">Display Name</Label>
                          <Input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" />
                        </div>
                        <div>
                          <Label className="text-slate-400 text-xs">Email</Label>
                          <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" />
                        </div>
                        <div>
                          <Label className="text-slate-400 text-xs">New Password (leave blank to keep)</Label>
                          <Input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Optional" className="bg-slate-800 border-slate-700 text-white mt-1" />
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} className="text-slate-400">Cancel</Button>
                        <Button size="sm" onClick={() => handleSave(user.id)} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
                          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${user.isActive ? 'bg-emerald-500/20' : 'bg-slate-700'}`}>
                            <User className={`h-5 w-5 ${user.isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
                          </div>
                          <div>
                            <p className="text-white font-medium">{user.displayName || user.username} {user.displayName && <span className="text-slate-500 text-xs">({user.username})</span>}</p>
                            <p className="text-slate-400 text-sm">{user.email || 'No email'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {user.twoFactorEnabled ? (
                            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30" title="2FA enabled">
                              <ShieldCheck className="h-3 w-3 mr-1" />2FA
                            </Badge>
                          ) : (
                            <Badge className="bg-slate-700/40 text-slate-500" title="2FA not enabled">
                              <ShieldAlert className="h-3 w-3 mr-1" />No 2FA
                            </Badge>
                          )}
                          <Badge className={roleBadgeClass(user.role)}>{user.role}</Badge>
                          <span className={`w-2 h-2 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-slate-600'}`} title={user.isActive ? 'Active' : 'Disabled'} />
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-slate-500">
                          Last login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
                        </span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(user)} className="h-7 text-xs text-slate-400 hover:text-white">
                            <Edit3 className="h-3 w-3 mr-1" />Edit
                          </Button>
                          {user.twoFactorEnabled && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReset2fa(user)}
                              disabled={resetting2faId === user.id}
                              className="h-7 text-xs text-amber-400 hover:text-amber-300"
                            >
                              {resetting2faId === user.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ShieldAlert className="h-3 w-3 mr-1" />}
                              Reset 2FA
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => handleToggleActive(user)} className={`h-7 text-xs ${user.isActive ? 'text-amber-400 hover:text-amber-300' : 'text-green-400 hover:text-green-300'}`}>
                            {user.isActive ? 'Disable' : 'Enable'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(user.id)} className="h-7 text-xs text-red-400 hover:text-red-300">
                            <Trash2 className="h-3 w-3 mr-1" />Delete
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDeleteId !== null} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <AlertDialogContent className="bg-slate-900 border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete Admin User</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This will permanently remove the admin account. Any active sessions will be invalidated on next request. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function SettingsTab() {
  const {
    settingsView,
    setSettingsView,
    chatTemplates,
    setIsTemplateManagerOpen,
    auditLogs,
    loadAuditLogs,
    emergencyResetActivity,
    loadEmergencyResetActivity,
    adminSessions,
    loadAdminSessions,
    revokeAdminSession,
    revokeOtherAdminSessions,
    failedLogins,
    failedLoginCount24h,
    loadFailedLogins,
    failedLoginsByIp,
    failedLoginsByIpWindowHours,
    loadFailedLoginsByIp,
    declarationReadAttempts,
    declarationReadCount24h,
    loadDeclarationReadAttempts,
    declarationReadByIp,
    declarationReadByIpWindowHours,
    loadDeclarationReadByIp,
    scheduledMessages,
    loadScheduledMessages,
    createScheduledMessage,
    cancelScheduledMessage,
    newScheduledMessage,
    setNewScheduledMessage,
    messageTemplates,
    loadMessageTemplates,
    createMessageTemplate,
    deleteMessageTemplate,
    newMessageTemplate,
    setNewMessageTemplate,
    helpArticles,
    loadHelpArticles,
    createHelpArticle,
    deleteHelpArticle,
    newHelpArticle,
    setNewHelpArticle,
    userFeedback,
    loadUserFeedback,
    documentRequests,
    loadDocumentRequests,
    createDocumentRequest,
    newDocumentRequest,
    setNewDocumentRequest,
    setDocumentRequestUploadsEnabled,
    adminUsers,
    loadAdminUsers,
    userSessions,
    loadUserSessions,
    deactivateUserSession,
    translations,
    selectedLocale,
    setSelectedLocale,
    loadTranslations,
    createTranslation,
    deleteTranslation,
    newTranslationKey,
    setNewTranslationKey,
    newTranslationValue,
    setNewTranslationValue,
    cases,
    theme,
    toggleTheme,
    authToken,
    adminRole,
  } = useAdminDashboard();

  // Per-IP drilldown for the Declaration Scans "By IP" tab.
  const declarationReadDrilldown = useDeclarationReadIpDrilldown();
  // Admin-managed blocked-IP denylist (Task #113). Used to render the
  // Block/Unblock control on each row of the "By IP" rollup.
  const blockedIps = useBlockedIps();

  const { toast } = useToast();
  const degradedServices = useServiceHealth();

  // Current admin's role — fetched once on mount so the settings view can
  // show/hide options that are only meaningful for sub-admin accounts (e.g. the
  // per-account 2FA setup card).
  const [_currentAdminRole, setCurrentAdminRole] = useState<string | null>(null);

  // Password override status — fetched once on mount so the main settings
  // view can surface a warning banner when the DB override is active.
  const [pwOverrideActive, setPwOverrideActive] = useState(false);
  const [pwOverrideChangedAt, setPwOverrideChangedAt] = useState<string | null>(null);
  const [pwOverrideResetting, setPwOverrideResetting] = useState(false);

  // Username strength — fetched from security-flags so the Change Username
  // card can show a "Trivial / OK" badge for the effective active username.
  // securityFlagsLoading is true while the fetch is in flight; false once it
  // settles (success or failure) so the badge area shows a skeleton instead
  // of the static "Security" text during the loading gap.
  const [adminUsernameTrivial, setAdminUsernameTrivial] = useState<boolean | null>(null);
  const [securityFlagsLoading, setSecurityFlagsLoading] = useState(true);

  // Password strength — fetched from security-flags so the Change Password
  // card can show a colour-coded "Weak / Medium / Strong" badge.
  const [adminPasswordStrength, setAdminPasswordStrength] = useState<"Weak" | "Medium" | "Strong" | null>(null);

  // Escape-hatch flags — show inline callouts next to the relevant credential
  // controls when a flag is active in a non-production environment, so operators
  // can see exactly which strength checks are bypassed without leaving the page.
  const [escapeHatchFlags, setEscapeHatchFlags] = useState<{
    weakAdminPasswordAllowed: boolean;
    weakAdminUsernameAllowed: boolean;
    weakSessionSecretAllowed: boolean;
    isProduction: boolean;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const token = sessionStorage.getItem("adminToken") ?? "";
      await Promise.all([
        (async () => {
          try {
            const res = await fetch("/api/admin/verify", {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              const data = await res.json();
              if (data.role) setCurrentAdminRole(data.role);
            }
          } catch {
            // non-fatal
          }
        })(),
        (async () => {
          try {
            const res = await fetch("/api/admin/password-override-status", {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              const data = await res.json();
              setPwOverrideActive(data.active === true);
              setPwOverrideChangedAt(data.changedAt ?? null);
            }
          } catch {
            // non-fatal
          }
        })(),
        (async () => {
          try {
            const res = await fetch("/api/admin/security-flags", {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              const data = await res.json();
              if (typeof data.adminUsernameTrivial === "boolean") {
                setAdminUsernameTrivial(data.adminUsernameTrivial);
              }
              if (data.adminPasswordStrength === "Weak" || data.adminPasswordStrength === "Medium" || data.adminPasswordStrength === "Strong") {
                setAdminPasswordStrength(data.adminPasswordStrength);
              }
              if (
                typeof data.weakAdminPasswordAllowed === "boolean" &&
                typeof data.weakAdminUsernameAllowed === "boolean" &&
                typeof data.weakSessionSecretAllowed === "boolean" &&
                typeof data.isProduction === "boolean"
              ) {
                setEscapeHatchFlags({
                  weakAdminPasswordAllowed: data.weakAdminPasswordAllowed,
                  weakAdminUsernameAllowed: data.weakAdminUsernameAllowed,
                  weakSessionSecretAllowed: data.weakSessionSecretAllowed,
                  isProduction: data.isProduction,
                });
              }
            }
          } catch {
            // non-fatal
          } finally {
            setSecurityFlagsLoading(false);
          }
        })(),
      ]);
    })();
  }, []);

  const handleResetPasswordOverride = async () => {
    setPwOverrideResetting(true);
    try {
      const token = sessionStorage.getItem("adminToken") ?? "";
      const res = await fetch("/api/admin/password-override", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setPwOverrideActive(false);
        setPwOverrideChangedAt(null);
        toast({
          title: "Password override cleared",
          description: "Authentication now uses the ADMIN_PASSWORD environment variable.",
        });
      } else {
        const data = await res.json().catch(() => ({}));
        toast({
          title: "Failed to clear override",
          description: data?.error ?? `Error ${res.status}`,
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setPwOverrideResetting(false);
    }
  };

  // Change-password form state.
  const [cpCurrentPassword, setCpCurrentPassword] = useState("");
  const [cpNewPassword, setCpNewPassword] = useState("");
  const [cpConfirmPassword, setCpConfirmPassword] = useState("");
  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState<string | null>(null);

  // Change-username form state.
  const [cuCurrentPassword, setCuCurrentPassword] = useState("");
  const [cuNewUsername, setCuNewUsername] = useState("");
  const [cuLoading, setCuLoading] = useState(false);
  const [cuError, setCuError] = useState<string | null>(null);

  const handleChangeUsername = async () => {
    setCuError(null);
    if (!cuCurrentPassword || !cuNewUsername) {
      setCuError("All fields are required.");
      return;
    }
    const reason = getUsernameTrivialReason(cuNewUsername);
    if (reason !== null) {
      setCuError(USERNAME_TRIVIAL_HINTS[reason]);
      return;
    }
    setCuLoading(true);
    try {
      const token = sessionStorage.getItem("adminToken") ?? "";
      const res = await fetch("/api/admin/change-username", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword: cuCurrentPassword, newUsername: cuNewUsername }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCuError(data?.error ?? `Error ${res.status}`);
        return;
      }
      toast({ title: "Username changed", description: "Your admin username has been updated. Re-login will use the new username." });
      setCuCurrentPassword("");
      setCuNewUsername("");
      setSettingsView("main");
    } catch {
      setCuError("Network error. Please try again.");
    } finally {
      setCuLoading(false);
    }
  };

  const handleChangePassword = async () => {
    setCpError(null);
    if (!cpCurrentPassword || !cpNewPassword || !cpConfirmPassword) {
      setCpError("All fields are required.");
      return;
    }
    if (cpNewPassword !== cpConfirmPassword) {
      setCpError("New passwords do not match.");
      return;
    }
    const strength = getPasswordStrength(cpNewPassword);
    if (strength === "Weak") {
      setCpError("New password is too weak. Choose a Medium or Strong password.");
      return;
    }
    setCpLoading(true);
    try {
      const token = sessionStorage.getItem("adminToken") ?? "";
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword: cpCurrentPassword, newPassword: cpNewPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCpError(data?.error ?? `Error ${res.status}`);
        return;
      }
      toast({ title: "Password changed", description: "Your admin password has been updated." });
      setCpCurrentPassword("");
      setCpNewPassword("");
      setCpConfirmPassword("");
      try {
        sessionStorage.removeItem(WEAK_PASSWORD_DISMISSED_KEY);
      } catch {
        /* sessionStorage may be unavailable */
      }
      setSettingsView("main");
      // Re-fetch security-flags so the badge reflects the new password strength
      // immediately without requiring a page reload.
      try {
        const flagsRes = await fetch("/api/admin/security-flags", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (flagsRes.ok) {
          const flagsData = await flagsRes.json();
          if (
            flagsData.adminPasswordStrength === "Weak" ||
            flagsData.adminPasswordStrength === "Medium" ||
            flagsData.adminPasswordStrength === "Strong"
          ) {
            setAdminPasswordStrength(flagsData.adminPasswordStrength);
          }
        }
      } catch {
        // non-fatal — badge will reflect current value until next natural refresh
      }
    } catch {
      setCpError("Network error. Please try again.");
    } finally {
      setCpLoading(false);
    }
  };

  const [portalRefreshEnabled, setPortalRefreshEnabled] = useState(false);
  const [portalRefreshLoading, setPortalRefreshLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/portal-refresh-mode", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setPortalRefreshEnabled(data.enabled === true);
        }
      } catch {
        // non-fatal
      }
    })();
  }, [authToken]);

  const handlePortalRefreshToggle = async (next: boolean) => {
    setPortalRefreshLoading(true);
    try {
      const res = await fetch("/api/admin/portal-refresh-mode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) {
        setPortalRefreshEnabled(next);
        toast({
          title: next ? "Portal Refresh Mode ON" : "Portal Refresh Mode OFF",
          description: next
            ? "All portal users now see the refresh hold screen."
            : "Portal access has been restored for all users.",
        });
      } else {
        toast({ title: "Failed to update setting", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setPortalRefreshLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {settingsView === 'main' ? (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Admin Settings</h2>
              <p className="text-slate-400 text-sm">Configure templates, security, and admin tools.</p>
            </div>
          </div>

          {pwOverrideActive && (
            <div
              className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3"
              data-testid="banner-password-override"
              role="alert"
            >
              <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-300">
                  Password last changed in dashboard — <code className="font-mono text-amber-200">ADMIN_PASSWORD</code> env var is currently ignored.
                </p>
                <p className="text-xs text-amber-400/80 mt-0.5">
                  To make the change permanent, update <code className="font-mono">ADMIN_PASSWORD</code> in your environment and restart the server.
                  {pwOverrideChangedAt && (
                    <> Changed {new Date(pwOverrideChangedAt).toLocaleString()}.</>
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-amber-500/50 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200"
                disabled={pwOverrideResetting}
                onClick={handleResetPasswordOverride}
                data-testid="btn-reset-password-override"
              >
                {pwOverrideResetting ? (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5 mr-1.5" />
                )}
                Reset to env var
              </Button>
            </div>
          )}

          {escapeHatchFlags &&
            !escapeHatchFlags.isProduction &&
            escapeHatchFlags.weakSessionSecretAllowed && (
              <div
                className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3"
                data-testid="callout-escape-hatch-session-secret"
                role="note"
              >
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" aria-hidden />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-300">
                    Session-secret strength check bypassed
                  </p>
                  <p className="text-xs text-amber-400/80 mt-0.5">
                    <code className="font-mono text-amber-200">ALLOW_WEAK_SESSION_SECRET=1</code> is
                    active — the session-secret strength requirement is skipped. Remove this flag
                    before deploying to production.
                  </p>
                </div>
              </div>
            )}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Chat Templates Card */}
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => setIsTemplateManagerOpen(true)}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Zap className="h-5 w-5 text-amber-400" />
                  Chat Templates
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Quick response templates for support</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-amber-500/20 text-amber-300">{chatTemplates.length} templates</Badge>
                  <Settings className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Audit Logs Card */}
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => { setSettingsView('audit'); loadAuditLogs(); }}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <History className="h-5 w-5 text-purple-400" />
                  Audit Logs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">View all admin activity logs</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-purple-500/20 text-purple-300">Compliance</Badge>
                  <Eye className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Emergency Reset Activity Card (Task #2403) */}
            <Card
              className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              onClick={() => { setSettingsView('emergency-reset'); loadEmergencyResetActivity(); }}
              data-testid="card-emergency-reset-activity"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <ShieldCheck className="h-5 w-5 text-red-400" />
                  Emergency Access Recovery
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Lockout-recovery link requests and completions</p>
                <div className="flex items-center justify-between">
                  <Badge
                    className={
                      emergencyResetActivity.events.length > 0
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-slate-700/40 text-slate-300'
                    }
                    data-testid="badge-emergency-reset-count"
                  >
                    {emergencyResetActivity.events.length} recent event{emergencyResetActivity.events.length === 1 ? '' : 's'}
                  </Badge>
                  <Eye className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Session Management Card */}
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => { setSettingsView('sessions'); loadAdminSessions(); }}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <ShieldCheck className="h-5 w-5 text-green-400" />
                  Active Sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Manage admin login sessions</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-green-500/20 text-green-300">Security</Badge>
                  <Lock className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Failed Sign-ins Card */}
            <Card
              className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              onClick={() => {
                setSettingsView('failed-logins');
                loadFailedLogins();
                loadFailedLoginsByIp();
              }}
              data-testid="card-failed-logins"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <ShieldAlert className={`h-5 w-5 ${failedLoginCount24h > 0 ? 'text-red-400' : 'text-slate-400'}`} />
                  Failed Sign-ins
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Spot brute-force attempts</p>
                <div className="flex items-center justify-between">
                  <Badge
                    className={
                      failedLoginCount24h > 0
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-slate-700/40 text-slate-300'
                    }
                    data-testid="badge-failed-logins-24h"
                  >
                    {failedLoginCount24h} in last 24h
                  </Badge>
                  <Eye className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Declaration-Read Scans Card — Task #109 brute-force trap */}
            <Card
              className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              onClick={() => {
                setSettingsView('declaration-reads');
                loadDeclarationReadAttempts();
                loadDeclarationReadByIp();
              }}
              data-testid="card-declaration-reads"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <ShieldAlert
                    className={`h-5 w-5 ${declarationReadCount24h > 0 ? 'text-red-400' : 'text-slate-400'}`}
                  />
                  Declaration Scans
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">
                  Unauthorized declaration-read attempts
                </p>
                <div className="flex items-center justify-between">
                  <Badge
                    className={
                      declarationReadCount24h > 0
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-slate-700/40 text-slate-300'
                    }
                    data-testid="badge-declaration-reads-24h"
                  >
                    {declarationReadCount24h} in last 24h
                  </Badge>
                  <Eye className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Scheduled Messages Card */}
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => { setSettingsView('scheduled'); loadScheduledMessages(); }}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Clock className="h-5 w-5 text-blue-400" />
                  Scheduled Messages
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Schedule messages for future delivery</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-blue-500/20 text-blue-300">{scheduledMessages.length} pending</Badge>
                  <Send className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Message Templates Card */}
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => { setSettingsView('templates'); loadMessageTemplates(); }}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Mail className="h-5 w-5 text-cyan-400" />
                  Message Templates
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Reusable admin message templates</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-cyan-500/20 text-cyan-300">{messageTemplates.length} templates</Badge>
                  <FileText className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Help Center Card */}
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => { setSettingsView('help'); loadHelpArticles(); }}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <ExternalLink className="h-5 w-5 text-indigo-400" />
                  Help Center
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Manage knowledge base articles</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-indigo-500/20 text-indigo-300">{helpArticles.length} articles</Badge>
                  <Edit3 className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* User Feedback Card */}
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => { setSettingsView('feedback'); loadUserFeedback(); }}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <BarChart3 className="h-5 w-5 text-pink-400" />
                  User Feedback
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">View user ratings and comments</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-pink-500/20 text-pink-300">{userFeedback.length} responses</Badge>
                  <TrendingUp className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Document Requests Card */}
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => { setSettingsView('documents'); loadDocumentRequests(); }}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Upload className="h-5 w-5 text-orange-400" />
                  Document Requests
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Request documents from users</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-orange-500/20 text-orange-300">{documentRequests.filter(d => d.status === 'pending').length} pending</Badge>
                  <FolderOpen className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* 2FA Security Card */}
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => setSettingsView('2fa')}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Key className="h-5 w-5 text-red-400" />
                  Two-Factor Auth
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Set up 2FA for enhanced security</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-red-500/20 text-red-300">Security</Badge>
                  <ShieldCheck className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Change Password Card */}
            <Card
              className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              onClick={() => { setCpError(null); setSettingsView('change-password'); }}
              data-testid="card-change-password"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Lock className="h-5 w-5 text-violet-400" />
                  Change Password
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Update your admin login password</p>
                <div className="flex items-center justify-between">
                  {adminPasswordStrength === "Weak" ? (
                    <Badge
                      className="bg-red-500/20 text-red-300 border border-red-500/30"
                      data-testid="badge-password-strength-weak"
                    >
                      Weak — change now
                    </Badge>
                  ) : adminPasswordStrength === "Medium" ? (
                    <Badge
                      className="bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      data-testid="badge-password-strength-medium"
                    >
                      Medium
                    </Badge>
                  ) : adminPasswordStrength === "Strong" ? (
                    <Badge
                      className="bg-green-500/20 text-green-300 border border-green-500/30"
                      data-testid="badge-password-strength-strong"
                    >
                      Strong
                    </Badge>
                  ) : (
                    <Badge className="bg-violet-500/20 text-violet-300">Security</Badge>
                  )}
                  <Key className="h-4 w-4 text-slate-500" />
                </div>
                <EscapeHatchFlagCallout
                  flag="password"
                  active={escapeHatchFlags?.weakAdminPasswordAllowed ?? false}
                  isProduction={escapeHatchFlags?.isProduction ?? true}
                />
              </CardContent>
            </Card>

            {/* Change Username Card */}
            <Card
              className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              onClick={() => { setCuError(null); setSettingsView('change-username'); }}
              data-testid="card-change-username"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <User className="h-5 w-5 text-teal-400" />
                  Change Username
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Update your admin login username</p>
                <div className="flex items-center justify-between">
                  {adminUsernameTrivial === true ? (
                    <Badge
                      className="bg-red-500/20 text-red-300 border border-red-500/30"
                      data-testid="badge-username-strength-trivial"
                    >
                      Trivial — change now
                    </Badge>
                  ) : adminUsernameTrivial === false ? (
                    <Badge
                      className="bg-teal-500/20 text-teal-300 border border-teal-500/30"
                      data-testid="badge-username-strength-ok"
                    >
                      OK
                    </Badge>
                  ) : securityFlagsLoading ? (
                    <div
                      className="h-5 w-20 rounded-full bg-slate-700/60 animate-pulse"
                      data-testid="badge-username-strength-loading"
                      aria-label="Loading username strength…"
                    />
                  ) : (
                    <Badge className="bg-slate-700/40 text-slate-400">Security</Badge>
                  )}
                  <Key className="h-4 w-4 text-slate-500" />
                </div>
                <EscapeHatchFlagCallout
                  flag="username"
                  active={escapeHatchFlags?.weakAdminUsernameAllowed ?? false}
                  isProduction={escapeHatchFlags?.isProduction ?? true}
                />
              </CardContent>
            </Card>

            {/* Admin Users Card — super_admin only (only super_admin can manage
                sub-admin accounts; lower roles see a 403 from the server). */}
            {adminRole === 'super_admin' && (
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => { setSettingsView('admin-users'); loadAdminUsers(); }}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Users className="h-5 w-5 text-emerald-400" />
                  Admin Users
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Manage admin accounts and roles</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-emerald-500/20 text-emerald-300">{adminUsers.length} admins</Badge>
                  <User className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>
            )}

            {/* My 2FA Card — sub-admins (non-super_admin) only */}
            {adminRole !== null && adminRole !== 'super_admin' && (
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => setSettingsView('sub-2fa')}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <ShieldCheck className="h-5 w-5 text-blue-400" />
                  My Two-Factor Auth
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Set up TOTP 2FA for your account</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-blue-500/20 text-blue-300">Security</Badge>
                  <Key className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>
            )}

            {/* User Sessions Card */}
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => { setSettingsView('user-sessions'); loadUserSessions(); }}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Activity className="h-5 w-5 text-teal-400" />
                  User Sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">View active user portal sessions</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-teal-500/20 text-teal-300">{userSessions.length} active</Badge>
                  <Eye className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Translations Card */}
            <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer" onClick={() => { setSettingsView('translations'); loadTranslations(selectedLocale); }}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Globe className="h-5 w-5 text-cyan-400" />
                  Translations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Multi-language support</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-cyan-500/20 text-cyan-300">{translations.length} keys</Badge>
                  <Languages className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* NDA Signing Languages Card — Task #88 per-language allowlist */}
            <Card
              className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              onClick={() => setSettingsView('nda-signing-locales')}
              data-testid="card-nda-signing-locales"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <FileText className="h-5 w-5 text-violet-400" />
                  NDA Signing Languages
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">
                  Enable signing one language at a time as counsel approves each translation
                </p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-violet-500/20 text-violet-300">Compliance</Badge>
                  <Settings className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Portal Refresh Mode — inline toggle, no drilldown */}
            <Card
              className={`bg-slate-900/50 border-slate-800 transition-colors ${portalRefreshEnabled ? 'border-amber-500/40' : ''}`}
              data-testid="card-portal-refresh-mode"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <RefreshCw className={`h-5 w-5 ${portalRefreshEnabled ? 'text-amber-400' : 'text-slate-400'}`} />
                  Portal Refresh Mode
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">
                  Lock all portal users into a hold screen during maintenance
                </p>
                <div className="flex items-center justify-between">
                  <Badge className={portalRefreshEnabled ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700/50 text-slate-400'}>
                    {portalRefreshEnabled ? 'ACTIVE' : 'Off'}
                  </Badge>
                  <Switch
                    checked={portalRefreshEnabled}
                    disabled={portalRefreshLoading}
                    onCheckedChange={handlePortalRefreshToggle}
                    aria-label="Toggle portal refresh mode"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Tamper Alert Email Recipient Card — Task #81 */}
            <Card
              className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              onClick={() => setSettingsView('tamper-alert-email')}
              data-testid="card-tamper-alert-email"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Mail className="h-5 w-5 text-rose-400" />
                  Tamper Alert Recipient
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">
                  Who receives sealed-NDA tamper alert emails
                </p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-rose-500/20 text-rose-300">Security</Badge>
                  <Settings className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Document Upload Alert Recipient Card — Task #219 */}
            <Card
              className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              onClick={() => setSettingsView('document-upload-alert-email')}
              data-testid="card-document-upload-alert-email"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Mail className="h-5 w-5 text-blue-400" />
                  Document Upload Alert
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">
                  Who receives email alerts when users upload documents
                </p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-blue-500/20 text-blue-300">Compliance</Badge>
                  <Settings className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Sound Notifications Card */}
            <Card
              className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              onClick={() => setSettingsView('sound')}
              data-testid="card-sound-settings"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Volume2 className="h-5 w-5 text-violet-400" />
                  Sound Notifications
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Volume, tones and per-event assignments</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-violet-500/20 text-violet-300">Audio</Badge>
                  <Settings className="h-4 w-4 text-slate-500" />
                </div>
              </CardContent>
            </Card>

            {/* Service Health Card */}
            <Card
              className={
                degradedServices.length > 0
                  ? "bg-slate-900/50 border-red-500/60 hover:border-red-400/80 transition-colors cursor-pointer"
                  : "bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              }
              onClick={() => setSettingsView('service-health')}
              data-testid="card-service-health"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  <Activity
                    className={
                      degradedServices.length > 0
                        ? "h-5 w-5 text-red-400"
                        : "h-5 w-5 text-emerald-400"
                    }
                  />
                  Service Health
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">DB, SMTP, and AI status at a glance</p>
                <div className="flex items-center justify-between">
                  {degradedServices.length > 0 ? (
                    <Badge
                      className="bg-red-500/20 text-red-300 flex items-center gap-1"
                      data-testid="badge-service-health-degraded"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {degradedServices.length} degraded
                    </Badge>
                  ) : (
                    <Badge className="bg-emerald-500/20 text-emerald-300">Live</Badge>
                  )}
                  <Activity
                    className={
                      degradedServices.length > 0
                        ? "h-4 w-4 text-red-400/70"
                        : "h-4 w-4 text-slate-500"
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* Theme Settings Card */}
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-base">
                  {theme === 'dark' ? <Moon className="h-5 w-5 text-blue-400" /> : <Sun className="h-5 w-5 text-amber-400" />}
                  Theme
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-400 mb-3">Dashboard appearance</p>
                <Button variant="outline" size="sm" onClick={toggleTheme} className="w-full border-slate-600">
                  {theme === 'dark' ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </Button>
              </CardContent>
            </Card>
          </div>
          <EmailTemplatesCard />
          <StampDutyWalletsCard />
          <SentryDiagnosticsCard />
        </>
      ) : settingsView === 'audit' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">Audit Logs</h2>
            <Button variant="outline" size="sm" onClick={loadAuditLogs} className="ml-auto border-slate-600">
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
          <AuditRetentionCard />
          <CommunityParticipantRetentionCard />
          <WalletConnectAlertMarkerCleanupCard />
          <WalletConnectCompletionBackfillCard />
          <WalletConnectAlertCleanupIntervalCard />
          <CommunityThreadViewsCleanupCard />
          <NdaSweepIntervalCard />
          <NdaSweepStaleGraceCard />
          <NdaSweepSummaryFrequencyCard />
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-300">Timestamp</TableHead>
                      <TableHead className="text-slate-300">Admin</TableHead>
                      <TableHead className="text-slate-300">Action</TableHead>
                      <TableHead className="text-slate-300">Resource</TableHead>
                      <TableHead className="text-slate-300">Description</TableHead>
                      <TableHead className="text-slate-300">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                          <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>No audit logs recorded yet</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      auditLogs.map((log) => (
                        <TableRow key={log.id} className="border-slate-800">
                          <TableCell className="text-slate-400 text-sm">
                            {new Date(log.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-white">{log.adminUsername}</TableCell>
                          <TableCell>
                            <Badge className={
                              log.action.includes('delete') ? 'bg-red-500/20 text-red-300' :
                              log.action.includes('create') ? 'bg-green-500/20 text-green-300' :
                              'bg-blue-500/20 text-blue-300'
                            }>{getAuditActionLabel(log.action)}</Badge>
                          </TableCell>
                          <TableCell className="text-slate-300">{log.resourceType}</TableCell>
                          <TableCell className="text-slate-400 text-sm max-w-[200px] truncate">{log.description}</TableCell>
                          <TableCell className="text-slate-400 text-xs max-w-[240px]">
                            {log.newValue && (
                              <div className="bg-slate-800/60 rounded px-2 py-1 break-words">
                                {formatAuditValue(log.action, log.newValue)}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : settingsView === 'emergency-reset' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">Emergency Access Recovery</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={loadEmergencyResetActivity}
              className="ml-auto border-slate-600"
              data-testid="button-refresh-emergency-reset-activity"
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            Recent activity for the "Locked out?" self-service recovery flow. A completed reset rewrites
            the admin's own credentials, so review this list if you didn't personally request or complete one.
          </p>
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-300">Timestamp</TableHead>
                      <TableHead className="text-slate-300">Event</TableHead>
                      <TableHead className="text-slate-300">Requesting IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {emergencyResetActivity.events.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-8 text-slate-500">
                          <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>No emergency reset activity recorded</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      emergencyResetActivity.events.map((event) => (
                        <TableRow key={event.id} className="border-slate-800" data-testid={`row-emergency-reset-${event.id}`}>
                          <TableCell className="text-slate-400 text-sm whitespace-nowrap">
                            {new Date(event.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                event.action === 'admin_emergency_reset_used'
                                  ? 'bg-red-500/20 text-red-300'
                                  : 'bg-amber-500/20 text-amber-300'
                              }
                            >
                              {getAuditActionLabel(event.action)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-white font-mono text-sm">
                            {event.ipAddress ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : settingsView === 'sessions' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">Active Sessions</h2>
            <Button variant="outline" size="sm" onClick={loadAdminSessions} className="ml-auto border-slate-600">
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
            {adminSessions.filter((s) => s.isActive && !s.isCurrent).length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (window.confirm('Sign out every other admin session? Anyone using the dashboard on a different device will be logged out immediately.')) {
                    revokeOtherAdminSessions();
                  }
                }}
                data-testid="button-revoke-other-sessions"
              >
                Sign out other sessions
              </Button>
            )}
          </div>
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-4">
              <div className="space-y-3">
                {adminSessions.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No active sessions found</p>
                  </div>
                ) : (
                  adminSessions.map((session) => {
                    const browser = describeUserAgent(session.userAgent);
                    return (
                    <div
                      key={session.id}
                      className={`p-4 rounded-lg border ${
                        session.isCurrent
                          ? 'bg-blue-950/30 border-blue-500/40'
                          : session.isActive
                            ? 'bg-slate-800/50 border-slate-700'
                            : 'bg-slate-900/50 border-slate-800 opacity-60'
                      }`}
                      data-testid={`admin-session-${session.id}`}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${session.isCurrent ? 'bg-blue-500/20' : session.isActive ? 'bg-green-500/20' : 'bg-slate-700'}`}>
                            <ShieldCheck className={`h-5 w-5 ${session.isCurrent ? 'text-blue-300' : session.isActive ? 'text-green-400' : 'text-slate-500'}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-white font-medium truncate">{session.adminUsername}</p>
                              {session.isCurrent && (
                                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                  This device
                                </span>
                              )}
                            </div>
                            <p className="text-slate-400 text-sm truncate">
                              {browser} · {session.ipAddress || 'Unknown IP'}{session.location && ` · ${session.location}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-slate-400 text-xs">Last active</p>
                            <p className="text-slate-300 text-sm">{new Date(session.lastActivityAt).toLocaleString()}</p>
                          </div>
                          {session.isActive && !session.isCurrent && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => revokeAdminSession(session.id)}
                              data-testid={`button-revoke-session-${session.id}`}
                            >
                              Revoke
                            </Button>
                          )}
                          {session.isCurrent && (
                            <span className="text-xs text-slate-500 italic" title="Use Sign Out to end the current session">
                              Use logout
                            </span>
                          )}
                        </div>
                      </div>
                      {session.userAgent && (
                        <div className="mt-2 text-xs text-slate-500 truncate" title={session.userAgent}>
                          {session.userAgent}
                        </div>
                      )}
                    </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </>
      ) : settingsView === 'failed-logins' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">Recent failed sign-ins</h2>
            <Badge
              className={
                failedLoginCount24h > 0
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-slate-700/40 text-slate-300'
              }
              data-testid="badge-failed-logins-24h-detail"
            >
              {failedLoginCount24h} in last 24h
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                loadFailedLogins();
                loadFailedLoginsByIp();
              }}
              className="ml-auto border-slate-600"
              data-testid="button-refresh-failed-logins"
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
          {/*
            Two views over the same audit data:
            - "By IP" rolls up per source IP so a brute-force burst from one
              IP collapses into a single row. Best for spotting attacks.
            - "By attempt" is the raw chronological feed for forensics /
              "what exactly was tried at 14:03?".
          */}
          <Tabs defaultValue="by-ip" className="space-y-4">
            <TabsList className="bg-slate-900 border border-slate-800">
              <TabsTrigger value="by-ip" data-testid="tab-failed-logins-by-ip">
                <Network className="h-4 w-4 mr-2" /> By IP
                <Badge className="ml-2 bg-slate-700/60 text-slate-200">
                  {failedLoginsByIp.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="by-attempt" data-testid="tab-failed-logins-by-attempt">
                <ListOrdered className="h-4 w-4 mr-2" /> By attempt
              </TabsTrigger>
            </TabsList>

            <TabsContent value="by-ip" className="mt-0">
              <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-0">
                  <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-800">
                    Grouped over the last {failedLoginsByIpWindowHours}h.
                    Rows highlighted red are likely brute-force activity
                    (10+ attempts, 3+ usernames, or currently rate-limited).
                  </div>
                  <div className="max-h-[500px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700">
                          <TableHead className="text-slate-300">IP address</TableHead>
                          <TableHead className="text-slate-300 text-right">Attempts</TableHead>
                          <TableHead className="text-slate-300 text-right">Distinct usernames</TableHead>
                          <TableHead className="text-slate-300">Mix</TableHead>
                          <TableHead className="text-slate-300">First seen</TableHead>
                          <TableHead className="text-slate-300">Last seen</TableHead>
                          <TableHead className="text-slate-300">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {failedLoginsByIp.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                              <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
                              <p>No failed sign-ins from any IP in this window</p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          failedLoginsByIp.map((row) => {
                            // "Looks like brute force" heuristic. Tuned for
                            // an admin-only panel: many attempts OR many
                            // usernames OR an active rate-limit lockout all
                            // get the same red treatment.
                            const isSuspicious =
                              row.attemptCount >= 10 ||
                              row.distinctUsernameCount >= 3 ||
                              row.isThrottled;
                            const usernamesPreview = row.distinctUsernames
                              .slice(0, 3)
                              .join(', ');
                            const usernamesOverflow =
                              row.distinctUsernameCount > 3
                                ? ` +${row.distinctUsernameCount - 3} more`
                                : '';
                            return (
                              <TableRow
                                key={row.ipAddress}
                                className={
                                  isSuspicious
                                    ? 'border-red-500/30 bg-red-500/5'
                                    : 'border-slate-800'
                                }
                                data-testid={`failed-login-ip-${row.ipAddress}`}
                              >
                                <TableCell className="text-white font-mono text-sm">
                                  {row.ipAddress}
                                </TableCell>
                                <TableCell className="text-right">
                                  <span
                                    className={
                                      isSuspicious
                                        ? 'text-red-300 font-semibold'
                                        : 'text-slate-200'
                                    }
                                    data-testid={`text-attempt-count-${row.ipAddress}`}
                                  >
                                    {row.attemptCount}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <span
                                    className={
                                      row.distinctUsernameCount >= 3
                                        ? 'text-red-300 font-semibold'
                                        : 'text-slate-300'
                                    }
                                    title={row.distinctUsernames.join(', ')}
                                  >
                                    {row.distinctUsernameCount}
                                  </span>
                                  {row.distinctUsernameCount > 0 && (
                                    <div
                                      className="text-xs text-slate-500 truncate max-w-[200px]"
                                      title={row.distinctUsernames.join(', ')}
                                    >
                                      {usernamesPreview}
                                      {usernamesOverflow}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {row.badPasswordCount > 0 && (
                                      <Badge className="bg-red-500/20 text-red-300 border border-red-500/30">
                                        {row.badPasswordCount} bad pw
                                      </Badge>
                                    )}
                                    {row.throttledCount > 0 && (
                                      <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                        {row.throttledCount} throttled
                                      </Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-slate-400 text-xs whitespace-nowrap">
                                  {new Date(row.firstAttemptAt).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-slate-400 text-xs whitespace-nowrap">
                                  {new Date(row.lastAttemptAt).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  {/*
                                    "Rate-limited" is a heuristic inferred
                                    from any admin_login_throttled audit row
                                    in the last 15 min (the limiter window) —
                                    the actual lockout state is held in
                                    server memory. The title attribute below
                                    surfaces this caveat to the admin.
                                  */}
                                  {row.isThrottled ? (
                                    <Badge
                                      className="bg-amber-500/30 text-amber-200 border border-amber-500/40"
                                      data-testid={`badge-throttled-${row.ipAddress}`}
                                      title="Heuristic: this IP triggered the rate-limiter within the last 15 minutes (matching the lockout window). The exact lockout state is held in-memory by the server."
                                    >
                                      <Lock className="h-3 w-3 mr-1" />
                                      Rate-limited
                                    </Badge>
                                  ) : isSuspicious ? (
                                    <Badge
                                      className="bg-red-500/20 text-red-300 border border-red-500/30"
                                      title="10+ attempts, or 3+ different usernames tried, or recently rate-limited."
                                    >
                                      <ShieldAlert className="h-3 w-3 mr-1" />
                                      Suspicious
                                    </Badge>
                                  ) : (
                                    <Badge
                                      className="bg-slate-700/40 text-slate-300"
                                      title="Below brute-force thresholds — likely a one-off typo or fat-finger."
                                    >
                                      Noise
                                    </Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="by-attempt" className="mt-0">
              <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-0">
                  <div className="max-h-[500px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700">
                          <TableHead className="text-slate-300">When</TableHead>
                          <TableHead className="text-slate-300">Type</TableHead>
                          <TableHead className="text-slate-300">Username tried</TableHead>
                          <TableHead className="text-slate-300">IP address</TableHead>
                          <TableHead className="text-slate-300">User agent</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {failedLogins.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                              <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-50" />
                              <p>No failed sign-in attempts recorded</p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          failedLogins.map((attempt) => {
                            const isThrottled = attempt.action === 'admin_login_throttled';
                            return (
                              <TableRow
                                key={attempt.id}
                                className="border-slate-800"
                                data-testid={`failed-login-${attempt.id}`}
                              >
                                <TableCell className="text-slate-400 text-sm whitespace-nowrap">
                                  {new Date(attempt.createdAt).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    className={
                                      isThrottled
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                        : 'bg-red-500/20 text-red-300 border border-red-500/30'
                                    }
                                  >
                                    {isThrottled ? 'Rate-limited' : 'Bad password'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-white font-mono text-sm">
                                  {attempt.attemptedUsername || 'unknown'}
                                </TableCell>
                                <TableCell className="text-slate-300 text-sm font-mono">
                                  {attempt.ipAddress || '—'}
                                </TableCell>
                                <TableCell
                                  className="text-slate-400 text-xs max-w-[280px] truncate"
                                  title={attempt.userAgent ?? ''}
                                >
                                  {attempt.userAgent
                                    ? `${describeUserAgent(attempt.userAgent)} · ${attempt.userAgent}`
                                    : '—'}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : settingsView === 'declaration-reads' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">
              Suspicious declaration-read attempts
            </h2>
            <Badge
              className={
                declarationReadCount24h > 0
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-slate-700/40 text-slate-300'
              }
              data-testid="badge-declaration-reads-24h-detail"
            >
              {declarationReadCount24h} in last 24h
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                loadDeclarationReadAttempts();
                loadDeclarationReadByIp();
              }}
              className="ml-auto border-slate-600"
              data-testid="button-refresh-declaration-reads"
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
          {/*
            Same two-view pattern as Failed Sign-ins:
            - "By IP" rolls up the per-IP scanner activity with a
              credential-type breakdown so you can see what an attacker
              is iterating on (wrong_code vs case_missing vs none).
            - "By attempt" is the chronological forensic feed.
          */}
          <Tabs defaultValue="by-ip" className="space-y-4">
            <TabsList className="bg-slate-900 border border-slate-800">
              <TabsTrigger value="by-ip" data-testid="tab-declaration-reads-by-ip">
                <Network className="h-4 w-4 mr-2" /> By IP
                <Badge className="ml-2 bg-slate-700/60 text-slate-200">
                  {declarationReadByIp.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="by-attempt" data-testid="tab-declaration-reads-by-attempt">
                <ListOrdered className="h-4 w-4 mr-2" /> By attempt
              </TabsTrigger>
            </TabsList>

            <TabsContent value="by-ip" className="mt-0">
              <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-0">
                  <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-800">
                    Grouped over the last {declarationReadByIpWindowHours}h.
                    Rows highlighted red look like deliberate enumeration
                    (10+ attempts, 3+ distinct cases probed, or currently
                    rate-limited).
                  </div>
                  <div className="max-h-[500px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700">
                          <TableHead className="text-slate-300">IP address</TableHead>
                          <TableHead className="text-slate-300 text-right">Attempts</TableHead>
                          <TableHead className="text-slate-300 text-right">Distinct cases</TableHead>
                          <TableHead className="text-slate-300">Credential mix</TableHead>
                          <TableHead className="text-slate-300">First seen</TableHead>
                          <TableHead className="text-slate-300">Last seen</TableHead>
                          <TableHead className="text-slate-300">Status</TableHead>
                          <TableHead className="text-slate-300 text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {declarationReadByIp.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                              <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
                              <p>No unauthorized declaration reads from any IP in this window</p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          declarationReadByIp.flatMap((row) => {
                            // Same shape as the failed-logins heuristic:
                            // many attempts OR many distinct cases probed
                            // OR currently rate-limited all earn the
                            // "suspicious" treatment.
                            const isSuspicious =
                              row.attemptCount >= 10 ||
                              row.distinctCaseCount >= 3 ||
                              row.isThrottled;
                            const credEntries = Object.entries(
                              row.credentialTypeCounts ?? {},
                            ).sort((a, b) => b[1] - a[1]);
                            const casesPreview = row.distinctCaseIds
                              .slice(0, 3)
                              .join(', ');
                            const casesOverflow =
                              row.distinctCaseCount > 3
                                ? ` +${row.distinctCaseCount - 3} more`
                                : '';
                            const isExpanded =
                              declarationReadDrilldown.expandedIp === row.ipAddress;
                            const rows = [
                              <TableRow
                                key={row.ipAddress}
                                className={`cursor-pointer ${
                                  isSuspicious
                                    ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
                                    : 'border-slate-800 hover:bg-slate-800/40'
                                }`}
                                data-testid={`declaration-read-ip-${row.ipAddress}`}
                                onClick={() =>
                                  declarationReadDrilldown.toggle(row.ipAddress)
                                }
                              >
                                <TableCell className="text-white font-mono text-sm">
                                  <span className="inline-flex items-center gap-1">
                                    {isExpanded ? (
                                      <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                                    )}
                                    {row.ipAddress}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <span
                                    className={
                                      isSuspicious
                                        ? 'text-red-300 font-semibold'
                                        : 'text-slate-200'
                                    }
                                    data-testid={`text-declaration-read-attempt-count-${row.ipAddress}`}
                                  >
                                    {row.attemptCount}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <span
                                    className={
                                      row.distinctCaseCount >= 3
                                        ? 'text-red-300 font-semibold'
                                        : 'text-slate-300'
                                    }
                                    title={row.distinctCaseIds.join(', ')}
                                  >
                                    {row.distinctCaseCount}
                                  </span>
                                  {row.distinctCaseCount > 0 && (
                                    <div
                                      className="text-xs text-slate-500 truncate max-w-[200px]"
                                      title={row.distinctCaseIds.join(', ')}
                                    >
                                      {casesPreview}
                                      {casesOverflow}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {credEntries.length === 0 ? (
                                      <span className="text-xs text-slate-500">—</span>
                                    ) : (
                                      credEntries.map(([type, count]) => (
                                        <Badge
                                          key={type}
                                          className="bg-red-500/20 text-red-300 border border-red-500/30"
                                          title={`${count} ${type} attempt${count === 1 ? '' : 's'}`}
                                        >
                                          {count} {type}
                                        </Badge>
                                      ))
                                    )}
                                    {row.rateLimitedCount > 0 && (
                                      <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                        {row.rateLimitedCount} throttled
                                      </Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-slate-400 text-xs whitespace-nowrap">
                                  {new Date(row.firstAttemptAt).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-slate-400 text-xs whitespace-nowrap">
                                  {new Date(row.lastAttemptAt).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  {/*
                                    "Rate-limited" is inferred from a
                                    declaration_read_rate_limited row in
                                    the last 15 min (matching the in-memory
                                    limiter's lockout window).
                                  */}
                                  {row.isThrottled ? (
                                    <Badge
                                      className="bg-amber-500/30 text-amber-200 border border-amber-500/40"
                                      data-testid={`badge-declaration-read-throttled-${row.ipAddress}`}
                                      title="Heuristic: this IP triggered the declaration-read limiter within the last 15 minutes (matching the lockout window). The exact lockout state is held in-memory by the server."
                                    >
                                      <Lock className="h-3 w-3 mr-1" />
                                      Rate-limited
                                    </Badge>
                                  ) : isSuspicious ? (
                                    <Badge
                                      className="bg-red-500/20 text-red-300 border border-red-500/30"
                                      title="10+ attempts, or 3+ distinct cases probed, or recently rate-limited."
                                    >
                                      <ShieldAlert className="h-3 w-3 mr-1" />
                                      Suspicious
                                    </Badge>
                                  ) : (
                                    <Badge
                                      className="bg-slate-700/40 text-slate-300"
                                      title="Below enumeration thresholds — likely a stale link or one-off mistake."
                                    >
                                      Noise
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell
                                  className="text-right"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/*
                                    Block / Unblock control (Task #113).
                                    Clicks are stopPropagation'd so they
                                    don't toggle the drilldown row above.
                                    A blocked IP shows a red badge + an
                                    Unblock button; an unblocked IP gets
                                    a Block button whose styling escalates
                                    (red outline) when the row is also
                                    flagged suspicious.
                                  */}
                                  {blockedIps.blockedSet.has(row.ipAddress) ? (
                                    <div className="flex items-center justify-end gap-2">
                                      <Badge className="bg-red-600/40 text-red-100 border border-red-500/50">
                                        <Lock className="h-3 w-3 mr-1" />
                                        Blocked
                                      </Badge>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-slate-600 h-7 px-2 text-xs"
                                        disabled={blockedIps.pendingIp === row.ipAddress}
                                        onClick={() =>
                                          blockedIps.unblock(row.ipAddress)
                                        }
                                        data-testid={`button-unblock-ip-${row.ipAddress}`}
                                      >
                                        Unblock
                                      </Button>
                                    </div>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className={
                                        isSuspicious
                                          ? 'border-red-500/60 text-red-200 hover:bg-red-500/10 h-7 px-2 text-xs'
                                          : 'border-slate-600 h-7 px-2 text-xs'
                                      }
                                      disabled={blockedIps.pendingIp === row.ipAddress}
                                      onClick={() =>
                                        blockedIps
                                          .block(
                                            row.ipAddress,
                                            `Declaration scan: ${row.attemptCount} attempts, ${row.distinctCaseCount} cases`,
                                          )
                                          .catch((err) =>
                                            console.error('Block failed:', err),
                                          )
                                      }
                                      data-testid={`button-block-ip-${row.ipAddress}`}
                                    >
                                      <ShieldAlert className="h-3 w-3 mr-1" />
                                      Block
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>,
                            ];
                            if (isExpanded) {
                              // Per-IP drilldown: shows the individual
                              // attempts (case id, credential type, UA,
                              // timestamp) for the IP the admin clicked.
                              // Fetched on demand via the ?ip= filter so
                              // the rollup query stays cheap.
                              rows.push(
                                <TableRow
                                  key={`${row.ipAddress}-detail`}
                                  className="border-slate-800 bg-slate-950/60"
                                  data-testid={`declaration-read-ip-detail-${row.ipAddress}`}
                                >
                                  <TableCell colSpan={8} className="p-4">
                                    <div className="text-xs text-slate-400 mb-2">
                                      Attempts from{' '}
                                      <span className="font-mono text-slate-200">
                                        {row.ipAddress}
                                      </span>{' '}
                                      (newest first, last 100)
                                    </div>
                                    {declarationReadDrilldown.isLoading ? (
                                      <div className="text-slate-500 text-sm py-3">
                                        Loading…
                                      </div>
                                    ) : declarationReadDrilldown.ipAttempts.length ===
                                      0 ? (
                                      <div className="text-slate-500 text-sm py-3">
                                        No attempts found for this IP.
                                      </div>
                                    ) : (
                                      <Table>
                                        <TableHeader>
                                          <TableRow className="border-slate-800">
                                            <TableHead className="text-slate-400 text-xs">
                                              When
                                            </TableHead>
                                            <TableHead className="text-slate-400 text-xs">
                                              Type
                                            </TableHead>
                                            <TableHead className="text-slate-400 text-xs">
                                              Case ID
                                            </TableHead>
                                            <TableHead className="text-slate-400 text-xs">
                                              Credential
                                            </TableHead>
                                            <TableHead className="text-slate-400 text-xs">
                                              User agent
                                            </TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {declarationReadDrilldown.ipAttempts.map(
                                            (attempt) => {
                                              const isThrottled =
                                                attempt.action ===
                                                'declaration_read_rate_limited';
                                              return (
                                                <TableRow
                                                  key={attempt.id}
                                                  className="border-slate-800"
                                                  data-testid={`declaration-read-ip-attempt-${attempt.id}`}
                                                >
                                                  <TableCell className="text-slate-400 text-xs whitespace-nowrap">
                                                    {new Date(
                                                      attempt.createdAt,
                                                    ).toLocaleString()}
                                                  </TableCell>
                                                  <TableCell>
                                                    <Badge
                                                      className={
                                                        isThrottled
                                                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                                          : 'bg-red-500/20 text-red-300 border border-red-500/30'
                                                      }
                                                    >
                                                      {isThrottled
                                                        ? 'Rate-limited'
                                                        : 'Unauthorized'}
                                                    </Badge>
                                                  </TableCell>
                                                  <TableCell
                                                    className="text-slate-300 font-mono text-xs"
                                                    title={attempt.caseId ?? ''}
                                                  >
                                                    {attempt.caseId
                                                      ? `${attempt.caseId.slice(0, 8)}…`
                                                      : '—'}
                                                  </TableCell>
                                                  <TableCell className="text-slate-200 text-xs">
                                                    {attempt.credentialType ?? '—'}
                                                  </TableCell>
                                                  <TableCell
                                                    className="text-slate-400 text-xs max-w-[280px] truncate"
                                                    title={attempt.userAgent ?? ''}
                                                  >
                                                    {attempt.userAgent
                                                      ? `${describeUserAgent(attempt.userAgent)} · ${attempt.userAgent}`
                                                      : '—'}
                                                  </TableCell>
                                                </TableRow>
                                              );
                                            },
                                          )}
                                        </TableBody>
                                      </Table>
                                    )}
                                  </TableCell>
                                </TableRow>,
                              );
                            }
                            return rows;
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="by-attempt" className="mt-0">
              <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-0">
                  <div className="max-h-[500px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700">
                          <TableHead className="text-slate-300">When</TableHead>
                          <TableHead className="text-slate-300">Type</TableHead>
                          <TableHead className="text-slate-300">Case ID</TableHead>
                          <TableHead className="text-slate-300">Credential</TableHead>
                          <TableHead className="text-slate-300">IP address</TableHead>
                          <TableHead className="text-slate-300">User agent</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {declarationReadAttempts.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                              <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-50" />
                              <p>No unauthorized declaration-read attempts recorded</p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          declarationReadAttempts.map((attempt) => {
                            const isThrottled =
                              attempt.action === 'declaration_read_rate_limited';
                            return (
                              <TableRow
                                key={attempt.id}
                                className="border-slate-800"
                                data-testid={`declaration-read-${attempt.id}`}
                              >
                                <TableCell className="text-slate-400 text-sm whitespace-nowrap">
                                  {new Date(attempt.createdAt).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    className={
                                      isThrottled
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                        : 'bg-red-500/20 text-red-300 border border-red-500/30'
                                    }
                                  >
                                    {isThrottled ? 'Rate-limited' : 'Unauthorized'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-slate-300 font-mono text-xs">
                                  {attempt.caseId
                                    ? `${attempt.caseId.slice(0, 8)}…`
                                    : '—'}
                                </TableCell>
                                <TableCell className="text-slate-200 text-sm">
                                  {attempt.credentialType ?? '—'}
                                </TableCell>
                                <TableCell className="text-slate-300 text-sm font-mono">
                                  {attempt.ipAddress || '—'}
                                </TableCell>
                                <TableCell
                                  className="text-slate-400 text-xs max-w-[280px] truncate"
                                  title={attempt.userAgent ?? ''}
                                >
                                  {attempt.userAgent
                                    ? `${describeUserAgent(attempt.userAgent)} · ${attempt.userAgent}`
                                    : '—'}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : settingsView === 'scheduled' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">Scheduled Messages</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Create Scheduled Message */}
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Schedule New Message</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={newScheduledMessage.caseId} onValueChange={(v) => setNewScheduledMessage({ ...newScheduledMessage, caseId: v })}>
                  <SelectTrigger className="bg-slate-800 border-slate-700">
                    <SelectValue placeholder="Select case (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {cases.filter(c => c.userName).map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.userName} ({c.accessCode})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={newScheduledMessage.messageType} onValueChange={(v: 'chat' | 'admin_message' | 'letter') => setNewScheduledMessage({ ...newScheduledMessage, messageType: v })}>
                  <SelectTrigger className="bg-slate-800 border-slate-700">
                    <SelectValue placeholder="Message type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chat">Chat Message</SelectItem>
                    <SelectItem value="admin_message">Admin Message</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Title (optional)" value={newScheduledMessage.title} onChange={(e) => setNewScheduledMessage({ ...newScheduledMessage, title: e.target.value })} className="bg-slate-800 border-slate-700" />
                <Textarea placeholder="Message content..." value={newScheduledMessage.content} onChange={(e) => setNewScheduledMessage({ ...newScheduledMessage, content: e.target.value })} className="bg-slate-800 border-slate-700 min-h-[80px]" />
                <Input type="datetime-local" value={newScheduledMessage.scheduledFor} onChange={(e) => setNewScheduledMessage({ ...newScheduledMessage, scheduledFor: e.target.value })} className="bg-slate-800 border-slate-700" />
                <Button onClick={createScheduledMessage} className="w-full bg-blue-600 hover:bg-blue-700" disabled={!newScheduledMessage.content.trim() || !newScheduledMessage.scheduledFor}>
                  <Clock className="h-4 w-4 mr-2" /> Schedule Message
                </Button>
              </CardContent>
            </Card>

            {/* Pending Messages */}
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Pending Messages</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  {scheduledMessages.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No scheduled messages</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {scheduledMessages.map((msg) => (
                        <div key={msg.id} className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge className="bg-blue-500/20 text-blue-300 text-xs">{msg.messageType}</Badge>
                                {msg.title && <span className="text-white text-sm font-medium">{msg.title}</span>}
                              </div>
                              <p className="text-slate-400 text-sm line-clamp-2">{msg.content}</p>
                              <p className="text-slate-500 text-xs mt-1">
                                <Clock className="h-3 w-3 inline mr-1" />
                                {new Date(msg.scheduledFor).toLocaleString()}
                              </p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => cancelScheduledMessage(msg.id)} className="text-red-400 hover:text-red-300">
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </>
      ) : settingsView === 'templates' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">Message Templates</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Create Template */}
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Create Template</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input placeholder="Template name..." value={newMessageTemplate.name} onChange={(e) => setNewMessageTemplate({ ...newMessageTemplate, name: e.target.value })} className="bg-slate-800 border-slate-700" />
                <Select value={newMessageTemplate.category} onValueChange={(v) => setNewMessageTemplate({ ...newMessageTemplate, category: v })}>
                  <SelectTrigger className="bg-slate-800 border-slate-700">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="processing">Processing</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
                <Textarea placeholder="Template content..." value={newMessageTemplate.content} onChange={(e) => setNewMessageTemplate({ ...newMessageTemplate, content: e.target.value })} className="bg-slate-800 border-slate-700 min-h-[100px]" />
                <Button onClick={createMessageTemplate} className="w-full bg-cyan-600 hover:bg-cyan-700" disabled={!newMessageTemplate.name.trim() || !newMessageTemplate.content.trim()}>
                  <Plus className="h-4 w-4 mr-2" /> Create Template
                </Button>
              </CardContent>
            </Card>

            {/* Templates List */}
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Saved Templates</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  {messageTemplates.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No templates created yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {messageTemplates.map((template) => (
                        <div key={template.id} className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-white font-medium">{template.name}</span>
                                {template.category && <Badge className="bg-slate-600 text-slate-300 text-xs">{template.category}</Badge>}
                              </div>
                              <p className="text-slate-400 text-sm line-clamp-2">{template.content}</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => deleteMessageTemplate(template.id)} className="text-red-400 hover:text-red-300">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </>
      ) : settingsView === 'help' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">Help Center</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Create Article */}
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Create Help Article</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input placeholder="Article title..." value={newHelpArticle.title} onChange={(e) => setNewHelpArticle({ ...newHelpArticle, title: e.target.value })} className="bg-slate-800 border-slate-700" />
                <Select value={newHelpArticle.category} onValueChange={(v) => setNewHelpArticle({ ...newHelpArticle, category: v })}>
                  <SelectTrigger className="bg-slate-800 border-slate-700">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="account">Account</SelectItem>
                    <SelectItem value="withdrawal">Withdrawal</SelectItem>
                    <SelectItem value="deposits">Deposits</SelectItem>
                    <SelectItem value="security">Security</SelectItem>
                  </SelectContent>
                </Select>
                <Textarea placeholder="Article content..." value={newHelpArticle.content} onChange={(e) => setNewHelpArticle({ ...newHelpArticle, content: e.target.value })} className="bg-slate-800 border-slate-700 min-h-[100px]" />
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="publish" checked={newHelpArticle.isPublished} onChange={(e) => setNewHelpArticle({ ...newHelpArticle, isPublished: e.target.checked })} className="rounded border-slate-600" />
                  <Label htmlFor="publish" className="text-slate-300 text-sm">Publish immediately</Label>
                </div>
                <Button onClick={createHelpArticle} className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={!newHelpArticle.title.trim() || !newHelpArticle.content.trim()}>
                  <Plus className="h-4 w-4 mr-2" /> Create Article
                </Button>
              </CardContent>
            </Card>

            {/* Articles List */}
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Published Articles</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  {helpArticles.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <ExternalLink className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No help articles yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {helpArticles.map((article) => (
                        <div key={article.id} className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-white font-medium">{article.title}</span>
                                {article.category && <Badge className="bg-indigo-500/20 text-indigo-300 text-xs">{article.category}</Badge>}
                              </div>
                              <p className="text-slate-400 text-sm line-clamp-2">{article.content}</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => deleteHelpArticle(article.id)} className="text-red-400 hover:text-red-300">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </>
      ) : settingsView === 'feedback' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">User Feedback</h2>
            <Button variant="outline" size="sm" onClick={loadUserFeedback} className="ml-auto border-slate-600">
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-4">
              {userFeedback.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No feedback received yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {userFeedback.map((fb) => (
                    <div key={fb.id} className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-pink-500/20 text-pink-300">{fb.feedbackType || 'General'}</Badge>
                          <span className="text-slate-400 text-sm">Case: {fb.caseId}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <span key={star} className={parseInt(fb.rating) >= star ? 'text-amber-400' : 'text-slate-600'}>★</span>
                          ))}
                        </div>
                      </div>
                      {fb.comment && <p className="text-slate-300 text-sm">{fb.comment}</p>}
                      <p className="text-slate-500 text-xs mt-2">{new Date(fb.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : settingsView === 'documents' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">Document Requests</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Create Document Request */}
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Request Document</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={newDocumentRequest.caseId} onValueChange={(v) => setNewDocumentRequest({ ...newDocumentRequest, caseId: v })}>
                  <SelectTrigger className="bg-slate-800 border-slate-700">
                    <SelectValue placeholder="Select case" />
                  </SelectTrigger>
                  <SelectContent>
                    {cases.filter(c => c.userName).map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.userName} ({c.accessCode})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input placeholder="Document type (e.g., ID, Proof of Address)..." value={newDocumentRequest.documentType} onChange={(e) => setNewDocumentRequest({ ...newDocumentRequest, documentType: e.target.value })} className="bg-slate-800 border-slate-700" />
                <Textarea placeholder="Description or instructions..." value={newDocumentRequest.description} onChange={(e) => setNewDocumentRequest({ ...newDocumentRequest, description: e.target.value })} className="bg-slate-800 border-slate-700 min-h-[60px]" />
                <Input type="date" value={newDocumentRequest.deadline} onChange={(e) => setNewDocumentRequest({ ...newDocumentRequest, deadline: e.target.value })} className="bg-slate-800 border-slate-700" placeholder="Deadline (optional)" />
                <Button onClick={createDocumentRequest} className="w-full bg-orange-600 hover:bg-orange-700" disabled={!newDocumentRequest.caseId || !newDocumentRequest.documentType.trim()}>
                  <Upload className="h-4 w-4 mr-2" /> Send Request
                </Button>
              </CardContent>
            </Card>

            {/* Pending Requests */}
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Pending Requests</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  {documentRequests.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No document requests</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {documentRequests.map((req) => {
                        const uploadsOn = (req as any).uploadsEnabled !== false;
                        const inUploadableStatus =
                          req.status === 'pending' ||
                          req.status === 'requested' ||
                          req.status === 'rejected';
                        return (
                          <div
                            key={req.id}
                            className="p-3 bg-slate-800/50 rounded-lg border border-slate-700"
                            data-testid={`admin-document-request-${req.id}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className="text-white font-medium">{req.documentType}</span>
                                  <Badge className={
                                    req.status === 'pending' ? 'bg-amber-500/20 text-amber-300' :
                                    req.status === 'submitted' ? 'bg-blue-500/20 text-blue-300' :
                                    req.status === 'approved' ? 'bg-green-500/20 text-green-300' :
                                    'bg-red-500/20 text-red-300'
                                  }>{req.status}</Badge>
                                  {!uploadsOn && inUploadableStatus && (
                                    <Badge className="bg-slate-700/60 text-slate-200 border border-white/10">
                                      Uploads paused
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-slate-400 text-sm">{req.description}</p>
                                {req.deadline && <p className="text-slate-500 text-xs mt-1">Due: {new Date(req.deadline).toLocaleDateString()}</p>}
                              </div>
                              {inUploadableStatus && (
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                  <label
                                    className="flex items-center gap-2 cursor-pointer select-none"
                                    title={uploadsOn ? 'Pause the user upload link' : 'Resume the user upload link'}
                                  >
                                    <span className="text-[11px] text-slate-300">
                                      {uploadsOn ? 'Upload link on' : 'Upload link off'}
                                    </span>
                                    <Switch
                                      checked={uploadsOn}
                                      onCheckedChange={(checked) =>
                                        setDocumentRequestUploadsEnabled(req.id, checked)
                                      }
                                      data-testid={`switch-uploads-enabled-${req.id}`}
                                    />
                                  </label>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </>
      ) : settingsView === '2fa' ? (
        <BiometricSettingsView authToken={authToken ?? ""} onBack={() => setSettingsView('main')} />
      ) : settingsView === 'sub-2fa' ? (
        <SubAdmin2faSetupView authToken={authToken ?? ""} onBack={() => setSettingsView('main')} />
      ) : settingsView === 'admin-users' ? (
        <AdminUsersView
          adminUsers={adminUsers}
          loadAdminUsers={loadAdminUsers}
          authToken={authToken ?? ""}
          onBack={() => setSettingsView('main')}
        />
      ) : settingsView === 'user-sessions' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">User Portal Sessions</h2>
            <Button variant="outline" size="sm" onClick={loadUserSessions} className="ml-auto border-slate-600">
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-4">
              <div className="space-y-3">
                {userSessions.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No active user sessions</p>
                  </div>
                ) : (
                  userSessions.map((session) => (
                    <div key={session.id} className={`p-4 rounded-lg border ${session.isActive ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-900/50 border-slate-800 opacity-60'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${session.isActive ? 'bg-teal-500/20' : 'bg-slate-700'}`}>
                            <User className={`h-5 w-5 ${session.isActive ? 'text-teal-400' : 'text-slate-500'}`} />
                          </div>
                          <div>
                            <p className="text-white font-medium">Case: {session.caseId.substring(0, 8)}...</p>
                            <p className="text-slate-400 text-sm">{session.ipAddress || 'Unknown IP'} {session.location && `• ${session.location}`}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-slate-400 text-xs">Last active</p>
                            <p className="text-slate-300 text-sm">{new Date(session.lastActivityAt).toLocaleString()}</p>
                          </div>
                          {session.isActive && (
                            <Button variant="destructive" size="sm" onClick={() => deactivateUserSession(session.id)}>
                              End
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {session.deviceInfo && <span className="truncate block max-w-md">{session.deviceInfo}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </>
      ) : settingsView === 'tamper-alert-email' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              onClick={() => setSettingsView('main')}
              className="text-slate-400"
              data-testid="button-tamper-alert-back"
            >
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">
              Tamper Alert Recipient
            </h2>
          </div>
          <TamperAlertEmailPanel />
          <EmailFailureAlertCooldownCard />
        </>
      ) : settingsView === 'document-upload-alert-email' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              onClick={() => setSettingsView('main')}
              className="text-slate-400"
              data-testid="button-document-upload-alert-back"
            >
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">
              Document Upload Alert Recipient
            </h2>
          </div>
          <DocumentUploadAlertEmailPanel />
          <DocUploadAlertCooldownCard />
        </>
      ) : settingsView === 'nda-signing-locales' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              onClick={() => setSettingsView('main')}
              className="text-slate-400"
              data-testid="button-nda-signing-locales-back"
            >
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">
              NDA Signing Languages
            </h2>
          </div>
          <NdaSigningLocalesPanel />
        </>
      ) : settingsView === 'translations' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => setSettingsView('main')} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">Translation Manager</h2>
            <div className="ml-auto flex items-center gap-3">
              <Select value={selectedLocale} onValueChange={(val) => { setSelectedLocale(val); loadTranslations(val); }}>
                <SelectTrigger className="w-[150px] bg-slate-800 border-slate-700 text-white">
                  <SelectValue placeholder="Language" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="en" className="text-white">English (en)</SelectItem>
                  <SelectItem value="es" className="text-white">Spanish (es)</SelectItem>
                  <SelectItem value="zh" className="text-white">Chinese (zh)</SelectItem>
                  <SelectItem value="ja" className="text-white">Japanese (ja)</SelectItem>
                  <SelectItem value="ko" className="text-white">Korean (ko)</SelectItem>
                  <SelectItem value="de" className="text-white">German (de)</SelectItem>
                  <SelectItem value="fr" className="text-white">French (fr)</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => loadTranslations(selectedLocale)} className="border-slate-600">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <Plus className="h-4 w-4 text-cyan-400" /> Add Translation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-slate-400">Key</Label>
                  <Input
                    value={newTranslationKey}
                    onChange={(e) => setNewTranslationKey(e.target.value)}
                    placeholder="e.g., welcome.title"
                    className="bg-slate-800 border-slate-700 text-white mt-1"
                  />
                </div>
                <div>
                  <Label className="text-slate-400">Value ({selectedLocale.toUpperCase()})</Label>
                  <Textarea
                    value={newTranslationValue}
                    onChange={(e) => setNewTranslationValue(e.target.value)}
                    placeholder="Translated text..."
                    className="bg-slate-800 border-slate-700 text-white mt-1"
                    rows={3}
                  />
                </div>
                <Button onClick={createTranslation} className="w-full bg-cyan-600 hover:bg-cyan-700" disabled={!newTranslationKey || !newTranslationValue}>
                  <Plus className="h-4 w-4 mr-2" /> Add Translation
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <Languages className="h-4 w-4 text-cyan-400" /> Existing Translations ({selectedLocale.toUpperCase()})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  {translations.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No translations for this language</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {translations.map((t) => (
                        <div key={t.key} className="p-3 bg-slate-800/50 rounded-lg border border-slate-700 group">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <p className="text-cyan-400 font-mono text-sm truncate">{t.key}</p>
                              <p className="text-slate-300 text-sm mt-1">{t.value}</p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => deleteTranslation(t.id, t.key)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 hover:bg-red-500/20">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </>
      ) : settingsView === 'change-password' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => { setCpError(null); setSettingsView('main'); }} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">Change Password</h2>
          </div>
          <div className="max-w-md mx-auto">
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Lock className="h-5 w-5 text-violet-400" />
                  Update Admin Password
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-slate-400 text-sm">
                  Your new password will be stored securely and used for all future logins. Choose a strong password — at least 12 characters with uppercase, lowercase, digits, and a special character.
                </p>

                {cpError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm" data-testid="cp-error">
                    {cpError}
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-slate-400 text-[11px] uppercase tracking-wider">Current Password</Label>
                  <Input
                    type="password"
                    placeholder="Enter current password"
                    value={cpCurrentPassword}
                    onChange={(e) => setCpCurrentPassword(e.target.value)}
                    className="bg-slate-900/60 border-slate-700/60 text-white placeholder:text-slate-600 focus:border-violet-400/50 focus:ring-1 focus:ring-violet-400/30"
                    data-testid="input-cp-current"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-400 text-[11px] uppercase tracking-wider">New Password</Label>
                  <Input
                    type="password"
                    placeholder="Enter new password"
                    value={cpNewPassword}
                    onChange={(e) => setCpNewPassword(e.target.value)}
                    className="bg-slate-900/60 border-slate-700/60 text-white placeholder:text-slate-600 focus:border-violet-400/50 focus:ring-1 focus:ring-violet-400/30"
                    data-testid="input-cp-new"
                  />
                  {cpNewPassword && (() => {
                    const { strength, weakReason } = getPasswordStrengthDetail(cpNewPassword);
                    const isWeak = strength === "Weak";
                    const isMedium = strength === "Medium";
                    const isStrong = strength === "Strong";
                    return (
                      <div className="mt-2 space-y-1" data-testid="cp-strength-meter">
                        <div className="flex gap-1">
                          <div className={`h-1 flex-1 rounded-full transition-colors ${isWeak || isMedium || isStrong ? "bg-red-500" : "bg-slate-700"}`} />
                          <div className={`h-1 flex-1 rounded-full transition-colors ${isMedium || isStrong ? "bg-amber-400" : "bg-slate-700"}`} />
                          <div className={`h-1 flex-1 rounded-full transition-colors ${isStrong ? "bg-green-500" : "bg-slate-700"}`} />
                        </div>
                        <p className={`text-[11px] font-medium ${isWeak ? "text-red-400" : isMedium ? "text-amber-400" : "text-green-400"}`} data-testid="cp-strength-label">
                          {strength}
                        </p>
                        {weakReason && (
                          <p className="text-[11px] text-red-400/80" data-testid="cp-strength-hint">
                            {PASSWORD_WEAK_HINTS[weakReason]}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-400 text-[11px] uppercase tracking-wider">Confirm New Password</Label>
                  <Input
                    type="password"
                    placeholder="Re-enter new password"
                    value={cpConfirmPassword}
                    onChange={(e) => setCpConfirmPassword(e.target.value)}
                    className="bg-slate-900/60 border-slate-700/60 text-white placeholder:text-slate-600 focus:border-violet-400/50 focus:ring-1 focus:ring-violet-400/30"
                    data-testid="input-cp-confirm"
                  />
                  {cpConfirmPassword && cpNewPassword !== cpConfirmPassword && (
                    <p className="text-[11px] text-red-400" data-testid="cp-mismatch">Passwords do not match</p>
                  )}
                </div>

                <Button
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={handleChangePassword}
                  disabled={cpLoading}
                  data-testid="button-cp-submit"
                >
                  {cpLoading ? "Changing…" : "Change Password"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      ) : settingsView === 'change-username' ? (
        <>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" onClick={() => { setCuError(null); setSettingsView('main'); }} className="text-slate-400">
              <X className="h-4 w-4 mr-2" /> Back
            </Button>
            <h2 className="text-xl font-bold text-white">Change Username</h2>
          </div>
          <div className="max-w-md mx-auto">
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <User className="h-5 w-5 text-teal-400" />
                  Update Admin Username
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-slate-400 text-sm">
                  Choose a unique, non-guessable username — at least 4 characters, not purely numeric, not a common name or keyboard sequence. The change takes effect on the next login.
                </p>

                {cuError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm" data-testid="cu-error">
                    {cuError}
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-slate-400 text-[11px] uppercase tracking-wider">Current Password</Label>
                  <Input
                    type="password"
                    placeholder="Enter current password"
                    value={cuCurrentPassword}
                    onChange={(e) => setCuCurrentPassword(e.target.value)}
                    className="bg-slate-900/60 border-slate-700/60 text-white placeholder:text-slate-600 focus:border-teal-400/50 focus:ring-1 focus:ring-teal-400/30"
                    data-testid="input-cu-current-password"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-400 text-[11px] uppercase tracking-wider">New Username</Label>
                  <Input
                    type="text"
                    placeholder="Enter new username"
                    value={cuNewUsername}
                    onChange={(e) => setCuNewUsername(e.target.value)}
                    autoComplete="username"
                    className="bg-slate-900/60 border-slate-700/60 text-white placeholder:text-slate-600 focus:border-teal-400/50 focus:ring-1 focus:ring-teal-400/30"
                    data-testid="input-cu-new"
                  />
                  {cuNewUsername && (() => {
                    const reason = getUsernameTrivialReason(cuNewUsername);
                    const isTrivial = reason !== null;
                    return (
                      <div className="mt-2 space-y-1" data-testid="cu-strength-meter">
                        <div className="flex gap-1">
                          <div className={`h-1 flex-1 rounded-full transition-colors ${isTrivial ? "bg-red-500" : "bg-green-500"}`} />
                          <div className={`h-1 flex-1 rounded-full transition-colors ${isTrivial ? "bg-slate-700" : "bg-green-500"}`} />
                        </div>
                        <p
                          className={`text-[11px] font-medium ${isTrivial ? "text-red-400" : "text-green-400"}`}
                          data-testid="cu-strength-label"
                        >
                          {isTrivial ? "Trivial" : "OK"}
                        </p>
                        {reason && (
                          <p className="text-[11px] text-red-400/80" data-testid="cu-strength-hint">
                            {USERNAME_TRIVIAL_HINTS[reason]}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <Button
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white"
                  onClick={handleChangeUsername}
                  disabled={cuLoading}
                  data-testid="button-cu-submit"
                >
                  {cuLoading ? "Changing…" : "Change Username"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      ) : settingsView === 'sound' ? (
        <SoundSettingsPanel onBack={() => setSettingsView('main')} />
      ) : settingsView === 'service-health' ? (
        <ServiceHealthPanel onBack={() => setSettingsView('main')} />
      ) : null}
    </motion.div>
  );
}

// Admin-facing per-language allowlist for NDA signing (Task #88,
// supersedes the English-only boolean toggle from Task #61). Backed by
// `app_settings.nda_signing_locales` on the server; saves take effect
// within the runtimeFlags cache TTL (~10s) for other instances and
// immediately for the writing instance. Every successful save emits an
// `nda_signing_locales_changed` audit-log entry (with the optional
// reason the admin typed into the confirm dialog). English is
// permanently checked and disabled because counsel has approved the
// authoritative English body.
const NDA_LOCALE_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish (Español)",
  fr: "French (Français)",
  de: "German (Deutsch)",
  pt: "Portuguese (Português)",
  zh: "Simplified Chinese (简体中文)",
};

function NdaSigningLocalesPanel() {
  const [supported, setSupported] = useState<string[]>([]);
  const [required, setRequired] = useState<string[]>(["en"]);
  const [current, setCurrent] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set(["en"]));
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const token = sessionStorage.getItem("adminToken") ?? "";
      const res = await fetch("/api/admin/nda-signing-locales", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const value: string[] = Array.isArray(data?.value) ? data.value : ["en"];
      setCurrent(value);
      setDraft(new Set(value));
      setSupported(Array.isArray(data?.supported) ? data.supported : []);
      setRequired(Array.isArray(data?.required) ? data.required : ["en"]);
      setUpdatedAt(data?.updatedAt ?? null);
      setUpdatedBy(data?.updatedBy ?? null);
    } catch (err) {
      console.error("Failed to load nda-signing-locales:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = (code: string) => {
    if (required.includes(code)) return;
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const draftArray = supported.filter((c) => draft.has(c) || required.includes(c));
  const currentSet = new Set(current ?? []);
  const isDirty =
    !!current &&
    (draftArray.length !== current.length ||
      draftArray.some((c) => !currentSet.has(c)));

  const save = async () => {
    setSaving(true);
    try {
      const token = sessionStorage.getItem("adminToken") ?? "";
      const res = await fetch("/api/admin/nda-signing-locales", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          value: draftArray,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const value: string[] = Array.isArray(data?.value) ? data.value : draftArray;
      setCurrent(value);
      setDraft(new Set(value));
      setUpdatedAt(data?.updatedAt ?? null);
      setUpdatedBy(data?.updatedBy ?? null);
      setConfirmOpen(false);
      setReason("");
    } catch (err) {
      console.error("Failed to save nda-signing-locales:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-slate-900/50 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white text-base flex items-center gap-2">
          <FileText className="h-5 w-5 text-violet-400" />
          NDA signing languages
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-slate-400">
          Choose which languages new signers may use to seal their Sealed
          Settlement &amp; NDA. Enable additional languages incrementally as
          counsel signs off on each translation. English is the
          authoritative version and is always available. The rest of each
          user's portal still renders in their chosen language. Already-
          sealed cases are unaffected — they continue to re-render in the
          locale captured in their snapshot (so their SHA-256 integrity
          hash holds).
        </p>

        <div
          className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-4"
          data-testid="nda-signing-locales-list"
        >
          {loading ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : (
            (supported.length > 0 ? supported : ["en"]).map((code) => {
              const isRequired = required.includes(code);
              const checked = isRequired || draft.has(code);
              return (
                <label
                  key={code}
                  className="flex items-center gap-3 py-1 cursor-pointer"
                  data-testid={`row-nda-locale-${code}`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-violet-500"
                    checked={checked}
                    disabled={isRequired || saving}
                    onChange={() => toggle(code)}
                    data-testid={`checkbox-nda-locale-${code}`}
                  />
                  <span className="text-sm text-white">
                    {NDA_LOCALE_LABELS[code] ?? code}
                  </span>
                  <span className="text-xs text-slate-500">({code})</span>
                  {isRequired && (
                    <span className="text-[11px] text-slate-500">
                      — always available
                    </span>
                  )}
                </label>
              );
            })
          )}
          {!loading && (updatedAt || updatedBy) && (
            <div className="pt-2 text-[11px] text-slate-500">
              Last changed
              {updatedAt ? ` ${new Date(updatedAt).toLocaleString()}` : ""}
              {updatedBy ? ` by ${updatedBy}` : ""}.
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              setReason("");
              setConfirmOpen(true);
            }}
            disabled={loading || saving || !isDirty}
            data-testid="button-nda-signing-locales-save"
            className="bg-violet-600 hover:bg-violet-700"
          >
            Save changes
          </Button>
          {current && (
            <Button
              variant="ghost"
              onClick={() => setDraft(new Set(current))}
              disabled={!isDirty || saving}
              className="text-slate-400"
              data-testid="button-nda-signing-locales-reset"
            >
              Discard
            </Button>
          )}
        </div>
      </CardContent>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!saving) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent
          className="bg-slate-900 border-slate-800 text-slate-100"
          data-testid="dialog-nda-signing-locales-confirm"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Update signing languages?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-slate-300">
              New signers will be able to seal their case in:{" "}
              <span className="font-medium text-white">
                {draftArray
                  .map((c) => NDA_LOCALE_LABELS[c] ?? c)
                  .join(", ")}
              </span>
              . Confirm that counsel has signed off on each enabled
              translation. Already-sealed cases are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label
              htmlFor="nda-signing-locales-reason"
              className="text-xs text-slate-400"
            >
              Reason / ticket (optional, recorded in the audit log)
            </Label>
            <Textarea
              id="nda-signing-locales-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              placeholder="e.g. LEG-482 — counsel approved es body"
              className="bg-slate-950 border-slate-700 text-white"
              rows={3}
              disabled={saving}
              data-testid="textarea-nda-signing-locales-reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={saving}
              data-testid="button-nda-signing-locales-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                save();
              }}
              disabled={saving}
              data-testid="button-nda-signing-locales-confirm"
            >
              {saving ? "Saving…" : "Save"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function AuditRetentionCard() {
  const {
    auditRetention,
    isAuditRetentionLoading,
    isAuditRetentionSaving,
    loadAuditRetention,
    saveAuditRetention,
  } = useAdminDashboard();

  const [draftDays, setDraftDays] = useState<string>("");

  // Fetch the current setting whenever the audit panel mounts so the
  // input reflects the live value, including any env-var override.
  useEffect(() => {
    loadAuditRetention();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the draft in sync with the loaded value, but don't clobber a
  // value the admin is in the middle of editing.
  useEffect(() => {
    if (auditRetention && draftDays === "") {
      setDraftDays(String(auditRetention.days));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditRetention?.days]);

  const min = auditRetention?.min ?? 1;
  const max = auditRetention?.max ?? 3650;
  const parsed = Number.parseFloat(draftDays);
  const isValid = Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const isDirty =
    !!auditRetention && isValid && parsed !== auditRetention.days;
  const envLocked = auditRetention?.envOverride === true;

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mb-4"
      data-testid="card-audit-retention"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <Clock className="h-4 w-4 text-purple-400" />
          Audit log retention
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400">
          Audit log rows older than this window are deleted by the hourly
          retention sweep. Increase it during a forensics investigation, or
          decrease it to reclaim storage. Changes apply immediately and
          survive a server restart.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="audit-retention-days" className="text-xs text-slate-400">
              Days to keep
            </Label>
            <Input
              id="audit-retention-days"
              type="number"
              min={min}
              max={max}
              step={1}
              value={draftDays}
              disabled={
                isAuditRetentionLoading || isAuditRetentionSaving || envLocked
              }
              onChange={(e) => setDraftDays(e.target.value)}
              className="w-32 bg-slate-950/60 border-slate-700 text-white"
              data-testid="input-audit-retention-days"
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!isValid) return;
              saveAuditRetention(parsed);
            }}
            disabled={
              !isDirty ||
              isAuditRetentionSaving ||
              isAuditRetentionLoading ||
              envLocked
            }
            data-testid="button-audit-retention-save"
          >
            {isAuditRetentionSaving ? "Saving…" : "Save"}
          </Button>
          <div className="text-xs text-slate-500">
            Allowed: {min}–{max} days. Default: {auditRetention?.default ?? 90}.
          </div>
        </div>
        {auditRetention && (
          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span data-testid="text-audit-retention-current">
              Currently keeping{" "}
              <span className="text-slate-200 font-medium">
                {auditRetention.days} day(s)
              </span>
            </span>
            {auditRetention.source !== "default" && (
              <Badge
                className={
                  envLocked
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-slate-700/40 text-slate-300"
                }
                data-testid="badge-audit-retention-source"
              >
                {envLocked ? "Locked by env var" : "Custom"}
              </Badge>
            )}
            {auditRetention.updatedAt && (
              <span>
                Last changed {new Date(auditRetention.updatedAt).toLocaleString()}
                {auditRetention.updatedBy ? ` by ${auditRetention.updatedBy}` : ""}
              </span>
            )}
          </div>
        )}
        {envLocked && (
          <p className="text-xs text-amber-300/80">
            The <code>AUDIT_LOG_RETENTION_DAYS</code> env var is set, so the
            sweep is using that value. Saved values are kept for when the
            override is removed.
          </p>
        )}
        {!isValid && draftDays !== "" && (
          <p className="text-xs text-red-400" data-testid="text-audit-retention-error">
            Enter a number between {min} and {max}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CommunityParticipantRetentionCard() {
  const {
    communityParticipantRetention,
    isCommunityParticipantRetentionLoading,
    isCommunityParticipantRetentionSaving,
    isCommunityParticipantRetentionRunning,
    lastCommunityParticipantRetentionRun,
    loadCommunityParticipantRetention,
    saveCommunityParticipantRetention,
    runCommunityParticipantRetention,
  } = useAdminDashboard();

  const [draftDays, setDraftDays] = useState<string>("");

  // Fetch the current setting whenever the audit panel mounts so the
  // input reflects the live value, including any env-var override.
  useEffect(() => {
    loadCommunityParticipantRetention();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the draft in sync with the loaded value, but don't clobber a
  // value the admin is in the middle of editing.
  useEffect(() => {
    if (communityParticipantRetention && draftDays === "") {
      setDraftDays(String(communityParticipantRetention.days));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityParticipantRetention?.days]);

  const min = communityParticipantRetention?.min ?? 1;
  const max = communityParticipantRetention?.max ?? 3650;
  const parsed = Number.parseFloat(draftDays);
  const isValid = Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const isDirty =
    !!communityParticipantRetention &&
    isValid &&
    parsed !== communityParticipantRetention.days;
  const envLocked = communityParticipantRetention?.envOverride === true;

  // Task #130 — when the draft window differs from the persisted one,
  // ask the server for a hypothetical count so the admin can see the
  // impact of the proposed change before clicking Save. Debounced so
  // typing doesn't fire one request per keystroke. When the draft
  // returns to the persisted value we issue a plain reload so the
  // server clears the lingering `previewDays`/`previewEligibleCount`
  // fields instead of leaving a stale preview rendered.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (isDirty) {
        loadCommunityParticipantRetention({ previewDays: parsed });
      } else if (
        communityParticipantRetention?.previewDays !== null &&
        communityParticipantRetention !== null
      ) {
        loadCommunityParticipantRetention();
      }
    }, 400);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, isDirty]);

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mb-4"
      data-testid="card-community-participant-retention"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <Users className="h-4 w-4 text-purple-400" />
          Community participant retention
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400">
          Anonymous community handles tied to sealed or completed cases are
          pruned by an hourly sweep once the case has been idle for this many
          days. Increase it to keep handles around longer for moderation
          review, or decrease it to drop the community footprint sooner.
          Changes apply on the next sweep tick and survive a server restart.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="community-participant-retention-days"
              className="text-xs text-slate-400"
            >
              Days to keep
            </Label>
            <Input
              id="community-participant-retention-days"
              type="number"
              min={min}
              max={max}
              step={1}
              value={draftDays}
              disabled={
                isCommunityParticipantRetentionLoading ||
                isCommunityParticipantRetentionSaving ||
                envLocked
              }
              onChange={(e) => setDraftDays(e.target.value)}
              className="w-32 bg-slate-950/60 border-slate-700 text-white"
              data-testid="input-community-participant-retention-days"
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!isValid) return;
              saveCommunityParticipantRetention(parsed);
            }}
            disabled={
              !isDirty ||
              isCommunityParticipantRetentionSaving ||
              isCommunityParticipantRetentionLoading ||
              envLocked
            }
            data-testid="button-community-participant-retention-save"
          >
            {isCommunityParticipantRetentionSaving ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 text-slate-200"
            onClick={() => runCommunityParticipantRetention()}
            disabled={
              isCommunityParticipantRetentionRunning ||
              isCommunityParticipantRetentionLoading
            }
            data-testid="button-community-participant-retention-run"
          >
            {isCommunityParticipantRetentionRunning
              ? "Running…"
              : "Run cleanup now"}
          </Button>
          <div className="text-xs text-slate-500">
            Allowed: {min}–{max} days. Default:{" "}
            {communityParticipantRetention?.default ?? 90}.
          </div>
        </div>
        {communityParticipantRetention && (
          <div
            className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-300 space-y-1"
            data-testid="text-community-participant-retention-eligible"
          >
            <div>
              {communityParticipantRetention.eligibleCount === null ? (
                <span className="text-amber-300/90">
                  Eligible count unavailable — the count query failed.
                  Check server logs.
                </span>
              ) : (
                <>
                  <span className="text-slate-200 font-medium">
                    {communityParticipantRetention.eligibleCount}
                  </span>{" "}
                  participant row(s) currently past the{" "}
                  {communityParticipantRetention.days}-day window — they
                  will be removed by upcoming sweeps (each sweep prunes
                  up to 500 rows at a time).
                </>
              )}
            </div>
            {communityParticipantRetention.previewDays !== null &&
              communityParticipantRetention.previewDays !==
                communityParticipantRetention.days && (
                <div
                  className="text-amber-300/90"
                  data-testid="text-community-participant-retention-preview"
                >
                  {communityParticipantRetention.previewEligibleCount ===
                  null ? (
                    <>
                      Preview at {communityParticipantRetention.previewDays}{" "}
                      day(s): unavailable.
                    </>
                  ) : (
                    <>
                      At {communityParticipantRetention.previewDays} day(s):{" "}
                      <span className="font-medium">
                        {communityParticipantRetention.previewEligibleCount}
                      </span>{" "}
                      row(s) would be eligible.
                    </>
                  )}
                </div>
              )}
          </div>
        )}
        {communityParticipantRetention && (
          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span data-testid="text-community-participant-retention-current">
              Currently keeping{" "}
              <span className="text-slate-200 font-medium">
                {communityParticipantRetention.days} day(s)
              </span>
            </span>
            {communityParticipantRetention.source !== "default" && (
              <Badge
                className={
                  envLocked
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-slate-700/40 text-slate-300"
                }
                data-testid="badge-community-participant-retention-source"
              >
                {envLocked ? "Locked by env var" : "Custom"}
              </Badge>
            )}
            {communityParticipantRetention.updatedAt && (
              <span>
                Last changed{" "}
                {new Date(
                  communityParticipantRetention.updatedAt,
                ).toLocaleString()}
                {communityParticipantRetention.updatedBy
                  ? ` by ${communityParticipantRetention.updatedBy}`
                  : ""}
              </span>
            )}
          </div>
        )}
        {lastCommunityParticipantRetentionRun && (
          <p
            className="text-xs text-slate-400"
            data-testid="text-community-participant-retention-last-run"
          >
            {lastCommunityParticipantRetentionRun.skipped
              ? "Last manual run was skipped — a sweep was already in progress."
              : `Last manual run removed ${lastCommunityParticipantRetentionRun.removed} participant row(s) past the ${lastCommunityParticipantRetentionRun.retentionDays}-day window.`}
          </p>
        )}
        {envLocked && (
          <p className="text-xs text-amber-300/80">
            The <code>COMMUNITY_PARTICIPANT_RETENTION_DAYS</code> env var is
            set, so the sweep is using that value. Saved values are kept for
            when the override is removed.
          </p>
        )}
        {!isValid && draftDays !== "" && (
          <p
            className="text-xs text-red-400"
            data-testid="text-community-participant-retention-error"
          >
            Enter a number between {min} and {max}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function WalletConnectAlertMarkerCleanupCard() {
  const {
    isWalletConnectAlertMarkerCleanupRunning,
    lastWalletConnectAlertMarkerCleanupRun,
    runWalletConnectAlertMarkerCleanup,
    walletConnectAlertMarkerCount,
    isWalletConnectAlertMarkerCountLoading,
    loadWalletConnectAlertMarkerCount,
  } = useAdminDashboard();

  useEffect(() => {
    void loadWalletConnectAlertMarkerCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mb-4"
      data-testid="card-wallet-connect-alert-marker-cleanup"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <Network className="h-4 w-4 text-cyan-400" />
          Wallet-connect alert markers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400">
          Wallet-connect alerts leave behind small "fired" and "mute" markers
          per case. An hourly background sweep drops markers whose case no
          longer exists. Run it on demand to reclaim those orphaned markers
          immediately and confirm the sweep is working.
        </p>
        <p
          className="text-xs text-slate-300"
          data-testid="text-wallet-connect-alert-marker-count"
        >
          {isWalletConnectAlertMarkerCountLoading &&
          !walletConnectAlertMarkerCount
            ? "Checking for orphaned markers…"
            : walletConnectAlertMarkerCount
              ? walletConnectAlertMarkerCount.orphaned > 0
                ? `${walletConnectAlertMarkerCount.orphaned} of ${walletConnectAlertMarkerCount.scanned} marker(s) are currently orphaned and can be cleaned up.`
                : `No orphaned markers right now (${walletConnectAlertMarkerCount.scanned} scanned).`
              : "Orphaned marker count unavailable."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 text-slate-200"
            onClick={() => runWalletConnectAlertMarkerCleanup()}
            disabled={isWalletConnectAlertMarkerCleanupRunning}
            data-testid="button-wallet-connect-alert-marker-cleanup-run"
          >
            {isWalletConnectAlertMarkerCleanupRunning
              ? "Running…"
              : "Run cleanup now"}
          </Button>
        </div>
        {lastWalletConnectAlertMarkerCleanupRun && (
          <p
            className="text-xs text-slate-400"
            data-testid="text-wallet-connect-alert-marker-cleanup-last-run"
          >
            {lastWalletConnectAlertMarkerCleanupRun.skipped
              ? "Last manual run was skipped — a sweep was already in progress."
              : lastWalletConnectAlertMarkerCleanupRun.deleted > 0
                ? `Last manual run removed ${lastWalletConnectAlertMarkerCleanupRun.deleted} orphaned marker(s) out of ${lastWalletConnectAlertMarkerCleanupRun.scanned} scanned.`
                : `Last manual run found no orphaned markers (${lastWalletConnectAlertMarkerCleanupRun.scanned} scanned).`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Task #842 — on-demand trigger for the durable wallet-connect completion
// backfill. The backfill normally runs once at boot to reconstruct any missing
// `wallet_connect_completed` audit rows from the fired markers; this lets an
// admin force it without a restart and see how many rows were inserted.
function WalletConnectCompletionBackfillCard() {
  const {
    isWalletConnectCompletionBackfillRunning,
    lastWalletConnectCompletionBackfillRun,
    runWalletConnectCompletionBackfill,
    walletConnectCompletionBackfillCount,
    isWalletConnectCompletionBackfillCountLoading,
    loadWalletConnectCompletionBackfillCount,
  } = useAdminDashboard();

  useEffect(() => {
    void loadWalletConnectCompletionBackfillCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mb-4"
      data-testid="card-wallet-connect-completion-backfill"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <Network className="h-4 w-4 text-cyan-400" />
          Wallet-connect completion backfill
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400">
          When a wallet-connect alert fires, a durable{" "}
          <code className="text-slate-300">wallet_connect_completed</code> audit
          row should follow. A one-time backfill runs at boot to reconstruct any
          missing rows from the fired markers. Run it on demand to force the
          backfill without a restart and see how many rows were inserted.
        </p>
        <p
          className="text-xs text-slate-300"
          data-testid="text-wallet-connect-completion-backfill-count"
        >
          {isWalletConnectCompletionBackfillCountLoading &&
          !walletConnectCompletionBackfillCount
            ? "Checking for missing completion rows…"
            : walletConnectCompletionBackfillCount
              ? walletConnectCompletionBackfillCount.missing > 0
                ? `${walletConnectCompletionBackfillCount.missing} of ${walletConnectCompletionBackfillCount.scanned} marker(s) are missing a completion row and can be backfilled.`
                : `All completion rows are present (${walletConnectCompletionBackfillCount.scanned} marker(s) scanned).`
              : "Missing completion row count unavailable."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 text-slate-200"
            onClick={() => runWalletConnectCompletionBackfill()}
            disabled={isWalletConnectCompletionBackfillRunning}
            data-testid="button-wallet-connect-completion-backfill-run"
          >
            {isWalletConnectCompletionBackfillRunning
              ? "Running…"
              : "Run backfill now"}
          </Button>
        </div>
        {lastWalletConnectCompletionBackfillRun && (
          <p
            className="text-xs text-slate-400"
            data-testid="text-wallet-connect-completion-backfill-last-run"
          >
            {lastWalletConnectCompletionBackfillRun.skipped
              ? "Last manual run was skipped — a backfill was already in progress."
              : lastWalletConnectCompletionBackfillRun.inserted > 0
                ? `Last manual run inserted ${lastWalletConnectCompletionBackfillRun.inserted} missing completion row(s) out of ${lastWalletConnectCompletionBackfillRun.scanned} marker(s) scanned.`
                : `Last manual run found nothing to backfill (${lastWalletConnectCompletionBackfillRun.scanned} marker(s) scanned).`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Task #800 — admin editor for the wallet-connect alert marker cleanup sweep
// cadence (`app_settings.wallet_connect_alert_cleanup_interval_ms`). The setting
// is stored in milliseconds (to match the env override) but presented in minutes
// here for usability. An env-var override locks the input but the stored value
// stays editable so it's ready when the override is removed.
function WalletConnectAlertCleanupIntervalCard() {
  const {
    walletConnectAlertCleanupInterval,
    isWalletConnectAlertCleanupIntervalLoading,
    isWalletConnectAlertCleanupIntervalSaving,
    loadWalletConnectAlertCleanupInterval,
    saveWalletConnectAlertCleanupInterval,
  } = useAdminDashboard();

  const [draftMinutes, setDraftMinutes] = useState<string>("");
  // Ticks every 30s so the relative "last swept / next due" labels stay current
  // without re-fetching the setting (mirrors the NDA sweep cadence card).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    loadWalletConnectAlertCleanupInterval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the draft in sync with the loaded value (converted ms -> minutes),
  // but don't clobber a value the admin is mid-edit.
  useEffect(() => {
    if (walletConnectAlertCleanupInterval && draftMinutes === "") {
      setDraftMinutes(
        String(Math.round(walletConnectAlertCleanupInterval.ms / 60000)),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletConnectAlertCleanupInterval?.ms]);

  const minMinutes = walletConnectAlertCleanupInterval
    ? Math.round(walletConnectAlertCleanupInterval.minMs / 60000)
    : 1;
  const maxMinutes = walletConnectAlertCleanupInterval
    ? Math.round(walletConnectAlertCleanupInterval.maxMs / 60000)
    : 7 * 24 * 60;
  const defaultMinutes = walletConnectAlertCleanupInterval
    ? Math.round(walletConnectAlertCleanupInterval.defaultMs / 60000)
    : 60;
  const currentMinutes = walletConnectAlertCleanupInterval
    ? Math.round(walletConnectAlertCleanupInterval.ms / 60000)
    : null;
  const parsed = Number.parseFloat(draftMinutes);
  const isValid =
    Number.isFinite(parsed) && parsed >= minMinutes && parsed <= maxMinutes;
  const isDirty =
    !!walletConnectAlertCleanupInterval &&
    isValid &&
    currentMinutes !== null &&
    parsed !== currentMinutes;
  const envLocked = walletConnectAlertCleanupInterval?.envOverride === true;

  // Task #832 — humanize a duration in minutes into a compact relative phrase
  // (minutes under 1h, hours+minutes under 24h, days+hours beyond that).
  const describeMinutes = (totalMin: number): string => {
    const m = Math.max(1, Math.round(totalMin));
    if (m < 60) return `${m} min`;
    if (m < 60 * 24) {
      const h = Math.floor(m / 60);
      const rem = m % 60;
      return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
    }
    const d = Math.floor(m / (60 * 24));
    const h = Math.floor((m % (60 * 24)) / 60);
    return h === 0 ? `${d} day${d === 1 ? "" : "s"}` : `${d}d ${h}h`;
  };

  const lastSweepAt = walletConnectAlertCleanupInterval?.lastSweepAt ?? null;
  const lastSweepMs = lastSweepAt ? new Date(lastSweepAt).getTime() : NaN;
  const lastSweepLabel = Number.isFinite(lastSweepMs)
    ? `${describeMinutes((nowMs - lastSweepMs) / 60000)} ago`
    : null;

  const nextSweepAt = walletConnectAlertCleanupInterval?.nextSweepAt ?? null;
  const nextSweepMs = nextSweepAt ? new Date(nextSweepAt).getTime() : NaN;
  const nextSweepDiffMs = Number.isFinite(nextSweepMs)
    ? nextSweepMs - nowMs
    : NaN;
  const nextSweepRelative = Number.isFinite(nextSweepDiffMs)
    ? nextSweepDiffMs <= 0
      ? "due now"
      : `in ${describeMinutes(nextSweepDiffMs / 60000)}`
    : null;

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mb-4"
      data-testid="card-wallet-connect-alert-cleanup-interval"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <Network className="h-4 w-4 text-cyan-400" />
          Wallet-connect marker cleanup cadence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400">
          How often the background sweep prunes orphaned wallet-connect alert
          markers (fired/mute rows for deleted cases). Loosen this on large
          deployments to reduce sweep churn, or tighten it to reclaim markers
          sooner. Changes reschedule the timer immediately and survive a server
          restart.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="wallet-connect-alert-cleanup-minutes"
              className="text-xs text-slate-400"
            >
              Minutes between sweeps
            </Label>
            <Input
              id="wallet-connect-alert-cleanup-minutes"
              type="number"
              min={minMinutes}
              max={maxMinutes}
              step={1}
              value={draftMinutes}
              disabled={
                isWalletConnectAlertCleanupIntervalLoading ||
                isWalletConnectAlertCleanupIntervalSaving ||
                envLocked
              }
              onChange={(e) => setDraftMinutes(e.target.value)}
              className="w-32 bg-slate-950/60 border-slate-700 text-white"
              data-testid="input-wallet-connect-alert-cleanup-minutes"
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!isValid) return;
              saveWalletConnectAlertCleanupInterval(parsed);
            }}
            disabled={
              !isDirty ||
              isWalletConnectAlertCleanupIntervalSaving ||
              isWalletConnectAlertCleanupIntervalLoading ||
              envLocked
            }
            data-testid="button-wallet-connect-alert-cleanup-save"
          >
            {isWalletConnectAlertCleanupIntervalSaving ? "Saving…" : "Save"}
          </Button>
          <div className="text-xs text-slate-500">
            Allowed: {minMinutes}–{maxMinutes} min. Default: {defaultMinutes}.
          </div>
        </div>
        {walletConnectAlertCleanupInterval && currentMinutes !== null && (
          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span data-testid="text-wallet-connect-alert-cleanup-current">
              Currently sweeping every{" "}
              <span className="text-slate-200 font-medium">
                {currentMinutes} minute(s)
              </span>
            </span>
            {walletConnectAlertCleanupInterval.source !== "default" && (
              <Badge
                className={
                  envLocked
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-slate-700/40 text-slate-300"
                }
                data-testid="badge-wallet-connect-alert-cleanup-source"
              >
                {envLocked ? "Locked by env var" : "Custom"}
              </Badge>
            )}
            {walletConnectAlertCleanupInterval.updatedAt && (
              <span>
                Last changed{" "}
                {new Date(
                  walletConnectAlertCleanupInterval.updatedAt,
                ).toLocaleString()}
                {walletConnectAlertCleanupInterval.updatedBy
                  ? ` by ${walletConnectAlertCleanupInterval.updatedBy}`
                  : ""}
              </span>
            )}
            {lastSweepLabel && lastSweepAt && (
              <span data-testid="text-wallet-connect-alert-cleanup-last-sweep">
                Last swept{" "}
                <span className="text-slate-200 font-medium">
                  {new Date(lastSweepAt).toLocaleString()}
                </span>{" "}
                <span className="text-slate-400">({lastSweepLabel})</span>
              </span>
            )}
            {nextSweepRelative && nextSweepAt && (
              <span data-testid="text-wallet-connect-alert-cleanup-next-sweep">
                Next sweep due{" "}
                <span className="text-slate-200 font-medium">
                  {nextSweepRelative === "due now"
                    ? "now"
                    : new Date(nextSweepAt).toLocaleString()}
                </span>
                {nextSweepRelative !== "due now" && (
                  <>
                    {" "}
                    <span className="text-slate-400">({nextSweepRelative})</span>
                  </>
                )}
              </span>
            )}
          </div>
        )}
        {envLocked && (
          <p className="text-xs text-amber-300/80">
            The <code>WALLET_CONNECT_ALERT_CLEANUP_INTERVAL_MS</code> env var is
            set, so the sweep is using that value. Saved values are kept for
            when the override is removed.
          </p>
        )}
        {!isValid && draftMinutes !== "" && (
          <p
            className="text-xs text-red-400"
            data-testid="text-wallet-connect-alert-cleanup-error"
          >
            Enter a number between {minMinutes} and {maxMinutes}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CommunityThreadViewsCleanupCard() {
  const {
    isCommunityThreadViewsCleanupRunning,
    lastCommunityThreadViewsCleanupRun,
    runCommunityThreadViewsCleanup,
    communityThreadViewsStaleCount,
    isCommunityThreadViewsStaleCountLoading,
    loadCommunityThreadViewsStaleCount,
  } = useAdminDashboard();

  useEffect(() => {
    loadCommunityThreadViewsStaleCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isCommunityThreadViewsCleanupRunning) return;
    const id = setInterval(() => {
      loadCommunityThreadViewsStaleCount();
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCommunityThreadViewsCleanupRunning]);

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mb-4"
      data-testid="card-community-thread-views-cleanup"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <Eye className="h-4 w-4 text-cyan-400" />
          Community thread-view tracking
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400">
          Forum view counts use a 48-hour deduplication window backed by a
          tracking table. An hourly background sweep prunes rows older than
          that window. Run it on demand to reclaim those stale rows
          immediately and confirm the sweep is working.
        </p>
        <div
          className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-300"
          data-testid="text-community-thread-views-stale-count"
        >
          {communityThreadViewsStaleCount === 'unavailable' ? (
            <span className="text-amber-300/90">
              Eligible count unavailable — the count query failed. Check server
              logs.
            </span>
          ) : communityThreadViewsStaleCount === null ||
            isCommunityThreadViewsStaleCountLoading ? (
            <span className="text-slate-500">Loading eligible count…</span>
          ) : (
            <>
              <span className="text-slate-200 font-medium">
                {communityThreadViewsStaleCount}
              </span>{" "}
              thread-view row(s) currently past the 48-hour window — they will
              be removed by the next sweep.
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 text-slate-200"
            onClick={() => runCommunityThreadViewsCleanup()}
            disabled={isCommunityThreadViewsCleanupRunning}
            data-testid="button-community-thread-views-cleanup-run"
          >
            {isCommunityThreadViewsCleanupRunning
              ? "Running…"
              : "Run cleanup now"}
          </Button>
        </div>
        {lastCommunityThreadViewsCleanupRun && (
          <p
            className="text-xs text-slate-400"
            data-testid="text-community-thread-views-cleanup-last-run"
          >
            {lastCommunityThreadViewsCleanupRun.skipped
              ? "Last manual run was skipped — a sweep was already in progress."
              : lastCommunityThreadViewsCleanupRun.deleted > 0
                ? `Last manual run removed ${lastCommunityThreadViewsCleanupRun.deleted} stale thread-view row(s).`
                : "Last manual run found no stale thread-view rows."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function NdaSweepIntervalCard() {
  const {
    ndaSweepInterval,
    isNdaSweepIntervalLoading,
    isNdaSweepIntervalSaving,
    loadNdaSweepInterval,
    saveNdaSweepInterval,
    ndaIntegritySweep,
  } = useAdminDashboard();

  const [draftHours, setDraftHours] = useState<string>("");
  // Ticks every 30s so the relative "in X min" countdown next to the
  // absolute "Next sweep:" timestamp updates at least once per minute
  // without waiting for the 5-minute summary poll. 30s (rather than 60s)
  // keeps the displayed minutes from lagging by up to a full minute.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    loadNdaSweepInterval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ndaSweepInterval && draftHours === "") {
      setDraftHours(String(ndaSweepInterval.hours));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ndaSweepInterval?.hours]);

  const min = ndaSweepInterval?.min ?? 1;
  const max = ndaSweepInterval?.max ?? 24 * 7;
  const parsed = Number.parseFloat(draftHours);
  const isValid = Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const isDirty =
    !!ndaSweepInterval && isValid && parsed !== ndaSweepInterval.hours;
  const envLocked = ndaSweepInterval?.envOverride === true;

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mb-4"
      data-testid="card-nda-sweep-interval"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <ShieldAlert className="h-4 w-4 text-purple-400" />
          Sealed NDA integrity sweep cadence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400">
          How often the background sweep re-hashes every sealed NDA PDF and
          alerts on tamper detection. Tighten this (e.g. to 1 hour) after a
          tampering incident or backup restore; loosen it for normal
          operation. Changes reschedule the timer immediately and survive a
          server restart.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="nda-sweep-interval-hours" className="text-xs text-slate-400">
              Hours between sweeps
            </Label>
            <Input
              id="nda-sweep-interval-hours"
              type="number"
              min={min}
              max={max}
              step={1}
              value={draftHours}
              disabled={
                isNdaSweepIntervalLoading || isNdaSweepIntervalSaving || envLocked
              }
              onChange={(e) => setDraftHours(e.target.value)}
              className="w-32 bg-slate-950/60 border-slate-700 text-white"
              data-testid="input-nda-sweep-interval-hours"
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!isValid) return;
              saveNdaSweepInterval(parsed);
            }}
            disabled={
              !isDirty ||
              isNdaSweepIntervalSaving ||
              isNdaSweepIntervalLoading ||
              envLocked
            }
            data-testid="button-nda-sweep-interval-save"
          >
            {isNdaSweepIntervalSaving ? "Saving…" : "Save"}
          </Button>
          <div className="text-xs text-slate-500">
            Allowed: {min}–{max} hours. Default: {ndaSweepInterval?.default ?? 24}.
          </div>
        </div>
        {ndaSweepInterval && (
          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span data-testid="text-nda-sweep-interval-current">
              Currently sweeping every{" "}
              <span className="text-slate-200 font-medium">
                {ndaSweepInterval.hours} hour(s)
              </span>
            </span>
            {(() => {
              // Compute the next expected sweep time from the most recent
              // sweep's finishedAt + the configured interval. We deliberately
              // use the *saved* interval (not the in-flight draft) so the
              // value reflects the cadence the server is actually running on,
              // and only update once the admin presses Save. If the computed
              // time is already in the past (e.g. server was asleep), we
              // surface "due now" rather than a stale historical timestamp.
              if (!ndaIntegritySweep?.finishedAt) return null;
              const last = new Date(ndaIntegritySweep.finishedAt).getTime();
              if (!Number.isFinite(last)) return null;
              const next = last + ndaSweepInterval.hours * 60 * 60 * 1000;
              const diffMs = next - nowMs;
              const isDue = diffMs <= 0;
              const label = isDue ? "due now" : new Date(next).toLocaleString();
              // Relative countdown that ticks (see nowMs effect above).
              // Uses minutes under 1h, hours+minutes under 24h, days+hours
              // beyond that, so operators can eyeball cadence changes
              // immediately instead of waiting for the next summary poll.
              let relative: string | null = null;
              if (!isDue) {
                const totalMin = Math.max(1, Math.round(diffMs / 60000));
                if (totalMin < 60) {
                  relative = `in ${totalMin} min`;
                } else if (totalMin < 60 * 24) {
                  const h = Math.floor(totalMin / 60);
                  const m = totalMin % 60;
                  relative = m === 0 ? `in ${h} hr` : `in ${h} hr ${m} min`;
                } else {
                  const d = Math.floor(totalMin / (60 * 24));
                  const h = Math.floor((totalMin % (60 * 24)) / 60);
                  relative = h === 0 ? `in ${d} day${d === 1 ? "" : "s"}` : `in ${d}d ${h}h`;
                }
              }
              return (
                <span data-testid="text-nda-sweep-interval-next">
                  Next sweep:{" "}
                  <span className="text-slate-200 font-medium">{label}</span>
                  {relative && (
                    <>
                      {" "}
                      <span
                        className="text-slate-400"
                        data-testid="text-nda-sweep-interval-next-relative"
                      >
                        ({relative})
                      </span>
                    </>
                  )}
                </span>
              );
            })()}
            {ndaSweepInterval.source !== "default" && (
              <Badge
                className={
                  envLocked
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-slate-700/40 text-slate-300"
                }
                data-testid="badge-nda-sweep-interval-source"
              >
                {envLocked ? "Locked by env var" : "Custom"}
              </Badge>
            )}
            {ndaSweepInterval.updatedAt && (
              <span>
                Last changed {new Date(ndaSweepInterval.updatedAt).toLocaleString()}
                {ndaSweepInterval.updatedBy ? ` by ${ndaSweepInterval.updatedBy}` : ""}
              </span>
            )}
          </div>
        )}
        {envLocked && (
          <p className="text-xs text-amber-300/80">
            The <code>NDA_INTEGRITY_SWEEP_INTERVAL_HOURS</code> env var is
            set, so the sweep is using that value. Saved values are kept for
            when the override is removed.
          </p>
        )}
        {!isValid && draftHours !== "" && (
          <p className="text-xs text-red-400" data-testid="text-nda-sweep-interval-error">
            Enter a number between {min} and {max}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Admin-facing editor for the stale-sweep watchdog grace window
// (`app_settings.nda_integrity_sweep_stale_grace_hours`). Sits next to
// the cadence editor so operators can adjust sensitivity and threshold
// in the same place. An env-var override
// (`NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS`) locks the input but the
// stored value is still editable so it's ready when the override is
// removed.
function NdaSweepStaleGraceCard() {
  const {
    ndaSweepInterval,
    ndaSweepStaleGrace,
    isNdaSweepStaleGraceLoading,
    isNdaSweepStaleGraceSaving,
    loadNdaSweepStaleGrace,
    saveNdaSweepStaleGrace,
  } = useAdminDashboard();

  const [draftHours, setDraftHours] = useState<string>("");

  useEffect(() => {
    loadNdaSweepStaleGrace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ndaSweepStaleGrace && draftHours === "") {
      setDraftHours(String(ndaSweepStaleGrace.hours));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ndaSweepStaleGrace?.hours]);

  const min = ndaSweepStaleGrace?.min ?? 0;
  const max = ndaSweepStaleGrace?.max ?? 24 * 7;
  const parsed = Number.parseFloat(draftHours);
  const isValid = Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const isDirty =
    !!ndaSweepStaleGrace && isValid && parsed !== ndaSweepStaleGrace.hours;
  const envLocked = ndaSweepStaleGrace?.envOverride === true;
  const thresholdHours =
    ndaSweepInterval && ndaSweepStaleGrace
      ? ndaSweepInterval.hours + ndaSweepStaleGrace.hours
      : null;

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mb-4"
      data-testid="card-nda-sweep-stale-grace"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <ShieldAlert className="h-4 w-4 text-amber-400" />
          Stale-sweep watchdog grace window
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400">
          Extra time past the configured cadence before the watchdog
          declares the sweep stale and alerts the tamper-alert recipient.
          Tighten this (e.g. 0–1h) right after a tampering incident for
          faster alerting; loosen it (e.g. 12h) when running an
          intentionally slow cadence so a single missed window doesn't
          page ops. Changes take effect on the next watchdog tick
          (within ~1h).
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="nda-sweep-stale-grace-hours"
              className="text-xs text-slate-400"
            >
              Grace hours
            </Label>
            <Input
              id="nda-sweep-stale-grace-hours"
              type="number"
              min={min}
              max={max}
              step={1}
              value={draftHours}
              disabled={
                isNdaSweepStaleGraceLoading ||
                isNdaSweepStaleGraceSaving ||
                envLocked
              }
              onChange={(e) => setDraftHours(e.target.value)}
              className="w-32 bg-slate-950/60 border-slate-700 text-white"
              data-testid="input-nda-sweep-stale-grace-hours"
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!isValid) return;
              saveNdaSweepStaleGrace(parsed);
            }}
            disabled={
              !isDirty ||
              isNdaSweepStaleGraceSaving ||
              isNdaSweepStaleGraceLoading ||
              envLocked
            }
            data-testid="button-nda-sweep-stale-grace-save"
          >
            {isNdaSweepStaleGraceSaving ? "Saving…" : "Save"}
          </Button>
          <div className="text-xs text-slate-500">
            Allowed: {min}–{max} hours. Default:{" "}
            {ndaSweepStaleGrace?.default ?? 6}.
          </div>
        </div>
        {ndaSweepStaleGrace && (
          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span data-testid="text-nda-sweep-stale-grace-current">
              Current grace:{" "}
              <span className="text-slate-200 font-medium">
                {ndaSweepStaleGrace.hours} hour(s)
              </span>
            </span>
            {thresholdHours !== null && (
              <span data-testid="text-nda-sweep-stale-grace-threshold">
                Stale after{" "}
                <span className="text-slate-200 font-medium">
                  {thresholdHours} hour(s)
                </span>{" "}
                without a successful sweep
              </span>
            )}
            {ndaSweepStaleGrace.source !== "default" && (
              <Badge
                className={
                  envLocked
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-slate-700/40 text-slate-300"
                }
                data-testid="badge-nda-sweep-stale-grace-source"
              >
                {envLocked ? "Locked by env var" : "Custom"}
              </Badge>
            )}
            {ndaSweepStaleGrace.updatedAt && (
              <span>
                Last changed{" "}
                {new Date(ndaSweepStaleGrace.updatedAt).toLocaleString()}
                {ndaSweepStaleGrace.updatedBy
                  ? ` by ${ndaSweepStaleGrace.updatedBy}`
                  : ""}
              </span>
            )}
          </div>
        )}
        {envLocked && (
          <p className="text-xs text-amber-300/80">
            The <code>NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS</code> env var
            is set, so the watchdog is using that value. Saved values are
            kept for when the override is removed.
          </p>
        )}
        {!isValid && draftHours !== "" && (
          <p
            className="text-xs text-red-400"
            data-testid="text-nda-sweep-stale-grace-error"
          >
            Enter a number between {min} and {max}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Admin-facing editor for the sealed-NDA tamper alert recipient
// (`app_settings.admin_alert_email`). Supports a comma-separated
// distribution list. An env-var override locks the input but the
// stored value is still editable so it's ready when the override
// is removed. An empty value clears the override and the sweep
// silently no-ops (per existing behaviour).
function TamperAlertEmailPanel() {
  const {
    tamperAlertEmail,
    isTamperAlertEmailLoading,
    isTamperAlertEmailSaving,
    isTamperAlertEmailTesting,
    loadTamperAlertEmail,
    saveTamperAlertEmail,
    sendTamperAlertEmailTest,
    ndaSweepStaleness,
    isNdaSweepStalenessLoading,
    loadNdaSweepStaleness,
  } = useAdminDashboard();

  const [draft, setDraft] = useState<string>("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    loadTamperAlertEmail();
    loadNdaSweepStaleness();
    // Refresh the staleness banner every 5 minutes so a sweep that
    // silently stops running surfaces here within minutes of the
    // watchdog tick that would have caught it, without forcing a
    // dashboard reload.
    const id = window.setInterval(loadNdaSweepStaleness, 5 * 60 * 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed the draft once from the loaded stored value, but don't clobber
  // a value the admin is in the middle of editing.
  useEffect(() => {
    if (tamperAlertEmail && !touched) {
      setDraft(tamperAlertEmail.storedValue ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tamperAlertEmail?.storedValue]);

  const envLocked = tamperAlertEmail?.envOverride === true;
  const trimmed = draft.trim();
  const isDirty =
    !!tamperAlertEmail && trimmed !== (tamperAlertEmail.storedValue ?? "").trim();
  // Mirror server-side validation so the Save button is disabled before
  // the round-trip when the input is obviously wrong.
  const draftRecipients = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
  const allValid = draftRecipients.every((r) => EMAIL_RE.test(r));
  // The DB-stored value stays editable even when an env-var override is
  // in force, so admins can pre-stage a future value that will take
  // effect as soon as the override is removed. Only obvious validation
  // failures block saving.
  const canSave = isDirty && (trimmed === "" || allValid);

  return (
    <Card
      className="bg-slate-900/50 border-slate-800"
      data-testid="card-tamper-alert-email-panel"
    >
      <CardHeader>
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Mail className="h-5 w-5 text-rose-400" />
          Sealed NDA tamper alert recipient
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-400">
          Address (or comma-separated distribution list) that receives the
          out-of-band alert email when the nightly sealed-PDF integrity
          sweep detects tampering. Leave blank to silence the email — the
          in-dashboard notification and per-case audit rows still fire.
          The <code>ADMIN_ALERT_EMAIL</code> env var, when set, overrides
          this value.
        </p>

        <div className="space-y-2">
          <Label
            htmlFor="tamper-alert-email-input"
            className="text-xs text-slate-400"
          >
            Recipient(s)
          </Label>
          <Input
            id="tamper-alert-email-input"
            type="text"
            value={draft}
            disabled={
              isTamperAlertEmailLoading || isTamperAlertEmailSaving
            }
            onChange={(e) => {
              setTouched(true);
              setDraft(e.target.value);
            }}
            placeholder="ops@example.com, security@example.com"
            className="bg-slate-950/60 border-slate-700 text-white"
            data-testid="input-tamper-alert-email"
          />
          {trimmed !== "" && !allValid && (
            <p
              className="text-xs text-red-400"
              data-testid="text-tamper-alert-email-error"
            >
              One or more addresses look invalid. Use a comma-separated list
              like <code>ops@example.com, security@example.com</code>.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            onClick={() => saveTamperAlertEmail(draft)}
            disabled={!canSave || isTamperAlertEmailSaving}
            data-testid="button-tamper-alert-email-save"
          >
            {isTamperAlertEmailSaving ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => sendTamperAlertEmailTest()}
            disabled={
              isTamperAlertEmailTesting ||
              isTamperAlertEmailSaving ||
              isTamperAlertEmailLoading ||
              isDirty ||
              !tamperAlertEmail ||
              tamperAlertEmail.recipients.length === 0
            }
            className="border-rose-500/40 text-rose-200 hover:bg-rose-500/10"
            data-testid="button-tamper-alert-email-test"
            title={
              isDirty
                ? "Save your recipient changes first, then send the test."
                : tamperAlertEmail && tamperAlertEmail.recipients.length === 0
                  ? "Set a recipient before sending a test."
                  : "Send a one-off test email to the effective recipient list."
            }
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {isTamperAlertEmailTesting ? "Sending…" : "Send test alert"}
          </Button>
          {isDirty && trimmed === "" && (
            <span className="text-xs text-amber-300/90">
              Saving will clear the stored recipient — once any env override
              is removed, alert emails will no-op until a recipient is set.
            </span>
          )}
          {isDirty && trimmed !== "" && (
            <span
              className="text-xs text-slate-400"
              data-testid="text-tamper-alert-email-test-hint"
            >
              Save your changes before sending a test — the test always uses
              the effective recipient list.
            </span>
          )}
        </div>

        {tamperAlertEmail && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-400">Currently in force:</span>
              {tamperAlertEmail.recipients.length === 0 ? (
                <Badge
                  className="bg-slate-700/40 text-slate-300"
                  data-testid="badge-tamper-alert-email-empty"
                >
                  No recipient — alert email disabled
                </Badge>
              ) : (
                <span
                  className="text-slate-200 font-medium"
                  data-testid="text-tamper-alert-email-current"
                >
                  {tamperAlertEmail.recipients.join(", ")}
                </span>
              )}
              {tamperAlertEmail.source !== "default" && (
                <Badge
                  className={
                    envLocked
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-slate-700/40 text-slate-300"
                  }
                  data-testid="badge-tamper-alert-email-source"
                >
                  {envLocked ? "Locked by env var" : "Custom"}
                </Badge>
              )}
            </div>
            {tamperAlertEmail.updatedAt && (
              <div className="text-slate-500">
                Stored value last changed{" "}
                {new Date(tamperAlertEmail.updatedAt).toLocaleString()}
                {tamperAlertEmail.updatedBy
                  ? ` by ${tamperAlertEmail.updatedBy}`
                  : ""}
                .
              </div>
            )}
          </div>
        )}

        {envLocked && (
          <p className="text-xs text-amber-300/80">
            The <code>ADMIN_ALERT_EMAIL</code> env var is set, so alert
            emails are going to that value. Your saved address is kept here
            and will take effect when the override is removed.
          </p>
        )}

        {/* Stale-sweep watchdog status. Surfaces in this panel because
            the same recipient list receives the out-of-band stale alert
            email — so admins editing the recipient see whether the
            watchdog itself currently has anything to report. */}
        <div
          className={
            "rounded-lg border px-4 py-3 space-y-2 text-xs " +
            (ndaSweepStaleness?.isStale
              ? "border-rose-500/40 bg-rose-500/10"
              : ndaSweepStaleness?.neverRan
                ? "border-slate-700 bg-slate-950/60"
                : "border-emerald-500/30 bg-emerald-500/5")
          }
          data-testid="card-tamper-alert-staleness"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">Stale-sweep watchdog:</span>
            {isNdaSweepStalenessLoading && !ndaSweepStaleness ? (
              <Badge className="bg-slate-700/40 text-slate-300">
                Checking…
              </Badge>
            ) : !ndaSweepStaleness ? (
              <Badge className="bg-slate-700/40 text-slate-300">
                Unavailable
              </Badge>
            ) : ndaSweepStaleness.isStale ? (
              <Badge
                className="bg-rose-500/30 text-rose-100"
                data-testid="badge-tamper-alert-stale"
              >
                {ndaSweepStaleness.readError
                  ? "STALE — settings store unreachable"
                  : ndaSweepStaleness.neverRan
                    ? "STALE — no successful sweep since boot"
                    : "STALE — sweep has stopped running"}
              </Badge>
            ) : ndaSweepStaleness.neverRan ? (
              <Badge className="bg-slate-700/40 text-slate-300">
                No successful sweep yet (waiting for boot sweep)
              </Badge>
            ) : (
              <Badge
                className="bg-emerald-500/20 text-emerald-200"
                data-testid="badge-tamper-alert-fresh"
              >
                Healthy
              </Badge>
            )}
          </div>
          {ndaSweepStaleness && (
            <div className="text-slate-400 leading-relaxed">
              <div>
                Last successful sweep:{" "}
                <span className="text-slate-200">
                  {ndaSweepStaleness.lastSuccessAt
                    ? new Date(ndaSweepStaleness.lastSuccessAt).toLocaleString()
                    : "never"}
                </span>
              </div>
              <div>
                Stale threshold:{" "}
                <span className="text-slate-200">
                  {ndaSweepStaleness.thresholdHours}h
                </span>{" "}
                (interval {ndaSweepStaleness.intervalHours}h + grace{" "}
                {ndaSweepStaleness.graceHours}h)
              </div>
              {ndaSweepStaleness.isStale && (
                <div className="text-rose-200">
                  Overdue by{" "}
                  {(ndaSweepStaleness.overdueMs / (60 * 60 * 1000)).toFixed(1)}h.
                  An alert email has been (or will shortly be) sent to the
                  recipient list above; the audit log records the stale event
                  regardless of email delivery. Re-run the sweep from the
                  global tamper banner once the underlying issue is resolved.
                </div>
              )}
              {ndaSweepStaleness.lastStaleAlertSentAt && (
                <div className="text-slate-500">
                  Last stale alert email:{" "}
                  {new Date(
                    ndaSweepStaleness.lastStaleAlertSentAt,
                  ).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DocumentUploadAlertEmailPanel() {
  const {
    documentUploadAlertEmail,
    isDocumentUploadAlertEmailLoading,
    isDocumentUploadAlertEmailSaving,
    isDocumentUploadAlertEmailTesting,
    loadDocumentUploadAlertEmail,
    saveDocumentUploadAlertEmail,
    sendDocumentUploadAlertEmailTest,
  } = useAdminDashboard();

  const [draft, setDraft] = useState<string>("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    loadDocumentUploadAlertEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (documentUploadAlertEmail && !touched) {
      setDraft(documentUploadAlertEmail.storedValue ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentUploadAlertEmail?.storedValue]);

  const envLocked = documentUploadAlertEmail?.envOverride === true;
  const trimmed = draft.trim();
  const isDirty =
    !!documentUploadAlertEmail &&
    trimmed !== (documentUploadAlertEmail.storedValue ?? "").trim();
  const draftRecipients = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
  const allValid = draftRecipients.every((r) => EMAIL_RE.test(r));
  const canSave = isDirty && (trimmed === "" || allValid);

  const isFallback = documentUploadAlertEmail?.source === "fallback";

  return (
    <Card
      className="bg-slate-900/50 border-slate-800"
      data-testid="card-document-upload-alert-email-panel"
    >
      <CardHeader>
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Mail className="h-5 w-5 text-blue-400" />
          Document upload alert recipient
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-400">
          Address (or comma-separated distribution list) that receives an
          out-of-band email whenever a portal user uploads a document for
          compliance review. Useful for routing upload notifications to a
          dedicated compliance inbox instead of the shared security alias.
          Leave blank to fall back to the shared <code>ADMIN_ALERT_EMAIL</code>
          recipient. Set <code>DOCUMENT_UPLOAD_ALERT_EMAIL</code> as an env
          var to lock the value at the operator level.
        </p>

        <div className="space-y-2">
          <Label
            htmlFor="document-upload-alert-email-input"
            className="text-xs text-slate-400"
          >
            Recipient(s)
          </Label>
          <Input
            id="document-upload-alert-email-input"
            type="text"
            value={draft}
            disabled={
              isDocumentUploadAlertEmailLoading ||
              isDocumentUploadAlertEmailSaving
            }
            onChange={(e) => {
              setTouched(true);
              setDraft(e.target.value);
            }}
            placeholder="compliance@example.com, docs@example.com"
            className="bg-slate-950/60 border-slate-700 text-white"
            data-testid="input-document-upload-alert-email"
          />
          {trimmed !== "" && !allValid && (
            <p
              className="text-xs text-red-400"
              data-testid="text-document-upload-alert-email-error"
            >
              One or more addresses look invalid. Use a comma-separated list
              like <code>compliance@example.com, docs@example.com</code>.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            onClick={() => saveDocumentUploadAlertEmail(draft)}
            disabled={!canSave || isDocumentUploadAlertEmailSaving}
            data-testid="button-document-upload-alert-email-save"
          >
            {isDocumentUploadAlertEmailSaving ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => sendDocumentUploadAlertEmailTest()}
            disabled={
              isDocumentUploadAlertEmailTesting ||
              isDocumentUploadAlertEmailSaving ||
              isDocumentUploadAlertEmailLoading ||
              isDirty ||
              !documentUploadAlertEmail ||
              documentUploadAlertEmail.recipients.length === 0
            }
            className="border-blue-500/40 text-blue-200 hover:bg-blue-500/10"
            data-testid="button-document-upload-alert-email-test"
            title={
              isDirty
                ? "Save your recipient changes first, then send the test."
                : documentUploadAlertEmail && documentUploadAlertEmail.recipients.length === 0
                  ? "Set a recipient before sending a test."
                  : "Send a one-off test email to the effective recipient list."
            }
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {isDocumentUploadAlertEmailTesting ? "Sending…" : "Send test alert"}
          </Button>
          {isDirty && trimmed === "" && (
            <span className="text-xs text-amber-300/90">
              Saving will clear the dedicated recipient — upload alerts will
              fall back to the shared <code>ADMIN_ALERT_EMAIL</code> address.
            </span>
          )}
          {isDirty && trimmed !== "" && (
            <span
              className="text-xs text-slate-400"
              data-testid="text-document-upload-alert-email-test-hint"
            >
              Save your changes before sending a test — the test always uses
              the effective recipient list.
            </span>
          )}
        </div>

        {documentUploadAlertEmail && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-400">Currently in force:</span>
              {documentUploadAlertEmail.recipients.length === 0 ? (
                <Badge
                  className="bg-slate-700/40 text-slate-300"
                  data-testid="badge-document-upload-alert-email-empty"
                >
                  No recipient — alert email disabled
                </Badge>
              ) : (
                <span
                  className="text-slate-200 font-medium"
                  data-testid="text-document-upload-alert-email-current"
                >
                  {documentUploadAlertEmail.recipients.join(", ")}
                </span>
              )}
              {documentUploadAlertEmail.source !== "default" && (
                <Badge
                  className={
                    envLocked
                      ? "bg-amber-500/20 text-amber-300"
                      : isFallback
                        ? "bg-slate-600/40 text-slate-300"
                        : "bg-blue-500/20 text-blue-300"
                  }
                  data-testid="badge-document-upload-alert-email-source"
                >
                  {envLocked
                    ? "Locked by env var"
                    : isFallback
                      ? "Fallback (ADMIN_ALERT_EMAIL)"
                      : "Custom"}
                </Badge>
              )}
            </div>
            {documentUploadAlertEmail.updatedAt && (
              <div className="text-slate-500">
                Stored value last changed{" "}
                {new Date(documentUploadAlertEmail.updatedAt).toLocaleString()}
                {documentUploadAlertEmail.updatedBy
                  ? ` by ${documentUploadAlertEmail.updatedBy}`
                  : ""}
                .
              </div>
            )}
          </div>
        )}

        {envLocked && (
          <p className="text-xs text-amber-300/80">
            The <code>DOCUMENT_UPLOAD_ALERT_EMAIL</code> env var is set, so
            upload alert emails are going to that value. Your saved address is
            kept here and will take effect when the override is removed.
          </p>
        )}

        {isFallback && !envLocked && (
          <p className="text-xs text-slate-400/80">
            No dedicated recipient is configured. Upload alerts are currently
            going to the shared <code>ADMIN_ALERT_EMAIL</code> address. Set a
            recipient above to route them to a dedicated compliance inbox.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function NdaSweepSummaryFrequencyCard() {
  const {
    ndaSweepSummaryFrequency,
    isNdaSweepSummaryFrequencyLoading,
    isNdaSweepSummaryFrequencySaving,
    loadNdaSweepSummaryFrequency,
    saveNdaSweepSummaryFrequency,
  } = useAdminDashboard();

  useEffect(() => {
    loadNdaSweepSummaryFrequency();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const envLocked = ndaSweepSummaryFrequency?.envOverride === true;
  const currentValue = ndaSweepSummaryFrequency?.frequency;

  const optionLabels: Record<string, string> = {
    every: "Every sweep",
    daily: "Daily",
    weekly: "Weekly",
    off: "Off",
  };

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mb-4"
      data-testid="card-nda-sweep-summary-frequency"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <Mail className="h-4 w-4 text-emerald-400" />
          Sealed NDA "all clear" summary cadence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400">
          How often a heartbeat email is sent to the tamper-alert recipient
          confirming that every sealed NDA still hashes correctly. Pick
          "Every sweep" for high-touch monitoring, "Daily" or "Weekly" for
          quieter rollups, or "Off" to rely solely on the per-sweep audit
          row. Changes take effect on the next sweep tick.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="nda-sweep-summary-frequency"
              className="text-xs text-slate-400"
            >
              All clear summary
            </Label>
            <Select
              value={currentValue ?? ""}
              onValueChange={(value) =>
                saveNdaSweepSummaryFrequency(
                  value as "every" | "daily" | "weekly" | "off",
                )
              }
              disabled={
                isNdaSweepSummaryFrequencyLoading ||
                isNdaSweepSummaryFrequencySaving ||
                envLocked ||
                !ndaSweepSummaryFrequency
              }
            >
              <SelectTrigger
                id="nda-sweep-summary-frequency"
                className="w-48 bg-slate-950/60 border-slate-700 text-white"
                data-testid="select-nda-sweep-summary-frequency"
              >
                <SelectValue placeholder="Select cadence" />
              </SelectTrigger>
              <SelectContent>
                {(ndaSweepSummaryFrequency?.options ?? [
                  "every",
                  "daily",
                  "weekly",
                  "off",
                ]).map((opt) => (
                  <SelectItem
                    key={opt}
                    value={opt}
                    data-testid={`option-nda-sweep-summary-frequency-${opt}`}
                  >
                    {optionLabels[opt] ?? opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-slate-500">
            Default:{" "}
            {optionLabels[ndaSweepSummaryFrequency?.default ?? "daily"] ??
              "Daily"}
            .
          </div>
        </div>
        {ndaSweepSummaryFrequency && (
          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span data-testid="text-nda-sweep-summary-frequency-current">
              Currently:{" "}
              <span className="text-slate-200 font-medium">
                {optionLabels[ndaSweepSummaryFrequency.frequency] ??
                  ndaSweepSummaryFrequency.frequency}
              </span>
            </span>
            <span data-testid="text-nda-sweep-summary-frequency-source">
              Source:{" "}
              <span className="text-slate-200 font-medium">
                {ndaSweepSummaryFrequency.source === "env"
                  ? "env override"
                  : ndaSweepSummaryFrequency.source === "db"
                    ? "saved"
                    : "default"}
              </span>
            </span>
            {ndaSweepSummaryFrequency.source !== "default" && (
              <Badge
                className={
                  envLocked
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-slate-700/40 text-slate-300"
                }
                data-testid="badge-nda-sweep-summary-frequency-source"
              >
                {envLocked ? "Locked by env var" : "Custom"}
              </Badge>
            )}
            <span data-testid="text-nda-sweep-summary-last-sent">
              Last summary:{" "}
              <span className="text-slate-200 font-medium">
                {ndaSweepSummaryFrequency.lastSummarySentAt
                  ? new Date(
                      ndaSweepSummaryFrequency.lastSummarySentAt,
                    ).toLocaleString()
                  : "never"}
              </span>
            </span>
            {ndaSweepSummaryFrequency.updatedAt && (
              <span>
                Last changed{" "}
                {new Date(
                  ndaSweepSummaryFrequency.updatedAt,
                ).toLocaleString()}
                {ndaSweepSummaryFrequency.updatedBy
                  ? ` by ${ndaSweepSummaryFrequency.updatedBy}`
                  : ""}
              </span>
            )}
          </div>
        )}
        {envLocked && (
          <p className="text-xs text-amber-300/80">
            The <code>NDA_INTEGRITY_SWEEP_SUMMARY_FREQUENCY</code> env var
            is set, so the sweep is using that value. Saved values are kept
            for when the override is removed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Admin-tunable cooldown for the email-failure alert (Task #152).
// Mirrors the NDA sweep cadence card pattern: env > DB > default with
// an env-lock badge when the override is in force. The dispatcher
// re-reads the value on every failure so changes take effect on the
// next failed send without a redeploy.
function EmailFailureAlertCooldownCard() {
  const {
    emailFailureAlertCooldown,
    isEmailFailureAlertCooldownLoading,
    isEmailFailureAlertCooldownSaving,
    loadEmailFailureAlertCooldown,
    saveEmailFailureAlertCooldown,
  } = useAdminDashboard();

  const [draftMinutes, setDraftMinutes] = useState<string>("");

  useEffect(() => {
    loadEmailFailureAlertCooldown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (emailFailureAlertCooldown && draftMinutes === "") {
      setDraftMinutes(String(emailFailureAlertCooldown.minutes));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailFailureAlertCooldown?.minutes]);

  const min = emailFailureAlertCooldown?.min ?? 1;
  const max = emailFailureAlertCooldown?.max ?? 24 * 60;
  const parsed = Number.parseFloat(draftMinutes);
  const isValid = Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const isDirty =
    !!emailFailureAlertCooldown &&
    isValid &&
    parsed !== emailFailureAlertCooldown.minutes;
  const envLocked = emailFailureAlertCooldown?.envOverride === true;

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mt-4"
      data-testid="card-email-failure-alert-cooldown"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <Mail className="h-4 w-4 text-amber-400" />
          Email-failure alert cooldown
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400">
          Minimum time between push-style alerts when transactional emails
          fail to send. Tighten this (e.g. 15 minutes) for noisy
          environments where ops needs to know quickly; loosen it (e.g.
          240 minutes) when a sustained outage would otherwise spam the
          recipient list. Changes take effect on the next failed send —
          no restart required.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="email-failure-alert-cooldown-minutes"
              className="text-xs text-slate-400"
            >
              Cooldown (minutes)
            </Label>
            <Input
              id="email-failure-alert-cooldown-minutes"
              type="number"
              min={min}
              max={max}
              step={1}
              value={draftMinutes}
              disabled={
                isEmailFailureAlertCooldownLoading ||
                isEmailFailureAlertCooldownSaving ||
                envLocked
              }
              onChange={(e) => setDraftMinutes(e.target.value)}
              className="w-32 bg-slate-950/60 border-slate-700 text-white"
              data-testid="input-email-failure-alert-cooldown-minutes"
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!isValid) return;
              saveEmailFailureAlertCooldown(parsed);
            }}
            disabled={
              !isDirty ||
              isEmailFailureAlertCooldownSaving ||
              isEmailFailureAlertCooldownLoading ||
              envLocked
            }
            data-testid="button-email-failure-alert-cooldown-save"
          >
            {isEmailFailureAlertCooldownSaving ? "Saving…" : "Save"}
          </Button>
          <div className="text-xs text-slate-500">
            Allowed: {min}–{max} minutes. Default:{" "}
            {emailFailureAlertCooldown?.default ?? 60}.
          </div>
        </div>
        {emailFailureAlertCooldown && (
          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span data-testid="text-email-failure-alert-cooldown-current">
              Currently alerting at most every{" "}
              <span className="text-slate-200 font-medium">
                {emailFailureAlertCooldown.minutes} minute(s)
              </span>
            </span>
            {emailFailureAlertCooldown.source !== "default" && (
              <Badge
                className={
                  envLocked
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-slate-700/40 text-slate-300"
                }
                data-testid="badge-email-failure-alert-cooldown-source"
              >
                {envLocked ? "Locked by env var" : "Custom"}
              </Badge>
            )}
            {emailFailureAlertCooldown.lastSentAt && (
              <span>
                Last alert sent{" "}
                {new Date(emailFailureAlertCooldown.lastSentAt).toLocaleString()}
              </span>
            )}
            {emailFailureAlertCooldown.updatedAt && (
              <span>
                Last changed{" "}
                {new Date(emailFailureAlertCooldown.updatedAt).toLocaleString()}
                {emailFailureAlertCooldown.updatedBy
                  ? ` by ${emailFailureAlertCooldown.updatedBy}`
                  : ""}
              </span>
            )}
          </div>
        )}
        {envLocked && (
          <p className="text-xs text-amber-300/80">
            The <code>EMAIL_FAILURE_ALERT_COOLDOWN_MINUTES</code> env var
            is set, so alerts are using that value. Saved values are kept
            for when the override is removed.
          </p>
        )}
        {!isValid && draftMinutes !== "" && (
          <p
            className="text-xs text-red-400"
            data-testid="text-email-failure-alert-cooldown-error"
          >
            Enter a number between {min} and {max}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Per-case document upload alert cooldown (Task #324). Mirrors the
// email-failure cooldown card above; same env > DB > default precedence
// and the dispatcher reads the value at send time so the change takes
// effect on the next upload-triggered alert without a redeploy.
function DocUploadAlertCooldownCard() {
  const {
    docUploadAlertCooldown,
    isDocUploadAlertCooldownLoading,
    isDocUploadAlertCooldownSaving,
    loadDocUploadAlertCooldown,
    saveDocUploadAlertCooldown,
  } = useAdminDashboard();

  const [draftMinutes, setDraftMinutes] = useState<string>("");

  useEffect(() => {
    loadDocUploadAlertCooldown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (docUploadAlertCooldown && draftMinutes === "") {
      setDraftMinutes(String(docUploadAlertCooldown.minutes));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docUploadAlertCooldown?.minutes]);

  const min = docUploadAlertCooldown?.min ?? 1;
  const max = docUploadAlertCooldown?.max ?? 24 * 60;
  const parsed = Number.parseFloat(draftMinutes);
  const isValid = Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const isDirty =
    !!docUploadAlertCooldown &&
    isValid &&
    parsed !== docUploadAlertCooldown.minutes;
  const envLocked = docUploadAlertCooldown?.envOverride === true;

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mt-4"
      data-testid="card-doc-upload-alert-cooldown"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <Mail className="h-4 w-4 text-amber-400" />
          Document upload alert cooldown
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400">
          Minimum time between push-style alerts when a user uploads
          supporting documents to the same case. Tighten this (e.g. 5
          minutes) to be paged sooner during active review; loosen it
          (e.g. 240 minutes) when batch uploads would otherwise spam the
          recipient list. Changes take effect on the next upload — no
          restart required.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="doc-upload-alert-cooldown-minutes"
              className="text-xs text-slate-400"
            >
              Cooldown (minutes)
            </Label>
            <Input
              id="doc-upload-alert-cooldown-minutes"
              type="number"
              min={min}
              max={max}
              step={1}
              value={draftMinutes}
              disabled={
                isDocUploadAlertCooldownLoading ||
                isDocUploadAlertCooldownSaving ||
                envLocked
              }
              onChange={(e) => setDraftMinutes(e.target.value)}
              className="w-32 bg-slate-950/60 border-slate-700 text-white"
              data-testid="input-doc-upload-alert-cooldown-minutes"
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!isValid) return;
              saveDocUploadAlertCooldown(parsed);
            }}
            disabled={
              !isDirty ||
              isDocUploadAlertCooldownSaving ||
              isDocUploadAlertCooldownLoading ||
              envLocked
            }
            data-testid="button-doc-upload-alert-cooldown-save"
          >
            {isDocUploadAlertCooldownSaving ? "Saving…" : "Save"}
          </Button>
          <div className="text-xs text-slate-500">
            Allowed: {min}–{max} minutes. Default:{" "}
            {docUploadAlertCooldown?.default ?? 30}.
          </div>
        </div>
        {docUploadAlertCooldown && (
          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span data-testid="text-doc-upload-alert-cooldown-current">
              Currently alerting at most once per case every{" "}
              <span className="text-slate-200 font-medium">
                {docUploadAlertCooldown.minutes} minute(s)
              </span>
            </span>
            {docUploadAlertCooldown.source !== "default" && (
              <Badge
                className={
                  envLocked
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-slate-700/40 text-slate-300"
                }
                data-testid="badge-doc-upload-alert-cooldown-source"
              >
                {envLocked ? "Locked by env var" : "Custom"}
              </Badge>
            )}
            {docUploadAlertCooldown.updatedAt && (
              <span data-testid="text-doc-upload-alert-cooldown-updated">
                Last changed{" "}
                {new Date(docUploadAlertCooldown.updatedAt).toLocaleString()}
                {docUploadAlertCooldown.updatedBy
                  ? ` by ${docUploadAlertCooldown.updatedBy}`
                  : ""}
              </span>
            )}
          </div>
        )}
        {envLocked && (
          <p className="text-xs text-amber-300/80">
            The <code>DOC_UPLOAD_ALERT_COOLDOWN_MINUTES</code> env var is
            set, so alerts are using that value. Saved values are kept
            for when the override is removed.
          </p>
        )}
        {!isValid && draftMinutes !== "" && (
          <p
            className="text-xs text-red-400"
            data-testid="text-doc-upload-alert-cooldown-error"
          >
            Enter a number between {min} and {max}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Admin editor for custom email templates (Task #247). Stored as a
// JSON array in app_settings.admin_email_templates via the
// /api/admin/settings/email-templates endpoints. Admins create, edit,
// and delete named templates here; they appear in the Quick Templates
// dropdowns in DepositsTab and CasesTab.
interface AdminEmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

function EmailTemplatesCard() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<AdminEmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const token = sessionStorage.getItem("adminToken") ?? "";
      const res = await fetch("/api/admin/settings/email-templates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
      setUpdatedAt(data.updatedAt ?? null);
      setUpdatedBy(data.updatedBy ?? null);
    } catch (e) {
      toast({
        title: "Failed to load email templates",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateTemplate = (idx: number, patch: Partial<AdminEmailTemplate>) => {
    setTemplates((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const addTemplate = () => {
    const newTpl: AdminEmailTemplate = {
      id: `tpl_${Date.now()}`,
      name: "",
      subject: "",
      body: "",
    };
    setTemplates((prev) => [...prev, newTpl]);
    setEditingIdx(templates.length);
  };

  const removeTemplate = (idx: number) => {
    setTemplates((prev) => prev.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
    else if (editingIdx !== null && editingIdx > idx) setEditingIdx(editingIdx - 1);
  };

  const save = async () => {
    const invalid = templates.some((t) => !t.name.trim() || !t.subject.trim() || !t.body.trim());
    if (invalid) {
      toast({
        title: "Missing required fields",
        description: "Every template needs a name, subject, and body.",
        variant: "destructive",
      });
      return;
    }
    const names = templates.map((t) => t.name.trim().toLowerCase());
    const hasDuplicates = names.some((n, i) => names.indexOf(n) !== i);
    if (hasDuplicates) {
      toast({
        title: "Duplicate template names",
        description: "Each template must have a unique name. Please rename any duplicates before saving.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const token = sessionStorage.getItem("adminToken") ?? "";
      const res = await fetch("/api/admin/settings/email-templates", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ templates }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
      setUpdatedAt(data.updatedAt ?? null);
      setUpdatedBy(data.updatedBy ?? null);
      setEditingIdx(null);
      toast({ title: "Email templates saved" });
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mt-6"
      data-testid="card-email-templates"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <Mail className="h-4 w-4 text-amber-400" />
          Custom Email Templates
          {!loading && (
            templates.length > 0 ? (
              <span
                className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-900/40 border border-emerald-700/60 text-emerald-300"
                data-testid="badge-email-templates-configured"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {templates.length} saved
              </span>
            ) : (
              <span
                className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-800/60 border border-slate-700/60 text-slate-400"
                data-testid="badge-email-templates-empty"
              >
                None saved
              </span>
            )
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-400">
          Create named email templates that appear in the "Quick Templates" dropdown
          when composing deposit request emails or bulk emails. Placeholders like{" "}
          <code className="bg-slate-800 px-1 rounded text-amber-300">{"{{name}}"}</code>{" "}
          can be typed into the body freely — they are not interpolated server-side
          and display as-is in the draft so you can personalise before sending.
        </p>
        {loading ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : (
          <div className="space-y-3">
            {templates.length === 0 && (
              <p className="text-xs text-amber-300">
                No templates yet. Add one below to start building your library.
              </p>
            )}
            {templates.map((tpl, idx) => (
              <div
                key={tpl.id}
                className="rounded-md border border-slate-700/60 bg-slate-950/40 overflow-hidden"
                data-testid={`row-email-template-${idx}`}
              >
                <div
                  className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer hover:bg-slate-800/40 transition-colors"
                  onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-slate-200 truncate">
                      {tpl.name || <span className="text-slate-500 italic">Unnamed template</span>}
                    </span>
                    {tpl.subject && (
                      <span className="hidden md:block text-xs text-slate-500 truncate">
                        — {tpl.subject}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setEditingIdx(editingIdx === idx ? null : idx); }}
                      className="text-slate-400 hover:text-amber-300 hover:bg-amber-500/10 h-7 px-2"
                      data-testid={`button-edit-template-${idx}`}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); removeTemplate(idx); }}
                      className="text-rose-400 hover:bg-rose-500/10 h-7 px-2"
                      data-testid={`button-remove-template-${idx}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {editingIdx === idx && (
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-700/60">
                    <div>
                      <Label className="text-xs text-slate-400">
                        Template Name <span className="text-rose-400">*</span>
                      </Label>
                      <Input
                        value={tpl.name}
                        onChange={(e) => updateTemplate(idx, { name: e.target.value })}
                        placeholder="e.g. Activation deposit reminder"
                        className="bg-slate-950/60 border-slate-700 text-white mt-1"
                        data-testid={`input-template-name-${idx}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">
                        Subject <span className="text-rose-400">*</span>
                      </Label>
                      <Input
                        value={tpl.subject}
                        onChange={(e) => updateTemplate(idx, { subject: e.target.value })}
                        placeholder="Email subject line"
                        className="bg-slate-950/60 border-slate-700 text-white mt-1"
                        data-testid={`input-template-subject-${idx}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">
                        Body <span className="text-rose-400">*</span>
                      </Label>
                      <Textarea
                        value={tpl.body}
                        onChange={(e) => updateTemplate(idx, { body: e.target.value })}
                        placeholder="Email body text…"
                        rows={6}
                        className="bg-slate-950/60 border-slate-700 text-white text-xs font-mono mt-1 resize-y"
                        data-testid={`textarea-template-body-${idx}`}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={addTemplate}
                className="border-slate-600"
                data-testid="button-add-email-template"
              >
                <Plus className="h-4 w-4 mr-1" /> Add template
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={saving || loading}
                data-testid="button-save-email-templates"
              >
                {saving ? "Saving…" : "Save templates"}
              </Button>
              {updatedAt && (
                <span className="text-xs text-slate-500">
                  Last changed {new Date(updatedAt).toLocaleString()}
                  {updatedBy ? ` by ${updatedBy}` : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Admin editor for the stamp-duty payment wallets (Task #136). Stored as
// a JSON array in app_settings.stamp_duty_payment_wallets via the
// /api/admin/settings/stamp-duty-wallets endpoints. The portal reads
// the same list and renders every entry on the user's stamp-duty page
// so they can pay in whichever asset is most convenient.
interface AdminStampDutyWallet {
  id: string;
  label: string | null;
  address: string;
  asset: string;
  network: string | null;
  memo: string | null;
}

function StampDutyWalletsCard() {
  const { toast } = useToast();
  const [wallets, setWallets] = useState<AdminStampDutyWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const token = sessionStorage.getItem("adminToken") ?? "";
      const res = await fetch("/api/admin/settings/stamp-duty-wallets", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWallets(Array.isArray(data.wallets) ? data.wallets : []);
      setUpdatedAt(data.updatedAt ?? null);
      setUpdatedBy(data.updatedBy ?? null);
    } catch (e) {
      toast({
        title: "Failed to load stamp duty wallets",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateWallet = (idx: number, patch: Partial<AdminStampDutyWallet>) => {
    setWallets((prev) =>
      prev.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    );
  };

  const addWallet = () => {
    setWallets((prev) => [
      ...prev,
      { id: "", label: null, address: "", asset: "", network: null, memo: null },
    ]);
  };

  const removeWallet = (idx: number) => {
    setWallets((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    const invalid = wallets.some(
      (w) => !w.address.trim() || !w.asset.trim(),
    );
    if (invalid) {
      toast({
        title: "Missing required fields",
        description: "Every wallet needs at least an address and an asset.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const token = sessionStorage.getItem("adminToken") ?? "";
      const res = await fetch("/api/admin/settings/stamp-duty-wallets", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ wallets }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setWallets(Array.isArray(data.wallets) ? data.wallets : []);
      setUpdatedAt(data.updatedAt ?? null);
      setUpdatedBy(data.updatedBy ?? null);
      toast({ title: "Stamp duty wallets saved" });
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      className="bg-slate-900/50 border-slate-800 mt-6"
      data-testid="card-stamp-duty-wallets"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <Key className="h-4 w-4 text-amber-400" />
          Stamp Duty Payment Wallets
          {!loading && (
            wallets.length > 0 ? (
              <span
                className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-900/40 border border-emerald-700/60 text-emerald-300"
                data-testid="badge-stamp-duty-wallets-configured"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {wallets.length} configured
              </span>
            ) : (
              <span
                className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-rose-900/40 border border-rose-700/60 text-rose-300"
                data-testid="badge-stamp-duty-wallets-empty"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                None configured
              </span>
            )
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-400">
          Receiving wallets shown on the user's Stamp Duty page. Add one entry
          per asset/network you want to accept (e.g. BTC, USDT-TRC20, ERC20).
          Users pick whichever is most convenient and upload the receipt.
        </p>
        {loading ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : (
          <div className="space-y-3">
            {wallets.length === 0 && (
              <p className="text-xs text-amber-300">
                No wallets configured. Add one below so users have a deposit
                address.
              </p>
            )}
            {wallets.map((w, idx) => (
              <div
                key={idx}
                className="rounded-md border border-slate-700/60 bg-slate-950/40 p-3 space-y-2"
                data-testid={`row-stamp-duty-wallet-${idx}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-300">
                    Wallet #{idx + 1}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeWallet(idx)}
                    className="text-rose-400 hover:bg-rose-500/10"
                    data-testid={`button-remove-wallet-${idx}`}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Remove
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-slate-400">
                      Asset <span className="text-rose-400">*</span>
                    </Label>
                    <Input
                      value={w.asset}
                      onChange={(e) => updateWallet(idx, { asset: e.target.value })}
                      placeholder="BTC, USDT, ETH…"
                      className="bg-slate-950/60 border-slate-700 text-white"
                      data-testid={`input-wallet-asset-${idx}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Network</Label>
                    <Input
                      value={w.network ?? ""}
                      onChange={(e) =>
                        updateWallet(idx, { network: e.target.value || null })
                      }
                      placeholder="Bitcoin, TRC20, ERC20…"
                      className="bg-slate-950/60 border-slate-700 text-white"
                      data-testid={`input-wallet-network-${idx}`}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-slate-400">
                    Address <span className="text-rose-400">*</span>
                  </Label>
                  <Input
                    value={w.address}
                    onChange={(e) => updateWallet(idx, { address: e.target.value })}
                    placeholder="Receiving wallet address"
                    className="bg-slate-950/60 border-slate-700 text-white font-mono text-xs"
                    data-testid={`input-wallet-address-${idx}`}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-slate-400">
                      Label (optional)
                    </Label>
                    <Input
                      value={w.label ?? ""}
                      onChange={(e) =>
                        updateWallet(idx, { label: e.target.value || null })
                      }
                      placeholder="Display label"
                      className="bg-slate-950/60 border-slate-700 text-white"
                      data-testid={`input-wallet-label-${idx}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">
                      Memo / Tag (optional)
                    </Label>
                    <Input
                      value={w.memo ?? ""}
                      onChange={(e) =>
                        updateWallet(idx, { memo: e.target.value || null })
                      }
                      placeholder="Required by some chains (XRP, XLM…)"
                      className="bg-slate-950/60 border-slate-700 text-white font-mono text-xs"
                      data-testid={`input-wallet-memo-${idx}`}
                    />
                  </div>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={addWallet}
                className="border-slate-600"
                data-testid="button-add-wallet"
              >
                <Plus className="h-4 w-4 mr-1" /> Add wallet
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={saving || loading}
                data-testid="button-save-wallets"
              >
                {saving ? "Saving…" : "Save wallets"}
              </Button>
              {updatedAt && (
                <span className="text-xs text-slate-500">
                  Last changed {new Date(updatedAt).toLocaleString()}
                  {updatedBy ? ` by ${updatedBy}` : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SentryDiagnosticsCard() {
  const triggerClientError = () => {
    const tag = `client-${Date.now()}`;
    setTimeout(() => {
      throw new Error(
        `Sentry verification throw (client) :: ${tag} :: ${new Date().toISOString()}`,
      );
    }, 0);
  };

  const triggerServerError = async () => {
    const tag = `server-${Date.now()}`;
    const token = sessionStorage.getItem("adminToken");
    try {
      await fetch("/api/_debug/throw", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ tag }),
      });
    } catch {
    }
  };

  return (
    <Card className="bg-slate-900/40 border-slate-800 mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-slate-200 text-base">
          <Activity className="h-4 w-4 text-amber-400" />
          Sentry Diagnostics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-slate-500 mb-3">
          Trigger a test error in the client or server to verify Sentry is
          receiving events. Server endpoint requires admin auth and is gated by
          environment.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={triggerClientError}
            className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
            data-testid="button-sentry-throw-client"
          >
            Throw client error
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={triggerServerError}
            className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
            data-testid="button-sentry-throw-server"
          >
            Throw server error
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
