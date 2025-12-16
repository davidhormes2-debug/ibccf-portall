import { useState, useRef, useEffect, forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, Loader2, MoreVertical, Minimize2, Download, Shield, Smile, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ChatMessage {
  id: number;
  caseId: string;
  sender: 'user' | 'admin';
  message: string;
  createdAt?: Date | string;
  isRead?: string;
}

interface ChatWidgetProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => Promise<void>;
  isOpen: boolean;
  onToggle: () => void;
  unreadCount?: number;
  title?: string;
  subtitle?: string;
  isLoading?: boolean;
}

export function ChatWidget({
  messages,
  onSendMessage,
  isOpen,
  onToggle,
  unreadCount = 0,
  title = "IBCCF Support",
  subtitle = "Online • Typically replies in minutes",
  isLoading = false,
}: ChatWidgetProps) {
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || isSending) return;
    
    setIsSending(true);
    try {
      await onSendMessage(newMessage.trim());
      setNewMessage("");
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const downloadTranscript = () => {
    const transcript = messages.map(msg => {
      const time = msg.createdAt ? format(new Date(msg.createdAt), 'yyyy-MM-dd HH:mm') : '';
      const sender = msg.sender === 'admin' ? 'IBCCF Support' : 'You';
      return `[${time}] ${sender}: ${msg.message}`;
    }).join('\n\n');
    
    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ibccf-chat-transcript-${format(new Date(), 'yyyy-MM-dd')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <ChatButton 
        onClick={onToggle} 
        unreadCount={unreadCount} 
        isOpen={isOpen}
      />
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={`fixed bottom-6 right-6 z-50 w-[380px] ${isMinimized ? 'h-16' : 'h-[520px]'} bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden transition-all duration-300`}
            data-testid="chat-panel"
            role="dialog"
            aria-label="Support chat window"
            aria-modal="true"
          >
            <ChatHeader 
              title={title} 
              subtitle={subtitle} 
              onClose={onToggle}
              onMinimize={() => setIsMinimized(!isMinimized)}
              onDownload={downloadTranscript}
              isMinimized={isMinimized}
            />
            
            {!isMinimized && (
              <>
                <ChatMessages 
                  ref={chatScrollRef}
                  messages={messages} 
                  isLoading={isLoading}
                />
                
                <ChatInput
                  value={newMessage}
                  onChange={setNewMessage}
                  onSend={handleSend}
                  onKeyPress={handleKeyPress}
                  isSending={isSending}
                />
                
                <ChatFooter />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

interface ChatButtonProps {
  onClick: () => void;
  unreadCount: number;
  isOpen: boolean;
}

function ChatButton({ onClick, unreadCount, isOpen }: ChatButtonProps) {
  if (isOpen) return null;
  
  return (
    <motion.button
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="fixed bottom-6 right-6 w-16 h-16 bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-full shadow-2xl flex items-center justify-center z-50 hover:shadow-orange-500/30 hover:shadow-xl transition-shadow"
      onClick={onClick}
      data-testid="button-chat-float"
      aria-label={unreadCount > 0 ? `Open support chat. ${unreadCount} unread messages` : "Open support chat"}
      aria-haspopup="dialog"
    >
      <MessageCircle className="w-7 h-7" aria-hidden="true" />
      {unreadCount > 0 && (
        <motion.span 
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold border-2 border-white"
          aria-label={`${unreadCount} unread messages`}
        >
          {unreadCount}
        </motion.span>
      )}
    </motion.button>
  );
}

interface ChatHeaderProps {
  title: string;
  subtitle: string;
  onClose: () => void;
  onMinimize: () => void;
  onDownload: () => void;
  isMinimized: boolean;
}

function ChatHeader({ title, subtitle, onClose, onMinimize, onDownload, isMinimized }: ChatHeaderProps) {
  return (
    <div className="bg-white border-b border-slate-200 px-4 py-3 flex justify-between items-center">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center shadow-md">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div>
          <span className="font-semibold text-slate-900 block">{title}</span>
          {!isMinimized && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              <span className="text-xs text-slate-500">{subtitle}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
              aria-label="More options"
            >
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onMinimize} className="cursor-pointer">
              <Minimize2 className="h-4 w-4 mr-2" />
              {isMinimized ? 'Expand window' : 'Collapse window'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDownload} className="cursor-pointer">
              <Download className="h-4 w-4 mr-2" />
              Download transcript
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
          onClick={onClose}
          data-testid="button-close-chat"
          aria-label="Close chat"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading?: boolean;
}

const ChatMessages = forwardRef<HTMLDivElement, ChatMessagesProps>(
  ({ messages, isLoading }, ref) => {
    return (
      <div 
        ref={ref} 
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50"
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full" role="status" aria-label="Loading messages">
            <Loader2 className="w-6 h-6 animate-spin text-orange-500" aria-hidden="true" />
          </div>
        ) : messages.length === 0 ? (
          <WelcomeMessage />
        ) : (
          <>
            <WelcomeMessage showIntro />
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </>
        )}
      </div>
    );
  }
);
ChatMessages.displayName = 'ChatMessages';

function WelcomeMessage({ showIntro = false }: { showIntro?: boolean }) {
  if (showIntro) return null;
  
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center flex-shrink-0 shadow-md">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 space-y-3">
          <div className="bg-white rounded-2xl rounded-tl-none px-4 py-3 shadow-sm border border-slate-100">
            <p className="text-2xl mb-2">Hi there! 👋</p>
            <p className="text-slate-600 text-sm leading-relaxed">
              Welcome to IBCCF Support. Our team is here to assist you with your case.
            </p>
          </div>
          
          <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-slate-100">
            <p className="text-slate-700 text-sm font-medium mb-2">Our Customer Care team can assist with:</p>
            <ul className="text-slate-600 text-sm space-y-1">
              <li>• Case inquiries & status updates</li>
              <li>• Withdrawal processing</li>
              <li>• Deposit verification</li>
              <li>• Technical support</li>
            </ul>
          </div>
          
          <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-slate-100">
            <p className="text-slate-700 text-sm">So what brings you here today?</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.sender === 'user';
  const formattedTime = message.createdAt 
    ? format(new Date(message.createdAt), 'HH:mm')
    : '';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} items-end gap-2`}>
      {!isUser && (
        <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
          <Shield className="h-4 w-4 text-white" />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div
          className={`max-w-[260px] rounded-2xl px-4 py-2.5 ${
            isUser 
              ? 'bg-slate-800 text-white rounded-br-md' 
              : 'bg-white border border-slate-200 text-slate-800 rounded-bl-md shadow-sm'
          }`}
          data-testid={`chat-message-${message.id}`}
        >
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.message}</p>
        </div>
        {formattedTime && (
          <p className={`text-[10px] px-1 ${isUser ? 'text-right text-slate-400' : 'text-slate-400'}`}>
            {formattedTime}
          </p>
        )}
      </div>
    </div>
  );
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyPress: (e: React.KeyboardEvent) => void;
  isSending: boolean;
}

function ChatInput({ value, onChange, onSend, onKeyPress, isSending }: ChatInputProps) {
  return (
    <div className="p-3 bg-white border-t border-slate-200">
      <div className="flex items-end gap-2" role="group" aria-label="Message input">
        <div className="flex-1 relative">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyPress}
            placeholder="Message..."
            className="min-h-[44px] max-h-[120px] resize-none pr-20 rounded-xl border-slate-200 focus:border-orange-300 focus:ring-orange-200"
            disabled={isSending}
            data-testid="input-chat-message"
            aria-label="Message text"
            rows={1}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <button 
              className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors"
              aria-label="Add attachment"
              type="button"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button 
              className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors"
              aria-label="Add emoji"
              type="button"
            >
              <Smile className="h-4 w-4" />
            </button>
          </div>
        </div>
        <Button 
          onClick={onSend} 
          size="icon" 
          disabled={!value.trim() || isSending}
          className="h-11 w-11 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-md"
          data-testid="button-send-message"
          aria-label={isSending ? "Sending message" : "Send message"}
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}

function ChatFooter() {
  return (
    <div className="px-4 py-2 bg-slate-50 border-t border-slate-100">
      <p className="text-[10px] text-slate-400 text-center">
        This chat is managed by IBCCF Support. Your information is processed following our{' '}
        <a href="#" className="text-orange-500 hover:underline">Terms of Use</a>
        {' '}and{' '}
        <a href="#" className="text-orange-500 hover:underline">Privacy Policy</a>.
      </p>
    </div>
  );
}

export default ChatWidget;
