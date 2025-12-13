import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Upload, Loader2, CheckCircle, Clock, XCircle, Image, FileText, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";

export interface DepositReceipt {
  id: number;
  caseId: string;
  imageData: string;
  fileName: string;
  notes?: string | null;
  status: string;
  adminNotes?: string | null;
  uploadedAt?: Date | string;
}

interface ReceiptUploaderProps {
  onUpload: (file: File, notes: string) => Promise<void>;
  isUploading?: boolean;
  acceptedTypes?: string;
  maxSizeBytes?: number;
}

export function ReceiptUploader({
  onUpload,
  isUploading = false,
  acceptedTypes = "image/*",
  maxSizeBytes = 10 * 1024 * 1024,
}: ReceiptUploaderProps) {
  const [notes, setNotes] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (file.size > maxSizeBytes) {
      alert(`File too large. Maximum size is ${maxSizeBytes / 1024 / 1024}MB`);
      return;
    }
    
    await onUpload(file, notes);
    setNotes("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    
    if (file.size > maxSizeBytes) {
      alert(`File too large. Maximum size is ${maxSizeBytes / 1024 / 1024}MB`);
      return;
    }
    
    await onUpload(file, notes);
    setNotes("");
  };

  return (
    <Card data-testid="receipt-uploader">
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
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="resize-none"
            rows={3}
            data-testid="input-receipt-notes"
          />
          
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            role="region"
            aria-label="File upload area"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedTypes}
              onChange={handleFileChange}
              className="hidden"
              id="receipt-upload"
              data-testid="input-file-receipt"
              aria-label="Choose file to upload"
            />
            
            {isUploading ? (
              <div className="flex flex-col items-center gap-2" role="status" aria-label="Uploading file">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" aria-hidden="true" />
                <p className="text-slate-600">Uploading...</p>
              </div>
            ) : (
              <>
                <div className="w-12 h-12 bg-blue-100 rounded-full mx-auto flex items-center justify-center mb-4">
                  <Image className="w-6 h-6 text-blue-600" />
                </div>
                <p className="text-slate-600 mb-2">
                  Drag & drop your receipt here, or
                </p>
                <Button 
                  variant="outline" 
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-choose-file"
                >
                  Choose File
                </Button>
                <p className="text-xs text-slate-500 mt-3">
                  Accepted: Images (PNG, JPG, GIF) • Max 10MB
                </p>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ReceiptListProps {
  receipts: DepositReceipt[];
  emptyMessage?: string;
  showAdminNotes?: boolean;
}

const statusConfig = {
  pending: {
    icon: Clock,
    label: 'Pending Review',
    variant: 'secondary' as const,
    bgClass: 'bg-yellow-50 border-yellow-200',
  },
  approved: {
    icon: CheckCircle,
    label: 'Approved',
    variant: 'default' as const,
    bgClass: 'bg-green-50 border-green-200',
  },
  rejected: {
    icon: XCircle,
    label: 'Rejected',
    variant: 'destructive' as const,
    bgClass: 'bg-red-50 border-red-200',
  },
};

export function ReceiptList({ receipts, emptyMessage = 'No receipts uploaded yet', showAdminNotes = true }: ReceiptListProps) {
  const [selectedReceipt, setSelectedReceipt] = useState<DepositReceipt | null>(null);

  if (receipts.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500" data-testid="empty-receipt-list">
        <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3" data-testid="receipt-list">
        {receipts.map((receipt) => (
          <ReceiptCard 
            key={receipt.id} 
            receipt={receipt} 
            onView={() => setSelectedReceipt(receipt)}
            showAdminNotes={showAdminNotes}
          />
        ))}
      </div>
      
      <Dialog open={!!selectedReceipt} onOpenChange={() => setSelectedReceipt(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Receipt Preview</DialogTitle>
          </DialogHeader>
          {selectedReceipt && (
            <div className="space-y-4">
              <img 
                src={selectedReceipt.imageData} 
                alt="Receipt" 
                className="w-full rounded-lg border"
              />
              {selectedReceipt.notes && (
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-600">{selectedReceipt.notes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ReceiptCardProps {
  receipt: DepositReceipt;
  onView: () => void;
  showAdminNotes?: boolean;
}

function ReceiptCard({ receipt, onView, showAdminNotes }: ReceiptCardProps) {
  const config = statusConfig[receipt.status as keyof typeof statusConfig] || statusConfig.pending;
  const Icon = config.icon;
  const formattedDate = receipt.uploadedAt 
    ? format(new Date(receipt.uploadedAt), 'MMM dd, yyyy HH:mm')
    : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-4 rounded-lg border ${config.bgClass}`}
      data-testid={`receipt-card-${receipt.id}`}
    >
      <div className="flex items-start gap-4">
        <div 
          className="w-16 h-16 bg-white rounded-lg border overflow-hidden flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-blue-400"
          onClick={onView}
        >
          <img 
            src={receipt.imageData} 
            alt={receipt.fileName}
            className="w-full h-full object-cover"
          />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-medium text-slate-800 truncate">{receipt.fileName}</p>
            <Badge variant={config.variant} className="flex items-center gap-1">
              <Icon className="w-3 h-3" />
              {config.label}
            </Badge>
          </div>
          
          {formattedDate && (
            <p className="text-xs text-slate-500 mb-2">{formattedDate}</p>
          )}
          
          {receipt.notes && (
            <p className="text-sm text-slate-600 line-clamp-2">{receipt.notes}</p>
          )}
          
          {showAdminNotes && receipt.adminNotes && (
            <div className="mt-2 p-2 bg-white rounded border text-sm">
              <span className="font-medium text-slate-700">Admin: </span>
              <span className="text-slate-600">{receipt.adminNotes}</span>
            </div>
          )}
        </div>
        
        <Button variant="ghost" size="sm" onClick={onView} data-testid={`view-receipt-${receipt.id}`} aria-label={`View receipt ${receipt.fileName}`}>
          <Eye className="w-4 h-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.div>
  );
}

export default ReceiptUploader;
