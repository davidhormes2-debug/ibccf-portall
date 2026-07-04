import { useState, useEffect, useRef } from "react";
import { useChatAutoScroll } from "@/hooks/use-chat-autoscroll";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { 
  MessageCircle, Users, ArrowLeft, Send, Bell, BellOff, 
  RefreshCw, Menu, X, Shield, LogOut, Search, Clock, User
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface Case {
  id: string;
  accessCode: string;
  userName: string | null;
  userEmail: string | null;
  status: string;
  createdAt: string;
}

interface ChatMessage {
  id: number;
  caseId: string;
  message: string;
  sender: "admin" | "user";
  isRead: string;
  createdAt: string;
}

type View = "cases" | "chat";

export default function MobileAdminChat() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentView, setCurrentView] = useState<View>("cases");
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const _queryClient = useQueryClient();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const storedToken = sessionStorage.getItem('adminToken');
    if (storedToken) {
      setAuthToken(storedToken);
      setIsLoggedIn(true);
    }
    
    // Service-worker registration is handled globally in main.tsx (with an
    // environment guard and a tagged warning on failure).  Do not duplicate it
    // here — a bare .catch(console.error) logs raw error objects to the
    // console on every mount and fires in dev mode where the SW isn't served.
  }, []);

  const getAuthHeaders = (): Record<string, string> => {
    const token = authToken || sessionStorage.getItem('adminToken');
    return token ? { "Authorization": `Bearer ${token}` } : {};
  };

  const { data: cases = [], isLoading: casesLoading, refetch: refetchCases } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
    queryFn: async () => {
      const res = await fetch("/api/cases", {
        headers: getAuthHeaders()
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isLoggedIn && !!authToken,
    refetchInterval: 5000,
  });

  const { data: messages = [], refetch: refetchMessages } = useQuery<ChatMessage[]>({
    queryKey: ["/api/cases/messages", selectedCase?.id],
    queryFn: async () => {
      if (!selectedCase) return [];
      const res = await fetch(`/api/cases/${selectedCase.id}/messages`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isLoggedIn && !!selectedCase && !!authToken,
    refetchInterval: 3000,
  });

  const { data: unreadCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/messages/unread/all"],
    queryFn: async () => {
      const res = await fetch("/api/messages/unread/all", {
        headers: getAuthHeaders()
      });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: isLoggedIn && !!authToken,
    refetchInterval: 5000,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/cases/${selectedCase?.id}/messages`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({ message: content, sender: "admin" }),
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      setMessageInput("");
      refetchMessages();
    },
  });

  // Sticky-bottom auto-scroll: only follow new messages when the user
  // is already near the bottom of the chat container.
  const { onScroll: handleMessagesScroll } = useChatAutoScroll(messagesContainerRef, [messages]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const data = await res.json();
        const token = typeof data?.token === "string" ? data.token : "";
        if (!token) {
          toast({ variant: "destructive", title: "Login failed", description: "Server did not return a session token" });
          return;
        }
        sessionStorage.setItem("adminToken", token);
        setAuthToken(token);
        setIsLoggedIn(true);
        toast({ title: "Welcome back!", description: "Logged in successfully" });
      } else if (res.status === 429) {
        toast({
          variant: "destructive",
          title: "Too many attempts",
          description: "Please wait 15 minutes before trying again.",
        });
      } else {
        toast({ variant: "destructive", title: "Login failed", description: "Invalid credentials" });
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Connection failed" });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    const token = authToken || sessionStorage.getItem("adminToken");
    if (token) {
      try {
        await fetch("/api/admin/logout", {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
        });
      } catch {
        // ignore — we still want to clear local state
      }
    }
    sessionStorage.removeItem("adminToken");
    sessionStorage.removeItem("adminAuthenticated");
    setAuthToken(null);
    setIsLoggedIn(false);
    setSelectedCase(null);
    setCurrentView("cases");
    setShowMenu(false);
  };

  const enableNotifications = async () => {
    if (!("Notification" in window)) {
      toast({ variant: "destructive", title: "Not supported", description: "Notifications not available" });
      return;
    }
    
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotificationsEnabled(true);
      toast({ title: "Notifications enabled", description: "You'll receive alerts for new messages" });
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;
    sendMessageMutation.mutate(messageInput);
  };

  const openChat = (caseItem: Case) => {
    setSelectedCase(caseItem);
    setCurrentView("chat");
  };

  const filteredCases = cases.filter(c => 
    c.userName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.accessCode.includes(searchQuery) ||
    c.userEmail?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const casesWithChats = filteredCases.filter(c => 
    (unreadCounts[c.id] || 0) > 0 || c.status === 'active'
  );

  if (!isLoggedIn) {
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
        style={{
          background: 'radial-gradient(ellipse at top, #0a1628 0%, #050912 50%, #02050a 100%)',
        }}
      >
        <div className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.4) 0%, transparent 100%), radial-gradient(1px 1px at 70% 60%, rgba(96,165,250,0.4) 0%, transparent 100%), radial-gradient(1px 1px at 40% 80%, rgba(255,255,255,0.3) 0%, transparent 100%)',
          }}
        />
        <motion.div 
          initial={{ opacity: 0, y: 20 }} 
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm relative"
        >
          <div className="text-center mb-8">
            <div className="relative w-16 h-16 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full bg-blue-500 blur-xl opacity-40" />
              <div
                className="relative w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-[#004182] via-[#0a3a8c] to-[#001a3d] border border-blue-400/20"
                style={{ boxShadow: '0 8px 24px rgba(0,65,130,0.4), inset 0 1px 0 rgba(255,255,255,0.12)' }}
              >
                <Shield className="h-8 w-8 text-white" />
              </div>
            </div>
            <h1 className="text-xl font-bold text-white">IBCCF Admin</h1>
            <p className="text-slate-400 text-sm">Mobile Chat Console</p>
          </div>
          
          <form
            onSubmit={handleLogin}
            className="space-y-4 p-6 rounded-2xl border border-slate-700/40"
            style={{
              background: 'linear-gradient(135deg, rgba(15,23,42,0.85) 0%, rgba(2,9,18,0.85) 100%)',
              backdropFilter: 'blur(16px)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
          >
            <Input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={isLoggingIn}
              className="bg-slate-900/70 border-slate-700 text-white focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30"
              data-testid="input-mobile-username"
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={isLoggingIn}
              className="bg-slate-900/70 border-slate-700 text-white focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30"
              data-testid="input-mobile-password"
            />
            <Button
              type="submit"
              disabled={isLoggingIn || !username || !password}
              className="w-full text-white border-0 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #004182 0%, #0a3a8c 100%)',
                boxShadow: '0 4px 16px rgba(0,65,130,0.4), inset 0 1px 0 rgba(255,255,255,0.12)',
              }}
              data-testid="button-mobile-login"
            >
              {isLoggingIn ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </motion.div>
      </main>
    );
  }

  if (currentView === "chat" && selectedCase) {
    return (
      <main id="main-content" tabIndex={-1} className="h-screen bg-slate-900 flex flex-col">
        <header className="bg-slate-800 px-4 py-3 flex items-center gap-3 border-b border-slate-700 safe-area-top">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setCurrentView("cases")}
            className="text-white"
            data-testid="button-back-cases"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-medium truncate">
              {selectedCase.userName || "Unknown User"}
            </h2>
            <p className="text-slate-400 text-xs truncate">
              Code: {selectedCase.accessCode}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetchMessages()}
            className="text-slate-400"
            data-testid="button-refresh-chat"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </header>

        <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center text-slate-500 py-12">
              <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No messages yet</p>
            </div>
          ) : (
            messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.sender === "admin" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                    msg.sender === "admin"
                      ? "bg-[#004182] text-white rounded-br-sm"
                      : "bg-slate-700 text-white rounded-bl-sm"
                  }`}
                  data-testid={`message-${msg.id}`}
                >
                  <p className="text-sm">{msg.message}</p>
                  <p className="text-[10px] opacity-60 mt-1">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </motion.div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form 
          onSubmit={handleSendMessage} 
          className="bg-slate-800 p-3 border-t border-slate-700 flex gap-2 safe-area-bottom"
        >
          <Input
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-slate-700 border-slate-600 text-white"
            data-testid="input-chat-message"
          />
          <Button 
            type="submit" 
            size="icon" 
            className="bg-[#004182] hover:bg-[#003366]"
            disabled={sendMessageMutation.isPending}
            data-testid="button-send-message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-slate-900">
      <header className="bg-slate-800 px-4 py-3 flex items-center justify-between border-b border-slate-700 sticky top-0 z-10 safe-area-top">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#004182]/20 flex items-center justify-center">
            <Shield className="h-4 w-4 text-[#004182]" />
          </div>
          <h1 className="text-white font-semibold">IBCCF Chat</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetchCases()}
            className="text-slate-400"
            data-testid="button-refresh-cases"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowMenu(!showMenu)}
            className="text-slate-400"
            data-testid="button-menu"
          >
            {showMenu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </header>

      <AnimatePresence>
        {showMenu && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-16 right-4 bg-slate-800 rounded-xl shadow-xl border border-slate-700 p-2 z-20"
          >
            <Button
              variant="ghost"
              className="w-full justify-start text-white"
              onClick={notificationsEnabled ? undefined : enableNotifications}
              data-testid="button-notifications"
            >
              {notificationsEnabled ? (
                <>
                  <Bell className="h-4 w-4 mr-2 text-green-500" />
                  Notifications On
                </>
              ) : (
                <>
                  <BellOff className="h-4 w-4 mr-2" />
                  Enable Notifications
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start text-red-400"
              onClick={handleLogout}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-4">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search cases..."
            className="pl-10 bg-slate-800 border-slate-700 text-white"
            data-testid="input-search-cases"
          />
        </div>

        <div className="flex items-center gap-2 mb-4">
          <Users className="h-4 w-4 text-slate-400" />
          <span className="text-slate-400 text-sm">
            {casesWithChats.length} Active Conversations
          </span>
        </div>

        {casesLoading ? (
          <div className="text-center py-12">
            <RefreshCw className="h-8 w-8 text-slate-500 animate-spin mx-auto" />
          </div>
        ) : casesWithChats.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No active conversations</p>
          </div>
        ) : (
          <div className="space-y-2">
            {casesWithChats.map((caseItem) => (
              <motion.button
                key={caseItem.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => openChat(caseItem)}
                className="w-full bg-slate-800 rounded-xl p-4 text-left active:bg-slate-700 transition-colors"
                data-testid={`case-${caseItem.accessCode}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                      <User className="h-5 w-5 text-slate-400" />
                    </div>
                    <div>
                      <h3 className="text-white font-medium">
                        {caseItem.userName || "Unknown User"}
                      </h3>
                      <p className="text-slate-500 text-xs">
                        Code: {caseItem.accessCode}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {(unreadCounts[caseItem.id] || 0) > 0 && (
                      <span className="bg-[#004182] text-white text-xs px-2 py-0.5 rounded-full">
                        {unreadCounts[caseItem.id]}
                      </span>
                    )}
                    <span className="text-slate-500 text-xs flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(caseItem.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .safe-area-top {
          padding-top: max(0.75rem, env(safe-area-inset-top));
        }
        .safe-area-bottom {
          padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
        }
      `}</style>
    </main>
  );
}
