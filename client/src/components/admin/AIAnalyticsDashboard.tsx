import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Brain, Sparkles, TrendingUp, AlertCircle, CheckCircle2, 
  Clock, Shield, Zap, ArrowRight, RefreshCw, BarChart3,
  Target, AlertTriangle, LineChart, Activity, Lightbulb
} from "lucide-react";

interface AIInsights {
  trends: string[];
  alerts: string[];
  performanceMetrics: {
    avgResolutionTime: string;
    successRate: string;
    activeHighPriority: number;
  };
  predictions: string[];
}

interface CaseAnalysis {
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  fraudPatterns: string[];
  recommendations: string[];
  estimatedRecoveryChance: number;
  priorityActions: string[];
  similarCasesInsight: string;
  nextSteps: string[];
}

interface AIAnalyticsDashboardProps {
  authToken: string;
}

export function AIAnalyticsDashboard({ authToken }: AIAnalyticsDashboardProps) {
  const [insights, setInsights] = useState<AIInsights | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchInsights = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/api/ai/insights', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setInsights(data);
      }
    } catch (error) {
      console.error('Failed to fetch AI insights:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchInsights();
    const interval = setInterval(fetchInsights, 300000);
    return () => clearInterval(interval);
  }, [authToken]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map(i => (
          <Card key={i} className="overflow-hidden">
            <CardContent className="p-4">
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 mb-6"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center shadow-lg">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">AI Command Center</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Real-time insights and predictions</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchInsights}
          disabled={isRefreshing}
          className="flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={Clock}
          label="Avg Resolution"
          value={insights?.performanceMetrics.avgResolutionTime || "N/A"}
          color="blue"
          trend="+5% faster"
        />
        <MetricCard
          icon={Target}
          label="Success Rate"
          value={insights?.performanceMetrics.successRate || "N/A"}
          color="green"
          trend="Stable"
        />
        <MetricCard
          icon={AlertTriangle}
          label="High Priority"
          value={insights?.performanceMetrics.activeHighPriority?.toString() || "0"}
          color="amber"
          trend="Active cases"
        />
        <MetricCard
          icon={Activity}
          label="AI Confidence"
          value="94%"
          color="purple"
          trend="High accuracy"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <InsightsCard
          title="Trends"
          icon={TrendingUp}
          items={insights?.trends || []}
          color="blue"
        />
        <InsightsCard
          title="Alerts"
          icon={AlertCircle}
          items={insights?.alerts || []}
          color="red"
        />
        <InsightsCard
          title="Predictions"
          icon={Lightbulb}
          items={insights?.predictions || []}
          color="purple"
        />
      </div>
    </motion.div>
  );
}

function MetricCard({ 
  icon: Icon, 
  label, 
  value, 
  color, 
  trend 
}: { 
  icon: any; 
  label: string; 
  value: string; 
  color: string; 
  trend: string;
}) {
  const colorClasses = {
    blue: 'from-blue-500 to-cyan-500',
    green: 'from-emerald-500 to-green-500',
    amber: 'from-amber-500 to-orange-500',
    purple: 'from-purple-500 to-pink-500',
    red: 'from-red-500 to-rose-500',
  };

  return (
    <motion.div whileHover={{ y: -2, scale: 1.02 }} transition={{ type: "spring", stiffness: 300 }}>
      <Card className="overflow-hidden border-0 shadow-lg bg-white dark:bg-slate-800">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colorClasses[color as keyof typeof colorClasses]} flex items-center justify-center shadow-lg`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
            <Badge variant="outline" className="text-xs bg-slate-100 dark:bg-slate-700 border-0">
              {trend}
            </Badge>
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function InsightsCard({ 
  title, 
  icon: Icon, 
  items, 
  color 
}: { 
  title: string; 
  icon: any; 
  items: string[]; 
  color: string;
}) {
  const colorClasses = {
    blue: 'from-blue-500 to-cyan-500 text-blue-500',
    green: 'from-emerald-500 to-green-500 text-emerald-500',
    red: 'from-red-500 to-rose-500 text-red-500',
    purple: 'from-purple-500 to-pink-500 text-purple-500',
  };

  return (
    <Card className="overflow-hidden border-0 shadow-lg bg-white dark:bg-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${colorClasses[color as keyof typeof colorClasses].split(' ')[0]} ${colorClasses[color as keyof typeof colorClasses].split(' ')[1]} flex items-center justify-center`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length > 0 ? (
          <ul className="space-y-2">
            {items.map((item, idx) => (
              <motion.li
                key={idx}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300"
              >
                <Sparkles className={`w-4 h-4 mt-0.5 flex-shrink-0 ${colorClasses[color as keyof typeof colorClasses].split(' ')[2]}`} />
                <span>{item}</span>
              </motion.li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400 italic">No data available</p>
        )}
      </CardContent>
    </Card>
  );
}

interface CaseAIAnalysisProps {
  caseId: string;
  authToken: string;
  onClose?: () => void;
}

export function CaseAIAnalysisPanel({ caseId, authToken, onClose }: CaseAIAnalysisProps) {
  const [analysis, setAnalysis] = useState<CaseAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAnalysis = async () => {
      try {
        const res = await fetch('/api/ai/analyze-case', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ caseId })
        });
        if (res.ok) {
          const data = await res.json();
          setAnalysis(data);
        }
      } catch (error) {
        console.error('Failed to fetch case analysis:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAnalysis();
  }, [caseId, authToken]);

  if (isLoading) {
    return (
      <Card className="overflow-hidden border-2 border-purple-200 dark:border-purple-900">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
            >
              <Brain className="w-6 h-6 text-purple-500" />
            </motion.div>
            <span className="text-purple-600 dark:text-purple-400 font-medium">Analyzing case with AI...</span>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!analysis) {
    return (
      <Card className="overflow-hidden border-2 border-slate-200">
        <CardContent className="p-6 text-center text-slate-500">
          Unable to generate analysis
        </CardContent>
      </Card>
    );
  }

  const riskColors = {
    low: 'from-green-500 to-emerald-500 bg-green-100 text-green-700',
    medium: 'from-amber-500 to-orange-500 bg-amber-100 text-amber-700',
    high: 'from-red-500 to-rose-500 bg-red-100 text-red-700',
    critical: 'from-purple-500 to-pink-500 bg-purple-100 text-purple-700'
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <Card className="overflow-hidden border-2 border-purple-200 dark:border-purple-900">
        <CardHeader className="bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-base">
              <Brain className="w-5 h-5" />
              AI Case Analysis
            </div>
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose} className="text-white hover:bg-white/20">
                Close
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 bg-slate-50 dark:bg-slate-800 rounded-xl">
              <div className="text-3xl font-bold text-purple-600">{analysis.riskScore}</div>
              <div className="text-xs text-slate-500">Risk Score</div>
              <Badge className={`mt-2 ${riskColors[analysis.riskLevel].split(' ').slice(2).join(' ')}`}>
                {analysis.riskLevel.toUpperCase()}
              </Badge>
            </div>
            <div className="text-center p-4 bg-slate-50 dark:bg-slate-800 rounded-xl">
              <div className="text-3xl font-bold text-emerald-600">{analysis.estimatedRecoveryChance}%</div>
              <div className="text-xs text-slate-500">Recovery Chance</div>
              <Badge variant="outline" className="mt-2 bg-emerald-100 text-emerald-700 border-0">
                Estimated
              </Badge>
            </div>
          </div>

          {analysis.priorityActions.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                Priority Actions
              </h4>
              <ul className="space-y-1">
                {analysis.priorityActions.map((action, idx) => (
                  <li key={idx} className="text-sm text-slate-600 dark:text-slate-300 flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.fraudPatterns.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500" />
                Detected Patterns
              </h4>
              <div className="flex flex-wrap gap-2">
                {analysis.fraudPatterns.map((pattern, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs bg-red-50 text-red-600 border-red-200">
                    {pattern}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {analysis.recommendations.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-blue-500" />
                Recommendations
              </h4>
              <ul className="space-y-1">
                {analysis.recommendations.map((rec, idx) => (
                  <li key={idx} className="text-sm text-slate-600 dark:text-slate-300 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.similarCasesInsight && (
            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <h4 className="font-semibold text-sm mb-1 text-purple-700 dark:text-purple-300">Similar Cases Insight</h4>
              <p className="text-sm text-purple-600 dark:text-purple-400">{analysis.similarCasesInsight}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface AutoResponseGeneratorProps {
  authToken: string;
  userName?: string;
  onResponseGenerated: (response: string) => void;
}

export function AutoResponseGenerator({ authToken, userName, onResponseGenerated }: AutoResponseGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const messageTypes = [
    { type: 'welcome', label: 'Welcome', icon: Sparkles, color: 'blue' },
    { type: 'stage_update', label: 'Stage Update', icon: TrendingUp, color: 'green' },
    { type: 'document_request', label: 'Doc Request', icon: AlertCircle, color: 'amber' },
    { type: 'followup', label: 'Follow-up', icon: Clock, color: 'purple' },
    { type: 'resolution', label: 'Resolution', icon: CheckCircle2, color: 'emerald' },
  ];

  const generateResponse = async (type: string) => {
    setSelectedType(type);
    setIsGenerating(true);
    try {
      const res = await fetch('/api/ai/auto-response', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ messageType: type, userName })
      });
      if (res.ok) {
        const data = await res.json();
        onResponseGenerated(data.response);
      }
    } catch (error) {
      console.error('Failed to generate response:', error);
    } finally {
      setIsGenerating(false);
      setSelectedType(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
        <Brain className="w-3 h-3" />
        AI Quick Responses
      </div>
      <div className="flex flex-wrap gap-2">
        {messageTypes.map(({ type, label, icon: Icon, color }) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            onClick={() => generateResponse(type)}
            disabled={isGenerating}
            className="text-xs h-7 px-2"
          >
            {isGenerating && selectedType === type ? (
              <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Icon className="w-3 h-3 mr-1" />
            )}
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
