import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Brain, Sparkles, TrendingUp, AlertCircle, CheckCircle2, 
  Clock, Shield, Zap, ArrowRight, LightbulbIcon
} from "lucide-react";
import { useState, useEffect } from "react";

interface AIInsight {
  type: 'progress' | 'action' | 'tip' | 'alert';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
}

interface AIInsightsCardProps {
  caseStatus?: string;
  withdrawalStage?: string;
  hasRequirements?: boolean;
  submissionsCount?: number;
  messagesCount?: number;
}

export function AIInsightsCard({ 
  caseStatus, 
  withdrawalStage, 
  hasRequirements, 
  submissionsCount = 0,
  messagesCount = 0 
}: AIInsightsCardProps) {
  const [currentInsight, setCurrentInsight] = useState(0);
  const [isThinking, setIsThinking] = useState(true);

  const generateInsights = (): AIInsight[] => {
    const insights: AIInsight[] = [];
    const stage = parseInt(withdrawalStage || '1');

    if (hasRequirements) {
      insights.push({
        type: 'alert',
        title: 'Action Required',
        description: 'You have pending requirements from the compliance team. Complete them to continue processing.',
        priority: 'high'
      });
    }

    if (stage >= 3 && stage < 7) {
      insights.push({
        type: 'progress',
        title: 'Good Progress',
        description: `Your case is at stage ${stage} of 14. You're making great progress toward resolution.`,
        priority: 'medium'
      });
    }

    if (submissionsCount === 0) {
      insights.push({
        type: 'action',
        title: 'Complete Your Submission',
        description: 'Review and submit your withdrawal letter to proceed with your case.',
        priority: 'medium'
      });
    }

    insights.push({
      type: 'tip',
      title: 'Pro Tip',
      description: 'Keep your documents organized and respond promptly to requests for faster processing.',
      priority: 'low'
    });

    if (stage >= 5) {
      insights.push({
        type: 'progress',
        title: 'Nearing Completion',
        description: 'Your case is in advanced stages. Most cases at this point are resolved within 2 weeks.',
        priority: 'medium'
      });
    }

    return insights;
  };

  const insights = generateInsights();

  useEffect(() => {
    setIsThinking(true);
    const timer = setTimeout(() => setIsThinking(false), 1500);
    return () => clearTimeout(timer);
  }, [caseStatus, withdrawalStage]);

  useEffect(() => {
    if (insights.length > 1) {
      const interval = setInterval(() => {
        setCurrentInsight(prev => (prev + 1) % insights.length);
      }, 8000);
      return () => clearInterval(interval);
    }
  }, [insights.length]);

  const getInsightIcon = (type: AIInsight['type']) => {
    switch (type) {
      case 'progress': return TrendingUp;
      case 'action': return Zap;
      case 'tip': return LightbulbIcon;
      case 'alert': return AlertCircle;
      default: return Sparkles;
    }
  };

  const getInsightColor = (type: AIInsight['type']) => {
    switch (type) {
      case 'progress': return 'from-emerald-500 to-green-500';
      case 'action': return 'from-blue-500 to-cyan-500';
      case 'tip': return 'from-amber-500 to-orange-500';
      case 'alert': return 'from-red-500 to-rose-500';
      default: return 'from-purple-500 to-violet-500';
    }
  };

  const insight = insights[currentInsight];
  const InsightIcon = getInsightIcon(insight?.type || 'tip');

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      transition={{ delay: 0.3 }}
    >
      <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <Brain className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm font-semibold">AI Insights</span>
              {isThinking && (
                <motion.div 
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="flex items-center gap-1"
                >
                  <span className="text-xs text-blue-300">Analyzing</span>
                  <Sparkles className="w-3 h-3 text-blue-300" />
                </motion.div>
              )}
            </div>
            {insights.length > 1 && (
              <div className="flex gap-1">
                {insights.map((_, idx) => (
                  <motion.div
                    key={idx}
                    className={`w-2 h-2 rounded-full ${idx === currentInsight ? 'bg-blue-400' : 'bg-white/20'}`}
                    animate={{ scale: idx === currentInsight ? [1, 1.2, 1] : 1 }}
                    transition={{ duration: 0.5 }}
                  />
                ))}
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <motion.div
            key={currentInsight}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {insight && (
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getInsightColor(insight.type)} flex items-center justify-center flex-shrink-0 shadow-lg`}>
                  <InsightIcon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-white text-sm">{insight.title}</h4>
                    <Badge 
                      variant="outline" 
                      className={`text-xs border-0 ${
                        insight.priority === 'high' ? 'bg-red-500/20 text-red-300' :
                        insight.priority === 'medium' ? 'bg-blue-500/20 text-blue-300' :
                        'bg-slate-500/20 text-slate-300'
                      }`}
                    >
                      {insight.priority}
                    </Badge>
                  </div>
                  <p className="text-white/70 text-xs leading-relaxed">{insight.description}</p>
                </div>
              </div>
            )}
          </motion.div>
          
          <div className="mt-4 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/50">Powered by AI Analysis</span>
              <div className="flex items-center gap-1 text-emerald-400">
                <Shield className="w-3 h-3" />
                <span>Secure</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function QuickStatsCard({ 
  stage, 
  messagesCount, 
  submissionsCount, 
  receiptsCount 
}: {
  stage: number;
  messagesCount: number;
  submissionsCount: number;
  receiptsCount: number;
}) {
  const progressPercent = Math.round((Math.max(0, stage - 1) / 14) * 100);
  
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }} 
      animate={{ opacity: 1, scale: 1 }} 
      transition={{ delay: 0.2 }}
      className="grid grid-cols-2 sm:grid-cols-4 gap-3"
    >
      {[
        { label: 'Progress', value: `${progressPercent}%`, icon: TrendingUp, color: 'from-blue-500 to-cyan-500' },
        { label: 'Messages', value: messagesCount.toString(), icon: CheckCircle2, color: 'from-emerald-500 to-green-500' },
        { label: 'Submissions', value: submissionsCount.toString(), icon: Clock, color: 'from-purple-500 to-violet-500' },
        { label: 'Documents', value: receiptsCount.toString(), icon: Shield, color: 'from-amber-500 to-orange-500' }
      ].map((stat, idx) => (
        <motion.div
          key={stat.label}
          whileHover={{ scale: 1.02, y: -2 }}
          className="glass-card rounded-xl p-4 text-center"
        >
          <div className={`w-10 h-10 mx-auto mb-2 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center shadow-lg`}>
            <stat.icon className="w-5 h-5 text-white" />
          </div>
          <div className="text-2xl font-bold text-slate-800 dark:text-white">{stat.value}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</div>
        </motion.div>
      ))}
    </motion.div>
  );
}

export function CaseProgressRing({ stage, totalStages = 14 }: { stage: number; totalStages?: number }) {
  const progressPercent = Math.round(((stage - 1) / totalStages) * 100);
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative w-32 h-32"
    >
      <svg className="w-full h-full transform -rotate-90">
        <circle
          cx="64"
          cy="64"
          r="45"
          stroke="currentColor"
          strokeWidth="8"
          fill="none"
          className="text-slate-200 dark:text-slate-700"
        />
        <motion.circle
          cx="64"
          cy="64"
          r="45"
          stroke="url(#progressGradient)"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          style={{ strokeDasharray: circumference }}
        />
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span 
          className="text-2xl font-bold text-slate-800 dark:text-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {progressPercent}%
        </motion.span>
        <span className="text-xs text-slate-500 dark:text-slate-400">Complete</span>
      </div>
    </motion.div>
  );
}
