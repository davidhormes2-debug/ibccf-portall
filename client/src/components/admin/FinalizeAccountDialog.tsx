import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { UserCheck, Users, Edit3 } from "lucide-react";
import type { AdminData, CaseLetter } from "@/components/admin/shared";

interface FinalizeAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalizeData: AdminData;
  setFinalizeData: React.Dispatch<React.SetStateAction<AdminData>>;
  letterData: Partial<CaseLetter>;
  setLetterData: React.Dispatch<React.SetStateAction<Partial<CaseLetter>>>;
  handleFinalize: () => void | Promise<void>;
}

export function FinalizeAccountDialog({
  open,
  onOpenChange,
  finalizeData,
  setFinalizeData,
  letterData,
  setLetterData,
  handleFinalize,
}: FinalizeAccountDialogProps) {
  const { t } = useTranslation("admin");
  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5" /> {t("dialogs.finalize.title")}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Review and edit user details and letter content before activating the account.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="details" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-slate-900 border border-slate-800">
              <TabsTrigger value="details" className="data-[state=active]:bg-slate-800 gap-2" data-testid="tab-finalize-details">
                <Users className="w-4 h-4" /> User Details
              </TabsTrigger>
              <TabsTrigger value="letter" className="data-[state=active]:bg-slate-800 gap-2" data-testid="tab-finalize-letter">
                <Edit3 className="w-4 h-4" /> Letter Content
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="details" className="mt-4">
              <div className="grid gap-4">
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
            </TabsContent>
            
            <TabsContent value="letter" className="mt-4">
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-400">Headline</Label>
                  <Input 
                    value={letterData.headline || ""}
                    onChange={(e) => setLetterData({...letterData, headline: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white"
                    data-testid="input-finalize-letter-headline"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-400">Introduction</Label>
                  <Textarea 
                    value={letterData.introduction || ""}
                    onChange={(e) => setLetterData({...letterData, introduction: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[80px]"
                    placeholder="Dear [User Name],..."
                    data-testid="input-finalize-letter-introduction"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-400">Body Content</Label>
                  <Textarea 
                    value={letterData.bodyContent || ""}
                    onChange={(e) => setLetterData({...letterData, bodyContent: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[80px]"
                    placeholder="Main letter content..."
                    data-testid="input-finalize-letter-body"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-400">Footer Note</Label>
                  <Textarea 
                    value={letterData.footerNote || ""}
                    onChange={(e) => setLetterData({...letterData, footerNote: e.target.value})}
                    className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                    data-testid="input-finalize-letter-footer"
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
                        data-testid="input-finalize-option-a-title"
                      />
                      <Textarea 
                        value={letterData.optionADescription || ""}
                        onChange={(e) => setLetterData({...letterData, optionADescription: e.target.value})}
                        className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                        placeholder="Option A description..."
                        data-testid="input-finalize-option-a-desc"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-400">Option B Title</Label>
                      <Input 
                        value={letterData.optionBTitle || ""}
                        onChange={(e) => setLetterData({...letterData, optionBTitle: e.target.value})}
                        className="bg-slate-900 border-slate-700 text-white"
                        data-testid="input-finalize-option-b-title"
                      />
                      <Textarea 
                        value={letterData.optionBDescription || ""}
                        onChange={(e) => setLetterData({...letterData, optionBDescription: e.target.value})}
                        className="bg-slate-900 border-slate-700 text-white min-h-[60px]"
                        placeholder="Option B description..."
                        data-testid="input-finalize-option-b-desc"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleFinalize} className="bg-green-600 hover:bg-green-700 text-white gap-2" data-testid="button-finalize-submit">
              <UserCheck className="w-4 h-4" /> Accept & Finalize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
