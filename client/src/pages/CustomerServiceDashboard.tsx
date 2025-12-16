import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { 
  MessageCircle, Users, Send, Bell, BellOff, RefreshCw, Search, Clock, User,
  LayoutDashboard, Settings, BarChart3, Eye, LogOut, Shield, Menu, X, 
  Globe, Monitor, Smartphone, Tablet, MapPin, Circle, Play, MessageSquare,
  Star, TrendingUp, AlertCircle, CheckCircle2, Zap, Bot
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
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

interface ActiveVisitor {
  id: number;
  visitorId: string;
  caseId: string | null;
  currentPage: string;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  country: string | null;
  city: string | null;
  isIdle: boolean;
  hasActiveChat: boolean;
  pagesViewed: string[];
  pageViewCount: number;
  sessionStartedAt: string;
  lastHeartbeatAt: string;
}

type TabValue = "dashboard" | "conversations" | "visitors" | "statistics" | "settings";

export default function CustomerServiceDashboard() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [activeTab, setActiveTab] = useState<TabValue>("dashboard");
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isAvailable, setIsAvailable] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = sessionStorage.getItem('adminToken');
    if (storedToken) {
      setAuthToken(storedToken);
      setIsLoggedIn(true);
    }
  }, []);

  const getAuthHeaders = (): Record<string, string> => {
    const token = authToken || sessionStorage.getItem('adminToken');
    return token ? { "Authorization": `Bearer ${token}` } : {};
  };

  const { data: cases = [], refetch: refetchCases } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
    queryFn: async () => {
      const res = await fetch("/api/cases", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isLoggedIn && !!authToken,
    refetchInterval: 5000,
  });

  const { data: activeVisitors = [] } = useQuery<ActiveVisitor[]>({
    queryKey: ["/api/visitors/active"],
    queryFn: async () => {
      const res = await fetch("/api/visitors/active", { headers: getAuthHeaders() });
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
      const res = await fetch(`/api/cases/${selectedCase.id}/messages`, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isLoggedIn && !!selectedCase && !!authToken,
    refetchInterval: 3000,
  });

  const { data: unreadCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/messages/unread/all"],
    queryFn: async () => {
      const res = await fetch("/api/messages/unread/all", { headers: getAuthHeaders() });
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
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username === "Admin2025" && password === "Admin123456789") {
      const token = "ibc-admin-session-2025";
      sessionStorage.setItem('adminToken', token);
      setAuthToken(token);
      setIsLoggedIn(true);
      toast({ title: "Welcome back", description: "Logged in successfully" });
    } else {
      toast({ variant: "destructive", title: "Invalid credentials" });
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('adminToken');
    setAuthToken(null);
    setIsLoggedIn(false);
  };

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  const filteredCases = cases.filter(c => 
    c.userName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.accessCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.userEmail?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getDeviceIcon = (deviceType: string | null) => {
    switch (deviceType) {
      case 'mobile': return <Smartphone className="h-4 w-4" />;
      case 'tablet': return <Tablet className="h-4 w-4" />;
      default: return <Monitor className="h-4 w-4" />;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getSessionDuration = (startTime: string) => {
    const start = new Date(startTime).getTime();
    const now = Date.now();
    const minutes = Math.floor((now - start) / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
            <CardHeader className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Shield className="h-8 w-8 text-blue-400" />
              </div>
              <CardTitle className="text-white text-xl">Customer Service Portal</CardTitle>
              <p className="text-slate-400 text-sm">Sign in to manage support</p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <Input
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-slate-900/50 border-slate-600 text-white"
                  data-testid="input-username"
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-slate-900/50 border-slate-600 text-white"
                  data-testid="input-password"
                />
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" data-testid="button-login">
                  Sign In
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-blue-400" />
          <span className="font-semibold text-white hidden sm:block">IBCCF Support</span>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-4">
            <span className="text-sm text-slate-400 hidden sm:block">Status:</span>
            <Switch checked={isAvailable} onCheckedChange={setIsAvailable} />
            <Badge variant={isAvailable ? "default" : "secondary"} className={isAvailable ? "bg-green-500" : ""}>
              {isAvailable ? "Online" : "Away"}
            </Badge>
          </div>
          
          <Button variant="ghost" size="icon" onClick={() => setNotificationsEnabled(!notificationsEnabled)} className="text-slate-400">
            {notificationsEnabled ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
          </Button>
          
          <Button variant="ghost" size="icon" onClick={() => refetchCases()} className="text-slate-400">
            <RefreshCw className="h-5 w-5" />
          </Button>
          
          <Button variant="ghost" size="icon" onClick={handleLogout} className="text-slate-400">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        <nav className="lg:w-64 bg-slate-800/50 border-b lg:border-b-0 lg:border-r border-slate-700 p-2 lg:p-4">
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible">
            {[
              { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
              { id: "conversations", label: "Conversations", icon: MessageCircle, badge: totalUnread },
              { id: "visitors", label: "Visitors", icon: Eye, badge: activeVisitors.length },
              { id: "statistics", label: "Statistics", icon: BarChart3 },
              { id: "settings", label: "Settings", icon: Settings },
            ].map((item) => (
              <Button
                key={item.id}
                variant={activeTab === item.id ? "secondary" : "ghost"}
                className={`justify-start gap-2 flex-shrink-0 ${activeTab === item.id ? "bg-blue-600 text-white" : "text-slate-400"}`}
                onClick={() => setActiveTab(item.id as TabValue)}
                data-testid={`nav-${item.id}`}
              >
                <item.icon className="h-4 w-4" />
                <span className="hidden lg:inline">{item.label}</span>
                {item.badge ? (
                  <Badge variant="destructive" className="ml-auto text-xs">
                    {item.badge}
                  </Badge>
                ) : null}
              </Button>
            ))}
          </div>
        </nav>

        <main className="flex-1 p-4 overflow-auto">
          <AnimatePresence mode="wait">
            {activeTab === "dashboard" && (
              <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <h2 className="text-xl font-semibold text-white mb-4">Dashboard Overview</h2>
                
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <Card className="bg-slate-800 border-slate-700">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-slate-400 text-sm">Active Visitors</p>
                          <p className="text-2xl font-bold text-white">{activeVisitors.length}</p>
                        </div>
                        <Eye className="h-8 w-8 text-blue-400" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-800 border-slate-700">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-slate-400 text-sm">Pending Chats</p>
                          <p className="text-2xl font-bold text-white">{totalUnread}</p>
                        </div>
                        <MessageCircle className="h-8 w-8 text-orange-400" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-800 border-slate-700">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-slate-400 text-sm">Total Cases</p>
                          <p className="text-2xl font-bold text-white">{cases.length}</p>
                        </div>
                        <Users className="h-8 w-8 text-green-400" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-800 border-slate-700">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-slate-400 text-sm">Satisfaction</p>
                          <p className="text-2xl font-bold text-white">4.8</p>
                        </div>
                        <Star className="h-8 w-8 text-yellow-400" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid lg:grid-cols-2 gap-4">
                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-white text-lg flex items-center gap-2">
                        <Zap className="h-5 w-5 text-yellow-400" /> Recent Activity
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {activeVisitors.slice(0, 5).map((visitor) => (
                        <div key={visitor.id} className="flex items-center gap-3 p-2 rounded bg-slate-700/50">
                          {getDeviceIcon(visitor.deviceType)}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{visitor.currentPage}</p>
                            <p className="text-xs text-slate-400">{visitor.country || 'Unknown'} • {getSessionDuration(visitor.sessionStartedAt)}</p>
                          </div>
                          <Circle className={`h-2 w-2 ${visitor.isIdle ? 'text-yellow-400' : 'text-green-400'} fill-current`} />
                        </div>
                      ))}
                      {activeVisitors.length === 0 && (
                        <p className="text-slate-400 text-sm text-center py-4">No active visitors</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-white text-lg flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-orange-400" /> Pending Messages
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {filteredCases.filter(c => unreadCounts[c.id] > 0).slice(0, 5).map((c) => (
                        <div 
                          key={c.id} 
                          className="flex items-center gap-3 p-2 rounded bg-slate-700/50 cursor-pointer hover:bg-slate-700"
                          onClick={() => { setSelectedCase(c); setActiveTab("conversations"); }}
                        >
                          <User className="h-4 w-4 text-slate-400" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{c.userName || c.accessCode}</p>
                            <p className="text-xs text-slate-400">{unreadCounts[c.id]} unread messages</p>
                          </div>
                          <Badge variant="destructive" className="text-xs">{unreadCounts[c.id]}</Badge>
                        </div>
                      ))}
                      {Object.keys(unreadCounts).length === 0 && (
                        <p className="text-slate-400 text-sm text-center py-4">No pending messages</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </motion.div>
            )}

            {activeTab === "conversations" && (
              <motion.div key="conversations" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                <div className="flex flex-col lg:flex-row gap-4 h-full">
                  <div className="lg:w-80 flex-shrink-0">
                    <div className="mb-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <Input
                          placeholder="Search conversations..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-9 bg-slate-800 border-slate-700 text-white"
                          data-testid="input-search"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                      {filteredCases.map((c) => (
                        <div
                          key={c.id}
                          className={`p-3 rounded-lg cursor-pointer transition-colors ${
                            selectedCase?.id === c.id ? 'bg-blue-600' : 'bg-slate-800 hover:bg-slate-700'
                          }`}
                          onClick={() => setSelectedCase(c)}
                          data-testid={`conversation-${c.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                              <User className="h-5 w-5 text-slate-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-white truncate">
                                  {c.userName || c.accessCode}
                                </p>
                                {unreadCounts[c.id] > 0 && (
                                  <Badge variant="destructive" className="text-xs ml-2">
                                    {unreadCounts[c.id]}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 truncate">{c.userEmail || 'No email'}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col bg-slate-800 rounded-lg">
                    {selectedCase ? (
                      <>
                        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-white">{selectedCase.userName || selectedCase.accessCode}</h3>
                            <p className="text-sm text-slate-400">{selectedCase.userEmail}</p>
                          </div>
                          <Badge variant="outline" className="text-slate-400">{selectedCase.status}</Badge>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[50vh]">
                          {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.sender === 'admin' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[80%] p-3 rounded-lg ${
                                msg.sender === 'admin' 
                                  ? 'bg-blue-600 text-white' 
                                  : 'bg-slate-700 text-white'
                              }`}>
                                <p className="text-sm">{msg.message}</p>
                                <p className="text-xs opacity-70 mt-1">{formatTime(msg.createdAt)}</p>
                              </div>
                            </div>
                          ))}
                          <div ref={messagesEndRef} />
                        </div>
                        
                        <div className="p-4 border-t border-slate-700">
                          <div className="flex gap-2">
                            <Input
                              placeholder="Type a message..."
                              value={messageInput}
                              onChange={(e) => setMessageInput(e.target.value)}
                              onKeyPress={(e) => e.key === 'Enter' && sendMessageMutation.mutate(messageInput)}
                              className="bg-slate-900 border-slate-700 text-white"
                              data-testid="input-message"
                            />
                            <Button 
                              onClick={() => sendMessageMutation.mutate(messageInput)}
                              disabled={!messageInput.trim()}
                              className="bg-blue-600 hover:bg-blue-700"
                              data-testid="button-send"
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-slate-400">
                        <div className="text-center">
                          <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p>Select a conversation to start chatting</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "visitors" && (
              <motion.div key="visitors" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-white">Active Visitors ({activeVisitors.length})</h2>
                  <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/visitors/active"] })}>
                    <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                  </Button>
                </div>
                
                <div className="grid gap-4">
                  {activeVisitors.map((visitor) => (
                    <Card key={visitor.id} className="bg-slate-800 border-slate-700">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center">
                              {getDeviceIcon(visitor.deviceType)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white">
                                  {visitor.caseId ? `Case ${visitor.caseId.slice(0, 8)}...` : 'Anonymous Visitor'}
                                </span>
                                <Circle className={`h-2 w-2 ${visitor.isIdle ? 'text-yellow-400' : 'text-green-400'} fill-current`} />
                                <span className="text-xs text-slate-400">{visitor.isIdle ? 'Idle' : 'Active'}</span>
                              </div>
                              <div className="flex items-center gap-4 mt-1 text-sm text-slate-400">
                                <span className="flex items-center gap-1">
                                  <Globe className="h-3 w-3" /> {visitor.country || 'Unknown'}
                                </span>
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" /> {visitor.city || 'Unknown'}
                                </span>
                                <span>{visitor.browser} / {visitor.os}</span>
                              </div>
                              <div className="mt-2">
                                <p className="text-sm text-slate-300">
                                  <span className="text-slate-400">Current page:</span> {visitor.currentPage}
                                </p>
                                <p className="text-xs text-slate-400 mt-1">
                                  {visitor.pageViewCount} pages viewed • Session: {getSessionDuration(visitor.sessionStartedAt)}
                                </p>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="text-blue-400 border-blue-400 hover:bg-blue-400/10">
                              <Play className="h-3 w-3 mr-1" /> Start Chat
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  
                  {activeVisitors.length === 0 && (
                    <Card className="bg-slate-800 border-slate-700">
                      <CardContent className="p-8 text-center text-slate-400">
                        <Eye className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>No active visitors at the moment</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === "statistics" && (
              <motion.div key="statistics" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <h2 className="text-xl font-semibold text-white mb-4">Performance Statistics</h2>
                
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <Card className="bg-slate-800 border-slate-700">
                    <CardContent className="p-4 text-center">
                      <TrendingUp className="h-8 w-8 mx-auto text-green-400 mb-2" />
                      <p className="text-2xl font-bold text-white">{cases.length}</p>
                      <p className="text-sm text-slate-400">Total Conversations</p>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-800 border-slate-700">
                    <CardContent className="p-4 text-center">
                      <Clock className="h-8 w-8 mx-auto text-blue-400 mb-2" />
                      <p className="text-2xl font-bold text-white">2.5m</p>
                      <p className="text-sm text-slate-400">Avg Response Time</p>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-800 border-slate-700">
                    <CardContent className="p-4 text-center">
                      <Star className="h-8 w-8 mx-auto text-yellow-400 mb-2" />
                      <p className="text-2xl font-bold text-white">4.8</p>
                      <p className="text-sm text-slate-400">Satisfaction Score</p>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-800 border-slate-700">
                    <CardContent className="p-4 text-center">
                      <CheckCircle2 className="h-8 w-8 mx-auto text-green-400 mb-2" />
                      <p className="text-2xl font-bold text-white">95%</p>
                      <p className="text-sm text-slate-400">Resolution Rate</p>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader>
                    <CardTitle className="text-white">Chat Volume (Last 7 Days)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-48 flex items-end justify-between gap-2">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
                        <div key={day} className="flex-1 flex flex-col items-center gap-2">
                          <div 
                            className="w-full bg-blue-500 rounded-t" 
                            style={{ height: `${Math.random() * 80 + 20}%` }}
                          />
                          <span className="text-xs text-slate-400">{day}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {activeTab === "settings" && (
              <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <h2 className="text-xl font-semibold text-white mb-4">Settings</h2>
                
                <div className="space-y-4">
                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-white text-lg">Availability</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-white">Online Status</p>
                          <p className="text-sm text-slate-400">Show as available to receive chats</p>
                        </div>
                        <Switch checked={isAvailable} onCheckedChange={setIsAvailable} />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-white">Desktop Notifications</p>
                          <p className="text-sm text-slate-400">Receive alerts for new messages</p>
                        </div>
                        <Switch checked={notificationsEnabled} onCheckedChange={setNotificationsEnabled} />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-white text-lg flex items-center gap-2">
                        <Bot className="h-5 w-5" /> AI Chatbot
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-white">Auto-Response When Offline</p>
                          <p className="text-sm text-slate-400">AI will respond when you're away</p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-white">Smart Reply Suggestions</p>
                          <p className="text-sm text-slate-400">Get AI-powered response suggestions</p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-white text-lg">Working Hours</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-slate-400 text-sm">Configure when you're available for chats</p>
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm text-slate-400">Start Time</label>
                          <Input type="time" defaultValue="09:00" className="bg-slate-900 border-slate-700 text-white mt-1" />
                        </div>
                        <div>
                          <label className="text-sm text-slate-400">End Time</label>
                          <Input type="time" defaultValue="18:00" className="bg-slate-900 border-slate-700 text-white mt-1" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
