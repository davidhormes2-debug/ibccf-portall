import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Users, MessageSquare, Pin, Lock, Unlock, Trash2, Search, 
  Filter, Eye, Clock, Shield, RefreshCw, Edit3, Plus, 
  AlertTriangle, CheckCircle, TrendingUp, FileText, ClipboardList, Scale
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

const ADMIN_TOKEN = "ibc-admin-session-2025";

interface Department {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  displayOrder: string;
  isActive: boolean;
}

interface Thread {
  id: number;
  departmentId: number;
  title: string;
  content: string;
  authorType: string;
  authorHandle: string;
  isPinned: boolean;
  isLocked: boolean;
  viewCount: string;
  replyCount: string;
  lastActivityAt: string;
  createdAt: string;
}

interface CommunityStats {
  threads: string;
  posts: string;
  members: number;
  activeBots: string;
}

export function CommunityManagement() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [isEditThreadOpen, setIsEditThreadOpen] = useState(false);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [isNewAnnouncementOpen, setIsNewAnnouncementOpen] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementContent, setAnnouncementContent] = useState("");
  const [announcementDepartment, setAnnouncementDepartment] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stats, isLoading: statsLoading } = useQuery<CommunityStats>({
    queryKey: ["/api/community/stats"],
    queryFn: async () => {
      const res = await fetch("/api/community/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    }
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
    queryFn: async () => {
      const res = await fetch("/api/departments");
      if (!res.ok) throw new Error("Failed to fetch departments");
      return res.json();
    }
  });

  const { data: threads = [], isLoading: threadsLoading, refetch: refetchThreads } = useQuery<Thread[]>({
    queryKey: ["/api/community/threads", selectedDepartment, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedDepartment !== "all") params.append("departmentId", selectedDepartment);
      if (searchQuery) params.append("search", searchQuery);
      params.append("limit", "100");
      const res = await fetch(`/api/community/threads?${params}`);
      if (!res.ok) throw new Error("Failed to fetch threads");
      return res.json();
    }
  });

  const pinThreadMutation = useMutation({
    mutationFn: async ({ threadId, isPinned }: { threadId: number; isPinned: boolean }) => {
      const res = await fetch(`/api/community/threads/${threadId}`, {
        method: "PATCH",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ADMIN_TOKEN}`
        },
        body: JSON.stringify({ isPinned })
      });
      if (!res.ok) throw new Error("Failed to update thread");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/threads"] });
      toast({ title: "Thread Updated", description: "Pin status changed successfully." });
    }
  });

  const lockThreadMutation = useMutation({
    mutationFn: async ({ threadId, isLocked }: { threadId: number; isLocked: boolean }) => {
      const res = await fetch(`/api/community/threads/${threadId}`, {
        method: "PATCH",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ADMIN_TOKEN}`
        },
        body: JSON.stringify({ isLocked })
      });
      if (!res.ok) throw new Error("Failed to update thread");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/threads"] });
      toast({ title: "Thread Updated", description: "Lock status changed successfully." });
    }
  });

  const deleteThreadMutation = useMutation({
    mutationFn: async (threadId: number) => {
      const res = await fetch(`/api/community/threads/${threadId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
      });
      if (!res.ok) throw new Error("Failed to delete thread");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/community/stats"] });
      toast({ title: "Thread Deleted", description: "Thread has been removed." });
    }
  });

  const createAnnouncementMutation = useMutation({
    mutationFn: async (data: { departmentId: number; title: string; content: string }) => {
      const res = await fetch("/api/community/threads", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ADMIN_TOKEN}`
        },
        body: JSON.stringify({ 
          ...data, 
          authorHandle: "IBCCF_Admin",
          authorType: "admin",
          isPinned: true
        })
      });
      if (!res.ok) throw new Error("Failed to create announcement");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/community/stats"] });
      setIsNewAnnouncementOpen(false);
      setAnnouncementTitle("");
      setAnnouncementContent("");
      setAnnouncementDepartment("");
      toast({ title: "Announcement Created", description: "New pinned announcement has been posted." });
    }
  });

  const seedCommunityMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/seed-community", {
        method: "POST",
        headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
      });
      if (!res.ok) throw new Error("Failed to seed community");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/community/stats"] });
      toast({ 
        title: "Community Seeded", 
        description: `Created ${data.botsCreated} bot profiles and ${data.threadsCreated} discussion threads.` 
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to seed community data", variant: "destructive" });
    }
  });

  const getDepartment = (id: number) => departments.find(d => d.id === id);

  const handleCreateAnnouncement = () => {
    if (!announcementTitle.trim() || !announcementContent.trim() || !announcementDepartment) {
      toast({ title: "Missing Fields", description: "Please fill in all fields", variant: "destructive" });
      return;
    }
    createAnnouncementMutation.mutate({
      departmentId: parseInt(announcementDepartment),
      title: announcementTitle,
      content: announcementContent
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Community Management</h2>
          <p className="text-slate-400 text-sm">Moderate discussions, manage departments, and engage with community members.</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
            onClick={() => seedCommunityMutation.mutate()}
            disabled={seedCommunityMutation.isPending}
            data-testid="button-seed-community"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${seedCommunityMutation.isPending ? 'animate-spin' : ''}`} />
            Seed Bot Activity
          </Button>
          <Button 
            onClick={() => setIsNewAnnouncementOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white"
            data-testid="button-new-announcement"
          >
            <Plus className="w-4 h-4 mr-2" /> New Announcement
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-600 to-blue-700 text-white border-0" data-testid="card-admin-stat-members">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">Total Members</p>
                <p className="text-3xl font-bold">{statsLoading ? "..." : stats?.members || 0}</p>
              </div>
              <Users className="w-10 h-10 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700" data-testid="card-admin-stat-threads">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">Active Threads</p>
                <p className="text-3xl font-bold text-white">{statsLoading ? "..." : stats?.threads || 0}</p>
              </div>
              <MessageSquare className="w-10 h-10 text-slate-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700" data-testid="card-admin-stat-posts">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">Total Replies</p>
                <p className="text-3xl font-bold text-white">{statsLoading ? "..." : stats?.posts || 0}</p>
              </div>
              <MessageSquare className="w-10 h-10 text-slate-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700" data-testid="card-admin-stat-departments">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">Departments</p>
                <p className="text-3xl font-bold text-white">{departments.length}</p>
              </div>
              <Shield className="w-10 h-10 text-slate-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="threads" className="space-y-4">
        <TabsList className="bg-slate-800 border-slate-700">
          <TabsTrigger value="threads" className="data-[state=active]:bg-slate-700" data-testid="subtab-threads">
            <MessageSquare className="w-4 h-4 mr-2" /> Discussion Threads
          </TabsTrigger>
          <TabsTrigger value="departments" className="data-[state=active]:bg-slate-700" data-testid="subtab-departments">
            <Shield className="w-4 h-4 mr-2" /> Departments
          </TabsTrigger>
        </TabsList>

        <TabsContent value="threads">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="border-b border-slate-800 pb-4">
              <div className="flex flex-col sm:flex-row gap-4 justify-between">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      placeholder="Search threads..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 bg-slate-800 border-slate-700 text-white w-64"
                      data-testid="input-admin-search-threads"
                    />
                  </div>
                  <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                    <SelectTrigger className="w-48 bg-slate-800 border-slate-700 text-white" data-testid="select-department-filter">
                      <Filter className="w-4 h-4 mr-2" />
                      <SelectValue placeholder="All Departments" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="all" className="text-white">All Departments</SelectItem>
                      {departments.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id.toString()} className="text-white">
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="ghost" onClick={() => refetchThreads()} className="text-slate-400 hover:text-white">
                  <RefreshCw className="w-4 h-4 mr-2" /> Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {threadsLoading ? (
                <div className="p-8 text-center text-slate-500">Loading threads...</div>
              ) : threads.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No threads found</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="divide-y divide-slate-800">
                    {threads.map((thread) => {
                      const dept = getDepartment(thread.departmentId);
                      return (
                        <div 
                          key={thread.id} 
                          className={`p-4 hover:bg-slate-800/50 transition-colors ${thread.isPinned ? 'bg-blue-950/20' : ''}`}
                          data-testid={`admin-thread-row-${thread.id}`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                {thread.isPinned && (
                                  <Badge variant="secondary" className="bg-blue-600/20 text-blue-400 text-xs">
                                    <Pin className="w-3 h-3 mr-1" />Pinned
                                  </Badge>
                                )}
                                {thread.isLocked && (
                                  <Badge variant="outline" className="border-yellow-500 text-yellow-500 text-xs">
                                    <Lock className="w-3 h-3 mr-1" />Locked
                                  </Badge>
                                )}
                                {dept && (
                                  <Badge variant="outline" className="text-xs" style={{ borderColor: dept.color, color: dept.color }}>
                                    {dept.name}
                                  </Badge>
                                )}
                                <Badge variant="outline" className="text-xs text-slate-400 border-slate-600">
                                  {thread.authorType === 'bot' ? 'Bot' : thread.authorType === 'admin' ? 'Admin' : 'User'}
                                </Badge>
                              </div>
                              <h3 className="font-semibold text-white truncate">{thread.title}</h3>
                              <p className="text-sm text-slate-400 line-clamp-1 mt-1">{thread.content}</p>
                              <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                                <span>{thread.authorHandle}</span>
                                <span className="flex items-center gap-1">
                                  <Eye className="w-3 h-3" />{thread.viewCount}
                                </span>
                                <span className="flex items-center gap-1">
                                  <MessageSquare className="w-3 h-3" />{thread.replyCount} replies
                                </span>
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {formatDistanceToNow(new Date(thread.lastActivityAt), { addSuffix: true })}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => pinThreadMutation.mutate({ threadId: thread.id, isPinned: !thread.isPinned })}
                                className={thread.isPinned ? "text-blue-400 hover:text-blue-300" : "text-slate-400 hover:text-white"}
                                data-testid={`button-pin-thread-${thread.id}`}
                              >
                                <Pin className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => lockThreadMutation.mutate({ threadId: thread.id, isLocked: !thread.isLocked })}
                                className={thread.isLocked ? "text-yellow-400 hover:text-yellow-300" : "text-slate-400 hover:text-white"}
                                data-testid={`button-lock-thread-${thread.id}`}
                              >
                                {thread.isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (confirm("Are you sure you want to delete this thread?")) {
                                    deleteThreadMutation.mutate(thread.id);
                                  }
                                }}
                                className="text-red-400 hover:text-red-300 hover:bg-red-500/20"
                                data-testid={`button-delete-thread-${thread.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map((dept) => (
              <Card key={dept.id} className="bg-slate-900 border-slate-800" data-testid={`card-department-${dept.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: dept.color + '20', color: dept.color }}
                      >
                        <Shield className="w-5 h-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base text-white">{dept.name}</CardTitle>
                        <p className="text-xs text-slate-500">{dept.key}</p>
                      </div>
                    </div>
                    <Badge variant={dept.isActive ? "secondary" : "outline"} className={dept.isActive ? "bg-green-600/20 text-green-400" : "text-slate-500"}>
                      {dept.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-400 mb-4">{dept.description}</p>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Display Order: {dept.displayOrder}</span>
                    <span>Color: {dept.color}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isNewAnnouncementOpen} onOpenChange={setIsNewAnnouncementOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Announcement</DialogTitle>
            <DialogDescription className="text-slate-400">
              Post a pinned announcement to a department channel.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="text-slate-400 mb-2 block">Department</Label>
              <Select value={announcementDepartment} onValueChange={setAnnouncementDepartment}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white" data-testid="select-announcement-department">
                  <SelectValue placeholder="Select a department" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id.toString()} className="text-white">
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-400 mb-2 block">Title</Label>
              <Input
                placeholder="Announcement title"
                value={announcementTitle}
                onChange={(e) => setAnnouncementTitle(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                data-testid="input-announcement-title"
              />
            </div>
            <div>
              <Label className="text-slate-400 mb-2 block">Content</Label>
              <Textarea
                placeholder="Write your announcement..."
                value={announcementContent}
                onChange={(e) => setAnnouncementContent(e.target.value)}
                rows={5}
                className="bg-slate-800 border-slate-700 text-white"
                data-testid="input-announcement-content"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsNewAnnouncementOpen(false)} className="text-slate-400">
              Cancel
            </Button>
            <Button 
              onClick={handleCreateAnnouncement}
              disabled={createAnnouncementMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-submit-announcement"
            >
              {createAnnouncementMutation.isPending ? "Creating..." : "Post Announcement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
