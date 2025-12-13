import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, FolderOpen, FileText, ArrowLeft } from "lucide-react";
import { usePortal } from "./PortalContext";

export function SubmissionsView() {
  const { currentCase, submissions, setViewState } = usePortal();

  return (
    <div className="min-h-screen bg-slate-900 p-4 font-sans">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-[#004182]/20 flex items-center justify-center">
            <Shield className="h-6 w-6 text-[#004182]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Document Archive</h1>
            <p className="text-slate-400 text-xs">Your submission history</p>
          </div>
        </div>

        <Card className="bg-slate-950 border-slate-800 mb-6">
          <CardHeader className="border-b border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-blue-500" />
                <CardTitle className="text-white text-lg">Your Submissions</CardTitle>
              </div>
              <Badge variant="outline" className="text-slate-400 border-slate-700">
                {submissions.length} records
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {submissions.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No submissions found.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {submissions.map((s) => (
                  <div 
                    key={s.id} 
                    className="bg-slate-900 border border-slate-800 rounded-lg p-4" 
                    data-testid={`submission-${s.id}`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <Badge className={s.selectedOption === 'A' ? 'bg-blue-600' : 'bg-slate-600'}>
                        Option {s.selectedOption} Selected
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {new Date(s.submittedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-slate-500 block text-xs mb-1">Withdrawal Amount</span>
                        <span className="text-green-400 font-medium">{s.withdrawalAmount}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-xs mb-1">Total Batches</span>
                        <span className="text-slate-300">{s.withdrawalBatches}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Button 
          variant="outline" 
          className="border-slate-700 text-slate-300" 
          onClick={() => setViewState('dashboard')} 
          data-testid="button-back-dashboard"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
