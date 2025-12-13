import { useState, useRef, useEffect, forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

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
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 h-[500px] bg-white rounded-lg shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
            data-testid="chat-panel"
            role="dialog"
            aria-label="Support chat window"
            aria-modal="true"
          >
            <ChatHeader 
              title={title} 
              subtitle={subtitle} 
              onClose={onToggle} 
            />
            
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
      whileHover={{ scale: 1.1 }}
      className="fixed bottom-6 right-6 w-16 h-16 bg-primary text-white rounded-full shadow-2xl flex items-center justify-center z-50"
      onClick={onClick}
      data-testid="button-chat-float"
      aria-label={unreadCount > 0 ? `Open support chat. ${unreadCount} unread messages` : "Open support chat"}
      aria-haspopup="dialog"
    >
      <MessageCircle className="w-7 h-7" aria-hidden="true" />
      {unreadCount > 0 && (
        <span 
          className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold"
          aria-label={`${unreadCount} unread messages`}
        >
          {unreadCount}
        </span>
      )}
    </motion.button>
  );
}

interface ChatHeaderProps {
  title: string;
  subtitle: string;
  onClose: () => void;
}

function ChatHeader({ title, subtitle, onClose }: ChatHeaderProps) {
  return (
    <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3 flex justify-between items-center">
      <div className="flex items-center gap-3">
        <div className="relative">
          <MessageCircle className="h-5 w-5" />
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full border border-blue-600"></span>
        </div>
        <div>
          <span className="font-semibold block">{title}</span>
          <span className="text-xs text-blue-200">{subtitle}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-white hover:bg-blue-700"
        onClick={onClose}
        data-testid="button-close-chat"
        aria-label="Close chat"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
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
        className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50"
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full" role="status" aria-label="Loading messages">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" aria-hidden="true" />
          </div>
        ) : messages.length === 0 ? (
          <EmptyChat />
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}
      </div>
    );
  }
);
ChatMessages.displayName = 'ChatMessages';

function EmptyChat() {
  return (
    <div className="text-center text-slate-500 mt-8">
      <div className="w-16 h-16 bg-blue-100 rounded-full mx-auto flex items-center justify-center mb-4">
        <MessageCircle className="h-8 w-8 text-blue-500" />
      </div>
      <p className="font-medium text-slate-700 mb-1">Welcome to IBCCF Support</p>
      <p className="text-sm text-slate-500">How can we help you today?</p>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.sender === 'user';
  const formattedTime = message.createdAt 
    ? format(new Date(message.createdAt), 'HH:mm')
    : '';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-2 flex-shrink-0">
          <span className="text-blue-600 font-bold text-xs">IBCCF</span>
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 ${
          isUser 
            ? 'bg-blue-600 text-white rounded-br-none' 
            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-sm'
        }`}
        data-testid={`chat-message-${message.id}`}
      >
        <p className="text-sm whitespace-pre-wrap">{message.message}</p>
        {formattedTime && (
          <p className={`text-[10px] mt-1 ${isUser ? 'text-blue-200' : 'text-slate-400'}`}>
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
      <div className="flex items-center gap-2" role="group" aria-label="Message input">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyPress={onKeyPress}
          placeholder="Type your message..."
          className="flex-1"
          disabled={isSending}
          data-testid="input-chat-message"
          aria-label="Message text"
        />
        <Button 
          onClick={onSend} 
          size="icon" 
          disabled={!value.trim() || isSending}
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

export default ChatWidget;
