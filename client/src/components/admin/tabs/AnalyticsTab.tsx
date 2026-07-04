import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";
import {
  FileText,
  Users,
  FolderOpen,
  Clock,
  BarChart3,
  TrendingUp,
  Activity,
  CheckCircle,
  User,
  Lock,
  Eye,
  Banknote,
  RotateCcw,
} from "lucide-react";
import { useAdminDashboard } from "../AdminDashboardContext";
import { useEffect, useState } from "react";

interface ViewBucket {
  hourBucket: string;
  views: number;
}

interface ThreadOption {
  id: number;
  title: string;
}

function formatHourBucket(bucket: string): string {
  if (bucket.length !== 10) return bucket;
  const year = parseInt(bucket.slice(0, 4), 10);
  const month = parseInt(bucket.slice(4, 6), 10) - 1;
  const day = parseInt(bucket.slice(6, 8), 10);
  const hour = parseInt(bucket.slice(8, 10), 10);
  const d = new Date(Date.UTC(year, month, day, hour));
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    hour12: true,
    timeZone: "UTC",
  });
}

export function AnalyticsTab() {
  const {
    cases,
    allSubmissions,
    setSealedFilter,
    setActiveTab,
    authToken,
    withdrawalPendingCounts,
    setWithdrawalPendingOnly,
    setRefundClaimStatusFilter,
  } = useAdminDashboard();

  const withdrawalPendingTotal = Object.values(withdrawalPendingCounts).reduce(
    (sum, n) => sum + n,
    0,
  );

  const [viewsData, setViewsData] = useState<ViewBucket[]>([]);
  const [viewsLoading, setViewsLoading] = useState(true);
  const [selectedThreadId, setSelectedThreadId] = useState<string>("all");
  const [selectedHours, setSelectedHours] = useState<string>("48");
  const [threads, setThreads] = useState<ThreadOption[]>([]);
  const totalViewsWindow = viewsData.reduce((sum, r) => sum + r.views, 0);

  useEffect(() => {
    fetch("/api/community/threads?limit=200")
      .then((r) => r.json())
      .then((payload) => {
        if (Array.isArray(payload)) {
          setThreads(
            payload.map((t: { id: number; title: string }) => ({
              id: t.id,
              title: t.title,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!authToken) return;
    setViewsLoading(true);
    const params = new URLSearchParams({ hours: selectedHours });
    if (selectedThreadId !== "all") params.set("threadId", selectedThreadId);
    fetch(`/api/admin/community/views-over-time?${params.toString()}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => r.json())
      .then((payload) => {
        if (Array.isArray(payload.data)) setViewsData(payload.data);
      })
      .catch(() => {})
      .finally(() => setViewsLoading(false));
  }, [authToken, selectedThreadId, selectedHours]);

  const sealedCount = cases.filter((c) => !!c.sealedAt).length;
  const sealedPct = cases.length > 0 ? Math.round((sealedCount / cases.length) * 100) : 0;

  const refundClaimCounts = {
    pending_submission: cases.filter((c) => c.refundClaimStatus === "pending_submission").length,
    submitted: cases.filter((c) => c.refundClaimStatus === "submitted").length,
    approved: cases.filter((c) => c.refundClaimStatus === "approved").length,
    rejected: cases.filter((c) => c.refundClaimStatus === "rejected").length,
  };
  const refundClaimTotal = Object.values(refundClaimCounts).reduce((s, n) => s + n, 0);

  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">Analytics Dashboard</h2>
        <p className="text-slate-400 text-sm">Monitor key metrics, trends, and performance indicators.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 border-blue-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-200 text-sm">Total Cases</p>
                  <p className="text-3xl font-bold text-white">{cases.length}</p>
                </div>
                <div className="h-12 w-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
                  <FileText className="h-6 w-6 text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="bg-gradient-to-br from-green-500/20 to-green-600/10 border-green-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-200 text-sm">Active Users</p>
                  <p className="text-3xl font-bold text-white">{cases.filter(c => c.status === 'active' || c.status === 'completed').length}</p>
                </div>
                <div className="h-12 w-12 bg-green-500/20 rounded-lg flex items-center justify-center">
                  <Users className="h-6 w-6 text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="bg-gradient-to-br from-purple-500/20 to-purple-600/10 border-purple-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-purple-200 text-sm">Total Submissions</p>
                  <p className="text-3xl font-bold text-white">{allSubmissions.length}</p>
                </div>
                <div className="h-12 w-12 bg-purple-500/20 rounded-lg flex items-center justify-center">
                  <FolderOpen className="h-6 w-6 text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="bg-gradient-to-br from-amber-500/20 to-amber-600/10 border-amber-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-amber-200 text-sm">Pending Actions</p>
                  <p className="text-3xl font-bold text-white">{cases.filter(c => c.status === 'syncing').length}</p>
                </div>
                <div className="h-12 w-12 bg-amber-500/20 rounded-lg flex items-center justify-center">
                  <Clock className="h-6 w-6 text-amber-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <button
            type="button"
            onClick={() => {
              setSealedFilter("sealed");
              setActiveTab("cases");
            }}
            className="text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 rounded-lg"
            title="View sealed cases"
            data-testid="button-sealed-kpi"
          >
            <Card
              className="bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 border-yellow-500/30 cursor-pointer hover:from-yellow-500/30 hover:to-yellow-600/20 hover:border-yellow-500/50 transition-colors"
              data-testid="card-sealed-kpi"
            >
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-yellow-200 text-sm">Sealed Cases</p>
                    <p className="text-3xl font-bold text-white" data-testid="text-sealed-count">{sealedCount}</p>
                    <p className="text-yellow-300/80 text-xs mt-1" data-testid="text-sealed-percent">
                      {sealedPct}% of {cases.length} total
                    </p>
                  </div>
                  <div className="h-12 w-12 bg-yellow-500/20 rounded-lg flex items-center justify-center">
                    <Lock className="h-6 w-6 text-yellow-400" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
          <button
            type="button"
            onClick={() => {
              setWithdrawalPendingOnly(true);
              setActiveTab("cases");
            }}
            className="text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 rounded-lg"
            title="View cases with pending withdrawal requests"
            data-testid="button-withdrawal-pending-kpi"
          >
            <Card
              className="bg-gradient-to-br from-rose-500/20 to-rose-600/10 border-rose-500/30 cursor-pointer hover:from-rose-500/30 hover:to-rose-600/20 hover:border-rose-500/50 transition-colors"
              data-testid="card-withdrawal-pending-kpi"
            >
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-rose-200 text-sm">Pending Withdrawals</p>
                    <p className="text-3xl font-bold text-white" data-testid="text-withdrawal-pending-count">{withdrawalPendingTotal}</p>
                    <p className="text-rose-300/80 text-xs mt-1">
                      {withdrawalPendingTotal === 0 ? "No requests awaiting review" : "Awaiting review"}
                    </p>
                  </div>
                  <div className="h-12 w-12 bg-rose-500/20 rounded-lg flex items-center justify-center">
                    <Banknote className="h-6 w-6 text-rose-400" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>
        </motion.div>
      </div>

      {/* Refund Claims Summary Card — full-width row, visible whenever at least
          one refund claim exists so the chrome stays quiet otherwise. Clicking
          the "Submitted" sub-count drills through to the Cases tab pre-filtered
          to submitted claims awaiting admin review. */}
      {refundClaimTotal > 0 && (
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
        >
          <Card className="bg-gradient-to-br from-violet-500/20 to-violet-600/10 border-violet-500/30" data-testid="card-refund-claims-kpi">
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-12 w-12 flex-shrink-0 bg-violet-500/20 rounded-lg flex items-center justify-center">
                    <RotateCcw className="h-6 w-6 text-violet-400" />
                  </div>
                  <div>
                    <p className="text-violet-200 text-sm font-medium">Refund Claims</p>
                    <p className="text-3xl font-bold text-white" data-testid="text-refund-claims-total">{refundClaimTotal}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  {refundClaimCounts.pending_submission > 0 && (
                    <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50">
                      <span className="text-slate-300 text-xs mb-1">Pending Submission</span>
                      <span className="text-white font-bold text-lg" data-testid="text-refund-pending-submission">{refundClaimCounts.pending_submission}</span>
                    </div>
                  )}
                  {refundClaimCounts.submitted > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setRefundClaimStatusFilter("submitted");
                        setActiveTab("cases");
                      }}
                      className="flex flex-col items-center px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                      title="View submitted refund claims awaiting review"
                      data-testid="button-refund-submitted-kpi"
                    >
                      <span className="text-amber-300 text-xs mb-1">Submitted</span>
                      <span className="text-white font-bold text-lg" data-testid="text-refund-submitted">{refundClaimCounts.submitted}</span>
                    </button>
                  )}
                  {refundClaimCounts.approved > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setRefundClaimStatusFilter("approved");
                        setActiveTab("cases");
                      }}
                      className="flex flex-col items-center px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/30 hover:bg-green-500/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
                      title="View approved refund claims"
                      data-testid="button-refund-approved-kpi"
                    >
                      <span className="text-green-300 text-xs mb-1">Approved</span>
                      <span className="text-white font-bold text-lg" data-testid="text-refund-approved">{refundClaimCounts.approved}</span>
                    </button>
                  )}
                  {refundClaimCounts.rejected > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setRefundClaimStatusFilter("rejected");
                        setActiveTab("cases");
                      }}
                      className="flex flex-col items-center px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      title="View rejected refund claims"
                      data-testid="button-refund-rejected-kpi"
                    >
                      <span className="text-red-300 text-xs mb-1">Rejected</span>
                      <span className="text-white font-bold text-lg" data-testid="text-refund-rejected">{refundClaimCounts.rejected}</span>
                    </button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Case Status Distribution */}
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}>
          <Card className="bg-slate-950 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-400" />
                Case Status Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Created', value: cases.filter(c => c.status === 'created').length, color: '#64748b' },
                        { name: 'Syncing', value: cases.filter(c => c.status === 'syncing').length, color: '#f59e0b' },
                        { name: 'Active', value: cases.filter(c => c.status === 'active').length, color: '#22c55e' },
                        { name: 'Completed', value: cases.filter(c => c.status === 'completed').length, color: '#3b82f6' },
                      ].filter(d => d.value > 0)}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {[
                        { name: 'Created', value: cases.filter(c => c.status === 'created').length, color: '#64748b' },
                        { name: 'Syncing', value: cases.filter(c => c.status === 'syncing').length, color: '#f59e0b' },
                        { name: 'Active', value: cases.filter(c => c.status === 'active').length, color: '#22c55e' },
                        { name: 'Completed', value: cases.filter(c => c.status === 'completed').length, color: '#3b82f6' },
                      ].filter(d => d.value > 0).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: 'rgba(2,9,18,0.92)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
                      labelStyle={{ color: '#fff', fontWeight: 600 }}
                      itemStyle={{ color: '#cbd5e1' }}
                    />
                    <Legend
                      wrapperStyle={{ color: '#94a3b8' }}
                      formatter={(value) => <span style={{ color: '#cbd5e1' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Submission Options Breakdown */}
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
          <Card className="bg-slate-950 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-400" />
                Submission Options Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: 'Option A', count: allSubmissions.filter(s => s.selectedOption === 'A').length, fill: 'url(#barGradientBlue)' },
                      { name: 'Option B', count: allSubmissions.filter(s => s.selectedOption === 'B').length, fill: 'url(#barGradientPurple)' },
                    ]}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <defs>
                      <linearGradient id="barGradientBlue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#1e40af" stopOpacity={0.85} />
                      </linearGradient>
                      <linearGradient id="barGradientPurple" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#5b21b6" stopOpacity={0.85} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 12 }} axisLine={{ stroke: 'rgba(148,163,184,0.18)' }} />
                    <YAxis stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 12 }} axisLine={{ stroke: 'rgba(148,163,184,0.18)' }} />
                    <Tooltip
                      cursor={{ fill: 'rgba(96,165,250,0.08)' }}
                      contentStyle={{ backgroundColor: 'rgba(2,9,18,0.92)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
                      labelStyle={{ color: '#fff', fontWeight: 600 }}
                      itemStyle={{ color: '#cbd5e1' }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {[
                        { name: 'Option A', count: allSubmissions.filter(s => s.selectedOption === 'A').length, fill: 'url(#barGradientBlue)' },
                        { name: 'Option B', count: allSubmissions.filter(s => s.selectedOption === 'B').length, fill: 'url(#barGradientPurple)' },
                      ].map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Activity Timeline */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
        <Card className="bg-slate-950 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Activity className="h-5 w-5 text-purple-400" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {cases.slice(0, 5).map((c, index) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 * index }}
                  className="flex items-center gap-4 p-3 bg-slate-900/50 rounded-lg border border-slate-800"
                >
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                    c.status === 'completed' ? 'bg-blue-500/20' :
                    c.status === 'active' ? 'bg-green-500/20' :
                    c.status === 'syncing' ? 'bg-amber-500/20' : 'bg-slate-500/20'
                  }`}>
                    {c.status === 'completed' ? <CheckCircle className="h-5 w-5 text-blue-400" /> :
                     c.status === 'active' ? <User className="h-5 w-5 text-green-400" /> :
                     c.status === 'syncing' ? <Clock className="h-5 w-5 text-amber-400" /> :
                     <FileText className="h-5 w-5 text-slate-400" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-medium">{c.userName || `Case ${c.accessCode}`}</p>
                    <p className="text-slate-400 text-sm">
                      Status: <span className={`font-medium ${
                        c.status === 'completed' ? 'text-blue-400' :
                        c.status === 'active' ? 'text-green-400' :
                        c.status === 'syncing' ? 'text-amber-400' : 'text-slate-300'
                      }`}>{c.status}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-500 text-xs">
                      {new Date(c.updatedAt || c.createdAt).toLocaleDateString()}
                    </p>
                    <p className="text-slate-600 text-xs">
                      {new Date(c.updatedAt || c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </motion.div>
              ))}
              {cases.length === 0 && (
                <div className="text-center py-8 text-slate-500">
                  <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No recent activity</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Community Thread Views — configurable time window */}
      <motion.div
        className="mt-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
      >
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-cyan-400" />
                <CardTitle className="text-white text-lg" data-testid="views-chart-title">
                  Community Thread Views ({selectedHours} h)
                </CardTitle>
              </div>
              <div className="flex items-center gap-3">
                {!viewsLoading && viewsData.length > 0 && (
                  <span
                    className="text-slate-400 text-sm"
                    data-testid="views-total-counter"
                  >
                    {totalViewsWindow.toLocaleString()} total views
                  </span>
                )}
                <Select
                  value={selectedHours}
                  onValueChange={(val) => {
                    setSelectedHours(val);
                    setViewsData([]);
                  }}
                >
                  <SelectTrigger
                    className="w-24 bg-slate-900 border-slate-700 text-slate-200 text-sm focus:ring-cyan-500"
                    data-testid="hours-filter-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                    <SelectItem value="6" className="focus:bg-slate-800 focus:text-white">6 h</SelectItem>
                    <SelectItem value="12" className="focus:bg-slate-800 focus:text-white">12 h</SelectItem>
                    <SelectItem value="24" className="focus:bg-slate-800 focus:text-white">24 h</SelectItem>
                    <SelectItem value="48" className="focus:bg-slate-800 focus:text-white">48 h</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={selectedThreadId}
                  onValueChange={(val) => {
                    setSelectedThreadId(val);
                    setViewsData([]);
                  }}
                >
                  <SelectTrigger
                    className="w-56 bg-slate-900 border-slate-700 text-slate-200 text-sm focus:ring-cyan-500"
                    data-testid="thread-filter-select"
                  >
                    <SelectValue placeholder="All threads" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200 max-h-72 overflow-y-auto">
                    <SelectItem value="all" className="focus:bg-slate-800 focus:text-white">
                      All threads
                    </SelectItem>
                    {threads.map((t) => (
                      <SelectItem
                        key={t.id}
                        value={String(t.id)}
                        className="focus:bg-slate-800 focus:text-white"
                      >
                        {t.title.length > 48 ? `${t.title.slice(0, 48)}…` : t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {viewsLoading ? (
              <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
                Loading…
              </div>
            ) : viewsData.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-500">
                <Eye className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">No thread views recorded in the last {selectedHours} hours.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={viewsData.map((r) => ({
                    label: formatHourBucket(r.hourBucket),
                    views: r.views,
                  }))}
                  margin={{ top: 6, right: 16, left: 0, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    angle={-45}
                    textAnchor="end"
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    allowDecimals={false}
                    width={36}
                  />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                    labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
                    itemStyle={{ color: "#22d3ee" }}
                    formatter={(value: number) => [value, "Views"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="views"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={{ fill: "#22d3ee", r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </>
  );
}
