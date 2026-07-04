import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { X } from "lucide-react";
import { useAdminDashboard } from "../AdminDashboardContext";

export function SubmissionsTab() {
  const { allSubmissions, isDataLoading, handleDeleteSubmission } =
    useAdminDashboard();

  return (
    <>
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
              {isDataLoading ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent border-slate-800 animate-pulse">
                    <TableCell><div className="h-5 w-28 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-24 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-32 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-16 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-20 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-5 w-12 bg-slate-800 rounded"></div></TableCell>
                    <TableCell><div className="h-8 w-8 bg-slate-800 rounded mx-auto"></div></TableCell>
                  </TableRow>
                ))
              ) : allSubmissions.length === 0 ? (
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
    </>
  );
}
