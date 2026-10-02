import { motion } from "framer-motion";
import { TrendingUp, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CANONICAL_CASE_WORKFLOW,
  toCanonicalCaseStage,
} from "@shared/canonicalWorkflow";

interface WithdrawalStep {
  id: number;
  label: string;
  icon: string;
  description: string;
}

const DEFAULT_STAGES: WithdrawalStage[] = CANONICAL_CASE_WORKFLOW.map((step) => ({
  id: step.id,
  label: step.label,
  icon: step.icon,
  description: step.description,
}));

interface WithdrawalProgressTrackerProps {
  currentStage: number;
  phraseKeyMergeDeposit?: string | null;
  activityWalletRequirement?: string | null;
  stages?: WithdrawalStage[];
}

export function WithdrawalProgressTracker({
  currentStage,
  phraseKeyMergeDeposit,
  activityWalletRequirement,
  stages = DEFAULT_STAGES,
}: WithdrawalProgressTrackerProps) {
  const totalStages = stages.length;
  const safeCurrentStep = toCanonicalCaseStage(currentStage);
  const progressPercent = Math.round((safeCurrentStep / totalStages) * 100);
  const currentStageData = stages.find(s => s.id === safeCurrentStage);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }}
      className="mb-8"
    >
      <Card className="border-2 border-blue-200 shadow-lg overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 text-white">
          <CardTitle className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <span className="text-lg font-bold">Case Workflow</span>
              <p className="text-blue-200 text-sm font-normal">Real-time status of your case</p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 pb-8 px-0">
          <div className="space-y-6">
            <ProgressBar progressPercent={progressPercent} />
            <StagesStepper 
              stages={stages} 
              currentStage={safeCurrentStage} 
            />
            {currentStageData && (
              <CurrentStageCard stage={currentStageData} />
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ProgressBar({ progressPercent }: { progressPercent: number }) {
  return (
    <div className="relative px-6">
      <div className="flex justify-between mb-2">
        <span className="text-sm font-medium text-slate-600" id="progress-label">Progress</span>
        <span className="text-sm font-bold text-blue-600" data-testid="progress-percent" aria-live="polite">{progressPercent}%</span>
      </div>
      <div 
        className="h-3 bg-slate-200 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-labelledby="progress-label"
      >
        <motion.div 
          className="h-full bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progressPercent}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

function StagesStepper({ stages, currentStep }: { stages: WithdrawalStage[]; currentStage: number }) {
  const arrowDepth = 10;
  
  const getClipPath = (isFirst: boolean, isLast: boolean) => {
    if (isFirst) return `polygon(0 0, calc(100% - ${arrowDepth}px) 0, 100% 50%, calc(100% - ${arrowDepth}px) 100%, 0 100%)`;
    if (isLast) return `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${arrowDepth}px 50%)`;
    return `polygon(0 0, calc(100% - ${arrowDepth}px) 0, 100% 50%, calc(100% - ${arrowDepth}px) 100%, 0 100%, ${arrowDepth}px 50%)`;
  };

  return (
    <div className="px-4 sm:px-6" role="region" aria-label="Case workflow steps">
      <div className="flex items-stretch w-full" role="list" aria-label={`Case workflow progress: Step ${currentStage} of ${stages.length}`}>
        {stages.filter(s => s.id <= currentStage).map((stage, index, filteredStages) => {
          const isCompleted = currentStep > stage.id;
          const isCurrent = currentStep === stage.id;
          const isFirst = index === 0;
          const isLast = index === filteredStages.length - 1;
          
          return (
            <motion.div
              key={stage.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="overflow-hidden"
              style={{ 
                marginLeft: isFirst ? '0' : `-${arrowDepth}px`,
                flex: isCurrent ? '1 1 auto' : '0 0 auto',
                width: isCompleted ? '42px' : (isCurrent ? 'auto' : '42px'),
                minWidth: isCompleted ? '42px' : (isCurrent ? '180px' : '42px'),
                maxWidth: isCompleted ? '42px' : 'none'
              }}
              data-testid={`stage-${stage.id}`}
              role="listitem"
              aria-label={`Step ${stage.id}: ${stage.label}${isCompleted ? ' (completed)' : isCurrent ? ' (in progress)' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div 
                className={`relative flex items-center h-[60px] w-full ${
                  isCompleted ? 'bg-green-500 justify-center' :
                  isCurrent ? 'bg-blue-500' :
                  'bg-slate-300 justify-center'
                }`}
                style={{ clipPath: getClipPath(isFirst, isLast) }}
              >
                {isCompleted && (
                  <div className="flex items-center justify-center w-full">
                    <CheckCircle className="w-5 h-5 text-white" />
                  </div>
                )}
                {isCurrent && (
                  <div className={`flex items-center gap-3 w-full ${isFirst ? 'pl-4' : 'pl-5'} pr-4`}>
                    <span className="text-xl flex-shrink-0">{stage.icon}</span>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-bold text-white leading-tight">
                        {stage.label}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white animate-pulse w-fit mt-1">
                        In Progress
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500 mt-4 text-center">Your case workflow is in progress</p>
    </div>
  );
}

function CurrentStageCard({ stage }: { stage: WithdrawalStep }) {
  return (
    <div className="px-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl"
        data-testid="current-stage-card"
        role="status"
        aria-live="polite"
        aria-label={`Current step: ${stage.label}`}
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-2xl animate-pulse" aria-hidden="true">
            {stage.icon}
          </div>
          <div>
            <p className="text-xs text-blue-600 font-medium">Currently Processing</p>
            <h4 className="font-bold text-blue-800 text-lg">{stage.label}</h4>
            <p className="text-blue-600 text-sm mt-0.5">{stage.description}</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default WithdrawalProgressTracker;
