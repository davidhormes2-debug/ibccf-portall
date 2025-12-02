import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldAlert, RefreshCw, Trash2, Lock, Search, Filter, Eye, FileText, Printer, Download } from "lucide-react";
import ibcLogo from "@assets/generated_images/professional_corporate_logo_for_international_blockchain_community.png";

interface Submission {
  id: string;
  user: string;
  option: "A" | "B";
  amount: string;
  cost: string;
  timestamp: string;
  status: string;
}

export default function AdminDashboard() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);

  const loadData = () => {
    const data = JSON.parse(localStorage.getItem('ibc_submissions') || '[]');
    setSubmissions(data);
  };

  useEffect(() => {
    loadData();
  }, []);

  const clearData = () => {
    if(confirm("Clear all simulated records?")) {
      localStorage.removeItem('ibc_submissions');
      loadData();
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
            <h2 className="text-2xl font-bold text-white mb-1">Withdrawal Requests</h2>
            <p className="text-slate-400 text-sm">Real-time monitoring of secure phrase key protocols.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" onClick={loadData}>
              <RefreshCw className="w-4 h-4 mr-2" /> Refresh
            </Button>
            <Button variant="destructive" size="sm" onClick={clearData}>
              <Trash2 className="w-4 h-4 mr-2" /> Clear Logs
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card className="bg-slate-950 border-slate-800">
            <CardContent className="p-6">
              <div className="text-slate-400 text-xs uppercase font-bold mb-2">Total Pending</div>
              <div className="text-3xl font-bold text-white">{submissions.length}</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-950 border-slate-800">
            <CardContent className="p-6">
              <div className="text-slate-400 text-xs uppercase font-bold mb-2">Active Keys</div>
              <div className="text-3xl font-bold text-blue-400">0</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-950 border-slate-800">
            <CardContent className="p-6">
              <div className="text-slate-400 text-xs uppercase font-bold mb-2">Flagged Reviews</div>
              <div className="text-3xl font-bold text-amber-500">0</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-950 border-slate-800">
            <CardContent className="p-6">
              <div className="text-slate-400 text-xs uppercase font-bold mb-2">System Status</div>
              <div className="text-lg font-bold text-green-400 flex items-center gap-2 mt-1">
                <ShieldAlert className="w-5 h-5" /> Operational
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Data Table */}
        <Card className="bg-slate-950 border-slate-800 overflow-hidden">
          <CardHeader className="border-b border-slate-800 bg-slate-900/50 py-4">
             <div className="flex justify-between items-center">
               <CardTitle className="text-base font-medium text-white">Recent Transmissions</CardTitle>
               <div className="flex gap-2">
                 <div className="relative">
                   <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-500" />
                   <input type="text" placeholder="Search ref..." className="bg-slate-900 border border-slate-700 rounded-md pl-9 pr-4 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 w-48" />
                 </div>
                 <Button variant="outline" size="icon" className="border-slate-700 bg-slate-800 text-slate-400">
                   <Filter className="w-4 h-4" />
                 </Button>
               </div>
             </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-900">
                <TableRow className="hover:bg-slate-900 border-slate-800">
                  <TableHead className="text-slate-400 w-[150px]">Reference ID</TableHead>
                  <TableHead className="text-slate-400">Timestamp</TableHead>
                  <TableHead className="text-slate-400">User Identity</TableHead>
                  <TableHead className="text-slate-400">Protocol</TableHead>
                  <TableHead className="text-slate-400 text-right">Value</TableHead>
                  <TableHead className="text-slate-400 text-right">Key Cost</TableHead>
                  <TableHead className="text-slate-400 text-center">Status</TableHead>
                  <TableHead className="text-slate-400 text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.length === 0 ? (
                  <TableRow className="hover:bg-transparent border-slate-800">
                    <TableCell colSpan={8} className="text-center py-12 text-slate-500">
                      No secure transmissions received yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  submissions.map((sub) => (
                    <TableRow key={sub.timestamp} className="hover:bg-slate-900/50 border-slate-800 group">
                      <TableCell className="font-mono text-blue-400 font-medium">{sub.id}</TableCell>
                      <TableCell className="text-slate-300 text-xs">
                        {new Date(sub.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-white font-medium">{sub.user}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`
                          ${sub.option === 'A' 
                            ? 'border-blue-500/30 bg-blue-500/10 text-blue-400' 
                            : 'border-slate-500/30 bg-slate-500/10 text-slate-400'
                          }
                        `}>
                          Option {sub.option}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-slate-200">{sub.amount}</TableCell>
                      <TableCell className="text-right text-amber-400 font-mono text-xs">{sub.cost}</TableCell>
                      <TableCell className="text-center">
                        <Badge className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20">
                          {sub.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-800"
                          onClick={() => setSelectedSubmission(sub)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </main>

      {/* Detail Modal */}
      <Dialog open={!!selectedSubmission} onOpenChange={(open) => !open && setSelectedSubmission(null)}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <FileText className="w-5 h-5 text-blue-500" />
              Submission Details
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Full secure transmission record from ISO-D Gateway.
            </DialogDescription>
          </DialogHeader>

          {selectedSubmission && (
            <div className="space-y-6 py-4">
              <div className="bg-slate-900 rounded-md p-4 border border-slate-800 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-slate-500 uppercase mb-1">Reference ID</div>
                  <div className="font-mono text-blue-400 font-bold">{selectedSubmission.id}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase mb-1">Timestamp</div>
                  <div className="text-sm text-slate-300">{new Date(selectedSubmission.timestamp).toLocaleString()}</div>
                </div>
                <div className="col-span-2 border-t border-slate-800 pt-3 mt-1">
                  <div className="text-xs text-slate-500 uppercase mb-1">User Identity</div>
                  <div className="font-medium text-white text-lg">{selectedSubmission.user}</div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wide border-b border-slate-800 pb-2">
                  Selection Protocol
                </h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-slate-900/50 rounded border border-slate-800">
                    <div className="text-xs text-slate-500 mb-1">Selected Option</div>
                    <div className="text-white font-bold flex items-center gap-2">
                      <span className="w-6 h-6 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs">
                        {selectedSubmission.option}
                      </span>
                      {selectedSubmission.option === 'A' ? 'Accelerated' : 'Standard'}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-900/50 rounded border border-slate-800">
                    <div className="text-xs text-slate-500 mb-1">Status</div>
                    <Badge className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20">
                      {selectedSubmission.status}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Withdrawal Amount</div>
                    <div className="text-lg font-medium text-white">{selectedSubmission.amount}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Required Key Cost</div>
                    <div className="text-lg font-mono font-bold text-amber-400">{selectedSubmission.cost}</div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-2">
                  <Printer className="w-4 h-4" /> Print Record
                </Button>
                <Button variant="outline" className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800 gap-2">
                  <Download className="w-4 h-4" /> Export PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
