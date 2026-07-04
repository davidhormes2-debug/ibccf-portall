import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Users, FolderOpen, Clock, CheckCircle, User, Activity, BarChart3, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAdmin } from "./AdminContext";

export function Analytics() {
  const { cases, allSubmissions } = useAdmin();
  const { t } = useTranslation("admin");

  const statusCounts = {
    created: cases.filter(c => c.status === 'created').length,
    syncing: cases.filter(c => c.status === 'syncing').length,
    active: cases.filter(c => c.status === 'active').length,
    completed: cases.filter(c => c.status === 'completed').length,
  };

  const pieData = [
    { name: t("analytics.statusCreated"), value: statusCounts.created, color: '#64748b' },
    { name: t("analytics.statusSyncing"), value: statusCounts.syncing, color: '#f59e0b' },
    { name: t("analytics.statusActive"), value: statusCounts.active, color: '#22c55e' },
    { name: t("analytics.statusCompleted"), value: statusCounts.completed, color: '#3b82f6' },
  ].filter(d => d.value > 0);

  const submissionData = [
    { name: t("analytics.optionA"), count: allSubmissions.filter(s => s.selectedOption === 'A').length, fill: '#3b82f6' },
    { name: t("analytics.optionB"), count: allSubmissions.filter(s => s.selectedOption === 'B').length, fill: '#8b5cf6' },
  ];

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">{t("analytics.heading")}</h2>
        <p className="text-slate-400 text-sm">{t("analytics.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 border-blue-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-200 text-sm">{t("analytics.totalCases")}</p>
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
                  <p className="text-green-200 text-sm">{t("analytics.activeUsers")}</p>
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
                  <p className="text-purple-200 text-sm">{t("analytics.totalSubmissions")}</p>
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
                  <p className="text-amber-200 text-sm">{t("analytics.pendingActions")}</p>
                  <p className="text-3xl font-bold text-white">{cases.filter(c => c.status === 'syncing').length}</p>
                </div>
                <div className="h-12 w-12 bg-amber-500/20 rounded-lg flex items-center justify-center">
                  <Clock className="h-6 w-6 text-amber-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}>
          <Card className="bg-slate-950 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-400" />
                {t("analytics.statusDistribution")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                      labelStyle={{ color: '#fff' }}
                    />
                    <Legend 
                      wrapperStyle={{ color: '#94a3b8' }}
                      formatter={(value) => <span style={{ color: '#94a3b8' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
          <Card className="bg-slate-950 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-400" />
                {t("analytics.submissionBreakdown")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={submissionData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                      labelStyle={{ color: '#fff' }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {submissionData.map((entry, index) => (
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

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
        <Card className="bg-slate-950 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Activity className="h-5 w-5 text-purple-400" />
              {t("analytics.recentActivity")}
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
                      {t("analytics.statusLabel")}: <span className={`font-medium ${
                        c.status === 'completed' ? 'text-blue-400' :
                        c.status === 'active' ? 'text-green-400' :
                        c.status === 'syncing' ? 'text-amber-400' : 'text-slate-300'
                      }`}>{t(`status.${c.status}`, { defaultValue: c.status })}</span>
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
                  <p>{t("analytics.noActivity")}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

export default Analytics;
