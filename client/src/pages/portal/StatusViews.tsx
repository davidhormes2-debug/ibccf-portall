import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Shield, CheckCircle2, ArrowLeft, Clock, FileText, Upload, Bell, 
  Wallet, ExternalLink 
} from "lucide-react";
import { usePortal, Submission } from "./PortalContext";

interface SuccessViewProps {
  lastSubmission?: Submission | null;
  selectedOption?: "A" | "B" | null;
}

export function SuccessView({ lastSubmission = null, selectedOption = null }: SuccessViewProps) {
  const { currentCase, setViewState, setIsChatOpen } = usePortal();
  
  const ticketId = lastSubmission?.id 
    ? `IBCCF-${String(lastSubmission.id).padStart(6, '0')}` 
    : `IBCCF-${Date.now().toString().slice(-6)}`;
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <nav className="bg-primary text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold">IBCCF SECURE PORTAL</h1>
            <p className="text-xs text-blue-200">Deposit Verification Required</p>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <motion.div 
          initial={{ opacity: 0, y: -20 }} 
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-50 border-2 border-green-200 rounded-lg p-6 mb-8"
        >
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-green-900">Withdrawal Request Confirmed</h2>
              <p className="text-green-700">Reference: <span className="font-mono font-bold">{ticketId}</span></p>
              <p className="text-sm text-green-600 mt-1">Option {lastSubmission?.selectedOption || selectedOption} selected on {new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </motion.div>

        <Card className="mb-8 border-2 border-blue-200">
          <CardHeader className="bg-blue-50">
            <CardTitle className="flex items-center gap-2 text-blue-900">
              <Wallet className="w-5 h-5" />
              Next Step: Complete Deposit
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="prose prose-sm text-slate-600 mb-6">
              <p>To process your withdrawal, please follow these steps:</p>
              <ol className="list-decimal pl-4 space-y-2">
                <li>Navigate to the <strong>Deposit & Receipts</strong> section</li>
                <li>Send the required USDT to your assigned deposit address</li>
                <li>Upload your transaction receipt for verification</li>
                <li>Wait for confirmation from our compliance team</li>
              </ol>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button 
                className="flex-1"
                onClick={() => setViewState('deposit')}
                data-testid="button-go-deposit"
              >
                <Wallet className="w-4 h-4 mr-2" />
                Go to Deposit
              </Button>
              <Button 
                variant="outline"
                className="flex-1"
                onClick={() => setIsChatOpen(true)}
                data-testid="button-contact-support"
              >
                Contact Support
              </Button>
            </div>
          </CardContent>
        </Card>

        {currentCase?.profileRedirectUrl && (
          <Card className="mb-8 border-2 border-amber-200 bg-amber-50">
            <CardContent className="py-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                  <ExternalLink className="w-6 h-6 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-amber-900">Return to Your Profile</h3>
                  <p className="text-sm text-amber-700">Access your external profile dashboard</p>
                </div>
                <Button
                  variant="outline"
                  className="border-amber-300 text-amber-700 hover:bg-amber-100"
                  onClick={() => window.open(currentCase.profileRedirectUrl, '_blank')}
                  data-testid="button-external-profile"
                >
                  Open Profile
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="text-center">
          <Button 
            variant="link" 
            className="text-slate-500"
            onClick={() => setViewState('dashboard')}
            data-testid="button-back-dashboard-success"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
          </Button>
        </div>
      </main>
    </div>
  );
}

export function TimelineView() {
  const { currentCase, submissions, depositReceipts, adminMessages, setViewState } = usePortal();
  
  interface Activity {
    id: string;
    type: string;
    title: string;
    description: string;
    timestamp: Date;
    color: 'blue' | 'green' | 'red' | 'amber';
    icon: 'file' | 'upload' | 'bell';
  }

  const activities: Activity[] = [
    ...submissions.map(s => ({
      id: `sub-${s.id}`,
      type: 'submission',
      title: `Option ${s.selectedOption} Submitted`,
      description: `Withdrawal request submitted`,
      timestamp: new Date(s.submittedAt),
      color: 'blue' as const,
      icon: 'file' as const
    })),
    ...depositReceipts.map(r => ({
      id: `dep-${r.id}`,
      type: 'receipt',
      title: 'Deposit Receipt Uploaded',
      description: r.status === 'approved' ? 'Receipt approved' : r.status === 'rejected' ? 'Receipt rejected' : 'Pending review',
      timestamp: new Date(r.uploadedAt),
      color: (r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber') as 'green' | 'red' | 'amber',
      icon: 'upload' as const
    })),
    ...adminMessages.map(m => ({
      id: `msg-${m.id}`,
      type: 'message',
      title: m.title,
      description: m.body.substring(0, 100) + (m.body.length > 100 ? '...' : ''),
      timestamp: new Date(m.createdAt),
      color: (m.category === 'urgent' ? 'red' : m.category === 'processing' ? 'amber' : 'green') as 'red' | 'amber' | 'green',
      icon: 'bell' as const
    }))
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return (
    <div className="min-h-screen bg-slate-950 p-4 font-sans">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-[#004182]/20 flex items-center justify-center">
            <Shield className="h-6 w-6 text-[#004182]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Activity Timeline</h1>
            <p className="text-slate-400 text-xs">Account: IBCCF-{currentCase?.accessCode}</p>
          </div>
        </div>

        <Card className="bg-slate-900 border-slate-800 mb-6">
          <CardHeader className="border-b border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-500" />
                <CardTitle className="text-white text-lg">Recent Activity</CardTitle>
              </div>
              <Badge variant="outline" className="text-slate-400 border-slate-700">
                {activities.length} events
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {activities.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No activity yet.</p>
                <p className="text-sm mt-2">Your account activities will appear here.</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-slate-800" />
                
                <div className="space-y-6">
                  {activities.map((activity, index) => (
                    <motion.div 
                      key={activity.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="relative pl-10"
                      data-testid={`timeline-item-${activity.id}`}
                    >
                      <div className={`absolute left-2.5 w-3 h-3 rounded-full ring-4 ring-slate-950 ${
                        activity.color === 'blue' ? 'bg-blue-500' :
                        activity.color === 'green' ? 'bg-green-500' :
                        activity.color === 'red' ? 'bg-red-500' :
                        activity.color === 'amber' ? 'bg-amber-500' : 'bg-slate-500'
                      }`} />
                      
                      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-md ${
                              activity.color === 'blue' ? 'bg-blue-500/20 text-blue-400' :
                              activity.color === 'green' ? 'bg-green-500/20 text-green-400' :
                              activity.color === 'red' ? 'bg-red-500/20 text-red-400' :
                              activity.color === 'amber' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-500/20 text-slate-400'
                            }`}>
                              {activity.icon === 'file' && <FileText className="w-4 h-4" />}
                              {activity.icon === 'upload' && <Upload className="w-4 h-4" />}
                              {activity.icon === 'bell' && <Bell className="w-4 h-4" />}
                            </div>
                            <span className="text-white font-medium text-sm">{activity.title}</span>
                          </div>
                          <span className="text-xs text-slate-500">
                            {activity.timestamp.toLocaleDateString()} {activity.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-slate-400 text-sm">{activity.description}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Button 
          variant="outline" 
          className="border-slate-700 text-slate-300" 
          onClick={() => setViewState('dashboard')} 
          data-testid="button-back-dashboard-timeline"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
