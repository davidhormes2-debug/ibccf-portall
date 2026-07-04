import React, { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Plus, Eye, MessageCircle, FolderOpen, BookOpen } from "lucide-react";
import { AdminCaseLedgerDialog } from "@/components/admin/AdminCaseLedgerDialog";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAdmin, Case } from "./AdminContext";

interface CaseListProps {
  onSelectCase: (c: Case) => void;
  onOpenChat: (c: Case) => void;
  onViewSubmissions: (c: Case) => void;
  loadData: (showToast?: boolean) => Promise<void>;
}

export function CaseList({ onSelectCase, onOpenChat, onViewSubmissions, loadData }: CaseListProps) {
  const { 
    filteredCases, 
    searchQuery, 
    setSearchQuery, 
    statusFilter, 
    setStatusFilter, 
    unreadCounts,
    allSubmissions,
    toast,
    authToken
  } = useAdmin();
  const { t } = useTranslation("admin");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState("");
  const [ledgerCase, setLedgerCase] = useState<Case | null>(null);

  const generateAccessCode = () => {
    const code = Math.random().toString().slice(2, 8);
    setNewAccessCode(code);
  };

  const createCase = async () => {
    if (!newAccessCode.trim()) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("caseList.accessCodeRequired", { defaultValue: "Please enter an access code." }) });
      return;
    }

    try {
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ accessCode: newAccessCode.trim() })
      });

      if (response.ok) {
        toast({ title: t("toasts.caseCreated.title"), description: t("toasts.caseCreated.description", { code: newAccessCode }) });
        setIsCreateOpen(false);
        setNewAccessCode("");
        loadData();
      } else {
        const error = await response.json();
        toast({ variant: "destructive", title: t("toasts.errorTitle"), description: error.message || t("toasts.caseCreateFailed.description") });
      }
    } catch (_e) {
      toast({ variant: "destructive", title: t("toasts.errorTitle"), description: t("toasts.networkError") });
    }
  };

  const getSubmissionCount = (caseId: string) => {
    return allSubmissions.filter(s => s.caseId === caseId).length;
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      created: 'bg-slate-600 text-slate-100',
      registered: 'bg-blue-600 text-white',
      syncing: 'bg-amber-600 text-white',
      active: 'bg-green-600 text-white',
      completed: 'bg-purple-600 text-white'
    };
    return <Badge className={styles[status] || 'bg-gray-500'}>{t(`status.${status}`, { defaultValue: status })}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">{t("caseList.heading")}</h2>
          <p className="text-slate-400 text-sm">{t("caseList.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => loadData(true)} 
            variant="outline" 
            className="border-slate-700 text-slate-300"
            data-testid="button-refresh-cases"
          >
            <RefreshCw className="h-4 w-4 mr-2" /> {t("actions.refresh")}
          </Button>
          <Button 
            onClick={() => setIsCreateOpen(true)} 
            className="bg-blue-600 hover:bg-blue-700"
            data-testid="button-create-case"
          >
            <Plus className="h-4 w-4 mr-2" /> {t("actions.newCase")}
          </Button>
        </div>
      </div>

      <Card className="bg-slate-950 border-slate-800">
        <CardHeader className="border-b border-slate-800 py-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <Input
              placeholder={t("caseList.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-900 border-slate-700 text-white sm:max-w-xs"
              data-testid="input-search-cases"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white sm:w-40" data-testid="select-status-filter">
                <SelectValue placeholder={t("caseList.filterPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("caseList.filterAll")}</SelectItem>
                <SelectItem value="created">{t("status.created")}</SelectItem>
                <SelectItem value="registered">{t("status.registered")}</SelectItem>
                <SelectItem value="syncing">{t("status.syncing")}</SelectItem>
                <SelectItem value="active">{t("status.active")}</SelectItem>
                <SelectItem value="completed">{t("status.completed")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">{t("caseList.tableAccessCode")}</TableHead>
                  <TableHead className="text-slate-400">{t("caseList.tableUser")}</TableHead>
                  <TableHead className="text-slate-400">{t("caseList.tableStatus")}</TableHead>
                  <TableHead className="text-slate-400">{t("caseList.tableSubmissions")}</TableHead>
                  <TableHead className="text-slate-400">{t("caseList.tableLedger")}</TableHead>
                  <TableHead className="text-slate-400">{t("caseList.tableActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence>
                  {filteredCases.map((c, index) => (
                    <motion.tr
                      key={c.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="border-slate-800 hover:bg-slate-900/50"
                    >
                      <TableCell className="font-mono text-white">{c.accessCode}</TableCell>
                      <TableCell>
                        <div>
                          <p className="text-white text-sm">{c.userName || '—'}</p>
                          <p className="text-slate-500 text-xs">{c.userEmail || ''}</p>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(c.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => onSelectCase(c)}
                            className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                            data-testid={`button-view-case-${c.id}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => onOpenChat(c)}
                            className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 relative"
                            data-testid={`button-chat-case-${c.id}`}
                          >
                            <MessageCircle className="h-4 w-4" />
                            {unreadCounts[c.id] > 0 && (
                              <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 rounded-full text-[10px] flex items-center justify-center text-white">
                                {unreadCounts[c.id]}
                              </span>
                            )}
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => onViewSubmissions(c)}
                            className="text-green-400 hover:text-green-300 hover:bg-green-500/10"
                            title={t("caseList.viewSubmissionsTooltip", { defaultValue: "View Submissions" })}
                            data-testid={`button-submissions-case-${c.id}`}
                          >
                            <FolderOpen className="h-4 w-4 mr-1" />
                            <span className="text-xs font-bold">{getSubmissionCount(c.id)}</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLedgerCase(c)}
                            className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                            title={t("caseList.viewLedgerTooltip")}
                            data-testid={`button-ledger-case-${c.id}`}
                          >
                            <BookOpen className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </motion.tr>
                  ))}
                </AnimatePresence>
                {filteredCases.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500 py-12">
                      {t("caseList.empty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-slate-950 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-white">{t("caseList.createTitle")}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {t("caseList.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-2">
              <Input
                placeholder={t("caseList.createPlaceholder")}
                value={newAccessCode}
                onChange={(e) => setNewAccessCode(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white font-mono"
                data-testid="input-new-access-code"
              />
              <Button 
                onClick={generateAccessCode} 
                variant="outline" 
                className="border-slate-700 text-slate-300"
                data-testid="button-generate-code"
              >
                {t("actions.generate")}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)} className="text-slate-400">
              {t("actions.cancel")}
            </Button>
            <Button onClick={createCase} className="bg-blue-600 hover:bg-blue-700" data-testid="button-confirm-create">
              {t("actions.createCase")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ledgerCase && (
        <AdminCaseLedgerDialog
          open={true}
          onOpenChange={(open) => { if (!open) setLedgerCase(null); }}
          caseId={ledgerCase.id}
          caseLabel={ledgerCase.accessCode}
          authToken={authToken}
        />
      )}
    </div>
  );
}

export default CaseList;
