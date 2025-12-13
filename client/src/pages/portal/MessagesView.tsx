import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  ArrowLeft, Lock, Shield, AlertTriangle, Clock, CheckCircle 
} from "lucide-react";
import { usePortal, AdminMessage } from "./PortalContext";

export function MessagesView() {
  const { currentCase, adminMessages, markAdminMessageRead, setViewState } = usePortal();
  const [selectedMessage, setSelectedMessage] = useState<AdminMessage | null>(null);

  const urgentMessages = adminMessages.filter(m => m.category === 'urgent');
  const processingMessages = adminMessages.filter(m => m.category === 'processing');
  const resolvedMessages = adminMessages.filter(m => m.category === 'resolved');
  const unreadTotal = adminMessages.filter(m => !m.isRead).length;

  const handleMessageClick = (msg: AdminMessage) => {
    setSelectedMessage(msg);
    if (!msg.isRead) {
      markAdminMessageRead(msg.id);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <nav className="bg-gradient-to-r from-blue-900 via-indigo-900 to-blue-900 text-white shadow-2xl border-b border-blue-700/50">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => setViewState('dashboard')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500/30 rounded-full flex items-center justify-center">
                <Lock className="w-5 h-5 text-blue-300" />
              </div>
              <div>
                <h1 className="font-bold text-lg tracking-wide">Secure Message Portal</h1>
                <p className="text-xs text-blue-300">Encrypted communications from IBCCF</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {unreadTotal > 0 && (
              <Badge className="bg-red-500 text-white animate-pulse">{unreadTotal} Unread</Badge>
            )}
            <div className="text-right text-xs text-blue-300">
              <p>Session: IBCCF-{currentCase?.accessCode}</p>
              <p className="text-blue-400 font-mono">{new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 bg-gradient-to-r from-blue-900/50 to-indigo-900/50 border border-blue-700/50 rounded-xl flex items-center gap-3"
        >
          <Shield className="w-6 h-6 text-blue-400 flex-shrink-0" />
          <div>
            <p className="text-sm text-blue-200 font-medium">End-to-End Encrypted Communications</p>
            <p className="text-xs text-blue-400">All messages are securely transmitted using AES-256 encryption protocol</p>
          </div>
        </motion.div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="p-4 bg-gradient-to-br from-red-900/40 to-red-800/20 border border-red-700/50 rounded-xl text-center"
          >
            <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-red-400">{urgentMessages.length}</p>
            <p className="text-xs text-red-300/70 uppercase tracking-wider">Action Required</p>
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="p-4 bg-gradient-to-br from-amber-900/40 to-amber-800/20 border border-amber-700/50 rounded-xl text-center"
          >
            <Clock className="w-6 h-6 text-amber-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-amber-400">{processingMessages.length}</p>
            <p className="text-xs text-amber-300/70 uppercase tracking-wider">Processing</p>
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="p-4 bg-gradient-to-br from-green-900/40 to-green-800/20 border border-green-700/50 rounded-xl text-center"
          >
            <CheckCircle className="w-6 h-6 text-green-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-green-400">{resolvedMessages.length}</p>
            <p className="text-xs text-green-300/70 uppercase tracking-wider">Completed</p>
          </motion.div>
        </div>

        {urgentMessages.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <h2 className="text-lg font-bold text-red-400 flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
              Urgent Action Required
            </h2>
            <div className="space-y-4">
              {urgentMessages.map((msg, idx) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                >
                  <Card 
                    className={`border-2 ${!msg.isRead ? 'border-red-500 bg-red-950/50' : 'border-red-800/50 bg-red-950/30'} cursor-pointer hover:shadow-lg hover:shadow-red-500/20 transition-all`}
                    onClick={() => handleMessageClick(msg)}
                    data-testid={`message-urgent-${msg.id}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-red-300 flex items-center gap-2">
                          {!msg.isRead && <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
                          <Lock className="w-4 h-4" />
                          {msg.title}
                        </CardTitle>
                        <span className="text-xs text-red-400/60">{new Date(msg.createdAt).toLocaleDateString()}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-slate-400 line-clamp-2">{msg.body}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {processingMessages.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mb-8">
            <h2 className="text-lg font-bold text-amber-400 flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5" />
              Processing Updates
            </h2>
            <div className="space-y-4">
              {processingMessages.map((msg, idx) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                >
                  <Card 
                    className={`border-2 ${!msg.isRead ? 'border-amber-500 bg-amber-950/50' : 'border-amber-800/50 bg-amber-950/30'} cursor-pointer hover:shadow-lg hover:shadow-amber-500/20 transition-all`}
                    onClick={() => handleMessageClick(msg)}
                    data-testid={`message-processing-${msg.id}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-amber-300 flex items-center gap-2">
                          {!msg.isRead && <div className="w-2 h-2 bg-amber-500 rounded-full" />}
                          <Lock className="w-4 h-4" />
                          {msg.title}
                        </CardTitle>
                        <span className="text-xs text-amber-400/60">{new Date(msg.createdAt).toLocaleDateString()}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-slate-400 line-clamp-2">{msg.body}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {resolvedMessages.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mb-8">
            <h2 className="text-lg font-bold text-green-400 flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5" />
              Completed Notifications
            </h2>
            <div className="space-y-4">
              {resolvedMessages.map((msg, idx) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                >
                  <Card 
                    className="border-2 border-green-800/50 bg-green-950/30 cursor-pointer hover:shadow-lg hover:shadow-green-500/20 transition-all"
                    onClick={() => handleMessageClick(msg)}
                    data-testid={`message-resolved-${msg.id}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-green-300 flex items-center gap-2">
                          <Lock className="w-4 h-4" />
                          {msg.title}
                        </CardTitle>
                        <span className="text-xs text-green-400/60">{new Date(msg.createdAt).toLocaleDateString()}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-slate-400 line-clamp-2">{msg.body}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {adminMessages.length === 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 bg-slate-800/30 rounded-xl border border-slate-700"
          >
            <Lock className="w-16 h-16 mx-auto text-slate-600 mb-4" />
            <h3 className="text-xl font-semibold text-slate-400">Secure Message Portal Empty</h3>
            <p className="text-slate-500 mt-2">You have no encrypted messages at this time.</p>
            <p className="text-xs text-slate-600 mt-4">Messages will appear here when IBCCF sends updates about your case.</p>
          </motion.div>
        )}
      </main>

      <Dialog open={!!selectedMessage} onOpenChange={() => setSelectedMessage(null)}>
        <DialogContent className="max-w-lg bg-slate-900 border border-slate-700">
          <DialogHeader>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
              <Shield className="w-3 h-3" />
              <span>Encrypted Message</span>
            </div>
            <DialogTitle className="flex items-center gap-2 text-white">
              {selectedMessage?.category === 'urgent' && <AlertTriangle className="w-5 h-5 text-red-500" />}
              {selectedMessage?.category === 'processing' && <Clock className="w-5 h-5 text-amber-500" />}
              {selectedMessage?.category === 'resolved' && <CheckCircle className="w-5 h-5 text-green-500" />}
              {selectedMessage?.title}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {selectedMessage && new Date(selectedMessage.createdAt).toLocaleString()}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 px-4 bg-slate-800/50 rounded-lg border border-slate-700">
            <p className="text-slate-300 whitespace-pre-line leading-relaxed">{selectedMessage?.body}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedMessage(null)} className="border-slate-600 text-slate-300 hover:bg-slate-800">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
