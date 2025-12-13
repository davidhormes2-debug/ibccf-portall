import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Wallet, Upload, Image, MessageCircle, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";

export function DepositView() {
  const { currentCase, depositReceipts, uploadReceipt, setViewState, setIsChatOpen } = usePortal();
  const [receiptNotes, setReceiptNotes] = useState("");
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentCase) return;

    setUploadingReceipt(true);
    try {
      await uploadReceipt(file, receiptNotes);
      setReceiptNotes("");
    } catch (error) {
      console.error('Upload failed:', error);
    }
    setUploadingReceipt(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-primary text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" className="text-white" onClick={() => setViewState('dashboard')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="font-bold">Deposit & Receipts</h1>
            <p className="text-xs text-blue-200">Upload and track your deposit receipts</p>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {currentCase?.depositAddress && (
          <Card className="mb-8 border-2 border-amber-200 bg-amber-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-900">
                <Wallet className="w-5 h-5" />
                Your USDT Deposit Address (TRC20)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 p-4 bg-white rounded border">
                <code className="flex-1 text-sm break-all font-mono font-bold text-slate-900">
                  {currentCase.depositAddress}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(currentCase.depositAddress || '');
                    toast({ title: "Copied!", description: "Deposit address copied to clipboard" });
                  }}
                  data-testid="button-copy-address"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <div className="mt-4 p-3 bg-amber-100 rounded-lg">
                <p className="text-sm text-amber-800 font-medium mb-2">Important Instructions:</p>
                <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
                  <li>Only send USDT on the TRC20 network</li>
                  <li>After completing your deposit, upload the receipt below</li>
                  <li>Keep your transaction hash for reference</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload Deposit Receipt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Textarea
                placeholder="Add notes about your deposit (optional)..."
                value={receiptNotes}
                onChange={(e) => setReceiptNotes(e.target.value)}
                className="resize-none"
                rows={3}
                data-testid="input-receipt-notes"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
                data-testid="input-file-upload"
              />
              <Button 
                className="w-full" 
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingReceipt}
                data-testid="button-upload-receipt"
              >
                {uploadingReceipt ? (
                  <>Uploading...</>
                ) : (
                  <>
                    <Image className="w-4 h-4 mr-2" />
                    Select Image to Upload
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <h3 className="text-lg font-bold text-slate-900 mb-4">Uploaded Receipts</h3>
        {depositReceipts.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border">
            <Image className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">No receipts uploaded yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {depositReceipts.map(receipt => (
              <Card key={receipt.id} data-testid={`receipt-${receipt.id}`}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {receipt.imageData && (
                      <img src={receipt.imageData} alt="Receipt" className="w-16 h-16 object-cover rounded" />
                    )}
                    <div>
                      <p className="font-semibold">{receipt.fileName || 'Receipt'}</p>
                      <p className="text-sm text-slate-500">{new Date(receipt.uploadedAt).toLocaleString()}</p>
                      {receipt.notes && <p className="text-sm text-slate-600 mt-1">{receipt.notes}</p>}
                    </div>
                  </div>
                  <Badge variant={
                    receipt.status === 'approved' ? 'default' :
                    receipt.status === 'rejected' ? 'destructive' :
                    'secondary'
                  }>
                    {receipt.status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card className="mt-8">
          <CardContent className="py-6 text-center">
            <p className="text-slate-600 mb-4">Need help with your deposit?</p>
            <Button onClick={() => setIsChatOpen(true)} data-testid="button-contact-support">
              <MessageCircle className="w-4 h-4 mr-2" />
              Contact IBCCF Support
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
