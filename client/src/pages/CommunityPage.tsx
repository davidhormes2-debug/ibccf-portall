import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { 
  Users, MessageSquare, Eye, Clock, Search, Filter, 
  ChevronRight, Plus, Shield, ArrowLeft, ThumbsUp, 
  Flag, Pin, Lock, FileText, ClipboardList, AlertTriangle, 
  Scale, TrendingUp, Home, Award, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

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

interface Post {
  id: number;
  threadId: number;
  content: string;
  authorType: string;
  authorHandle: string;
  isModeratorPost: boolean;
  likeCount: string;
  createdAt: string;
}

interface CommunityStats {
  threads: string;
  posts: string;
  members: number;
  activeBots: string;
}

const departmentIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText: FileText,
  ClipboardList: ClipboardList,
  AlertTriangle: AlertTriangle,
  Scale: Scale,
  TrendingUp: TrendingUp
};

function getInitials(handle: string): string {
  return handle.slice(0, 2).toUpperCase();
}

function getAvatarColor(handle: string): string {
  const colors = [
    "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-orange-500",
    "bg-pink-500", "bg-teal-500", "bg-indigo-500", "bg-red-500"
  ];
  const index = handle.charCodeAt(0) % colors.length;
  return colors[index];
}

export default function CommunityPage() {
  const [, navigate] = useLocation();
  const [selectedDepartment, setSelectedDepartment] = useState<number | null>(null);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isNewThreadOpen, setIsNewThreadOpen] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [newThreadContent, setNewThreadContent] = useState("");
  const [newThreadDepartment, setNewThreadDepartment] = useState<string>("");
  const [replyContent, setReplyContent] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
    queryFn: async () => {
      const res = await fetch("/api/departments");
      if (!res.ok) throw new Error("Failed to fetch departments");
      return res.json();
    }
  });

  const { data: stats } = useQuery<CommunityStats>({
    queryKey: ["/api/community/stats"],
    queryFn: async () => {
      const res = await fetch("/api/community/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    }
  });

  const { data: threads = [], isLoading: threadsLoading } = useQuery<Thread[]>({
    queryKey: ["/api/community/threads", selectedDepartment, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedDepartment) params.append("departmentId", selectedDepartment.toString());
      if (searchQuery) params.append("search", searchQuery);
      params.append("limit", "50");
      const res = await fetch(`/api/community/threads?${params}`);
      if (!res.ok) throw new Error("Failed to fetch threads");
      return res.json();
    }
  });

  const { data: posts = [], isLoading: postsLoading } = useQuery<Post[]>({
    queryKey: ["/api/community/threads", selectedThread?.id, "posts"],
    queryFn: async () => {
      if (!selectedThread) return [];
      const res = await fetch(`/api/community/threads/${selectedThread.id}/posts`);
      if (!res.ok) throw new Error("Failed to fetch posts");
      return res.json();
    },
    enabled: !!selectedThread
  });

  const createThreadMutation = useMutation({
    mutationFn: async (data: { departmentId: number; title: string; content: string }) => {
      const userHandle = localStorage.getItem("communityHandle") || `User${Math.floor(Math.random() * 9000) + 1000}`;
      localStorage.setItem("communityHandle", userHandle);
      
      const res = await fetch("/api/community/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, authorHandle: userHandle })
      });
      if (!res.ok) throw new Error("Failed to create thread");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/threads"] });
      setIsNewThreadOpen(false);
      setNewThreadTitle("");
      setNewThreadContent("");
      setNewThreadDepartment("");
      toast({ title: "Thread Created", description: "Your discussion thread has been posted." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create thread", variant: "destructive" });
    }
  });

  const createPostMutation = useMutation({
    mutationFn: async (data: { threadId: number; content: string }) => {
      const userHandle = localStorage.getItem("communityHandle") || `User${Math.floor(Math.random() * 9000) + 1000}`;
      localStorage.setItem("communityHandle", userHandle);
      
      const res = await fetch(`/api/community/threads/${data.threadId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: data.content, authorHandle: userHandle })
      });
      if (!res.ok) throw new Error("Failed to create post");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/threads", selectedThread?.id, "posts"] });
      setReplyContent("");
      toast({ title: "Reply Posted", description: "Your reply has been added to the discussion." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to post reply", variant: "destructive" });
    }
  });

  const handleCreateThread = () => {
    if (!newThreadTitle.trim() || !newThreadContent.trim() || !newThreadDepartment) {
      toast({ title: "Missing Fields", description: "Please fill in all fields", variant: "destructive" });
      return;
    }
    createThreadMutation.mutate({
      departmentId: parseInt(newThreadDepartment),
      title: newThreadTitle,
      content: newThreadContent
    });
  };

  const handleCreateReply = () => {
    if (!replyContent.trim() || !selectedThread) return;
    createPostMutation.mutate({
      threadId: selectedThread.id,
      content: replyContent
    });
  };

  const getDepartment = (id: number) => departments.find(d => d.id === id);

  if (selectedThread) {
    const threadDept = getDepartment(selectedThread.departmentId);
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-4 py-4">
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setSelectedThread(null)}
                data-testid="button-back-to-threads"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Discussions
              </Button>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-6">
          <Card className="mb-6" data-testid="card-thread-detail">
            <CardHeader>
              <div className="flex items-center gap-2 mb-2">
                {selectedThread.isPinned && <Badge variant="secondary"><Pin className="w-3 h-3 mr-1" />Pinned</Badge>}
                {selectedThread.isLocked && <Badge variant="outline"><Lock className="w-3 h-3 mr-1" />Locked</Badge>}
                {threadDept && (
                  <Badge style={{ backgroundColor: threadDept.color }} className="text-white">
                    {threadDept.name}
                  </Badge>
                )}
              </div>
              <CardTitle className="text-xl" data-testid="text-thread-title">{selectedThread.title}</CardTitle>
              <CardDescription className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <Avatar className="w-5 h-5">
                    <AvatarFallback className={`text-[10px] ${getAvatarColor(selectedThread.authorHandle)}`}>
                      {getInitials(selectedThread.authorHandle)}
                    </AvatarFallback>
                  </Avatar>
                  {selectedThread.authorHandle}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {formatDistanceToNow(new Date(selectedThread.createdAt), { addSuffix: true })}
                </span>
                <span className="flex items-center gap-1">
                  <Eye className="w-4 h-4" />
                  {selectedThread.viewCount} views
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap" data-testid="text-thread-content">
                {selectedThread.content}
              </p>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Replies ({posts.length})
            </h3>

            {postsLoading ? (
              <div className="text-center py-8 text-slate-500">Loading replies...</div>
            ) : posts.length === 0 ? (
              <Card className="p-8 text-center text-slate-500">
                No replies yet. Be the first to respond!
              </Card>
            ) : (
              posts.map((post) => (
                <Card key={post.id} className={post.isModeratorPost ? "border-blue-300 bg-blue-50 dark:bg-blue-950" : ""} data-testid={`card-post-${post.id}`}>
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <Avatar className="w-10 h-10">
                        <AvatarFallback className={getAvatarColor(post.authorHandle)}>
                          {getInitials(post.authorHandle)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium" data-testid={`text-post-author-${post.id}`}>{post.authorHandle}</span>
                          {post.isModeratorPost && (
                            <Badge variant="secondary" className="text-xs">
                              <Shield className="w-3 h-3 mr-1" />Moderator
                            </Badge>
                          )}
                          <span className="text-xs text-slate-500">
                            {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap" data-testid={`text-post-content-${post.id}`}>
                          {post.content}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                          <button className="flex items-center gap-1 hover:text-blue-600 transition-colors">
                            <ThumbsUp className="w-4 h-4" />
                            <span>{post.likeCount}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}

            {!selectedThread.isLocked && (
              <Card className="mt-6" data-testid="card-reply-form">
                <CardHeader>
                  <CardTitle className="text-lg">Post a Reply</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    placeholder="Share your thoughts or experience..."
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    rows={4}
                    className="mb-4"
                    data-testid="input-reply-content"
                  />
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-slate-500">
                      Posting as an anonymous community member
                    </p>
                    <Button 
                      onClick={handleCreateReply}
                      disabled={!replyContent.trim() || createPostMutation.isPending}
                      data-testid="button-submit-reply"
                    >
                      {createPostMutation.isPending ? "Posting..." : "Post Reply"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-4">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => navigate("/")}
                data-testid="button-back-home"
                className="px-2 sm:px-3"
              >
                <Home className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Home</span>
              </Button>
              <div className="h-6 w-px bg-slate-300 dark:bg-slate-700 hidden sm:block" />
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-[#004182]" />
                <span className="font-bold text-sm sm:text-lg text-[#004182] dark:text-blue-400">Community</span>
              </div>
            </div>
            <Dialog open={isNewThreadOpen} onOpenChange={setIsNewThreadOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-thread" size="sm" className="text-xs sm:text-sm">
                  <Plus className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">New Discussion</span>
                  <span className="sm:hidden">New</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Start a New Discussion</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Department</label>
                    <Select value={newThreadDepartment} onValueChange={setNewThreadDepartment}>
                      <SelectTrigger data-testid="select-thread-department">
                        <SelectValue placeholder="Select a department" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map((dept) => (
                          <SelectItem key={dept.id} value={dept.id.toString()}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Title</label>
                    <Input
                      placeholder="Give your discussion a clear title"
                      value={newThreadTitle}
                      onChange={(e) => setNewThreadTitle(e.target.value)}
                      data-testid="input-thread-title"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Content</label>
                    <Textarea
                      placeholder="Share your experience, ask a question, or start a discussion..."
                      value={newThreadContent}
                      onChange={(e) => setNewThreadContent(e.target.value)}
                      rows={5}
                      data-testid="input-thread-content"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsNewThreadOpen(false)}>Cancel</Button>
                  <Button 
                    onClick={handleCreateThread}
                    disabled={createThreadMutation.isPending}
                    data-testid="button-submit-thread"
                  >
                    {createThreadMutation.isPending ? "Creating..." : "Create Discussion"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4 sm:py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <Card className="bg-gradient-to-br from-blue-600 to-blue-700 text-white" data-testid="card-stat-members">
            <CardContent className="p-3 sm:pt-4 sm:px-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-xs sm:text-sm">Members</p>
                  <p className="text-2xl sm:text-3xl font-bold">{stats?.members || 0}</p>
                </div>
                <Users className="w-6 h-6 sm:w-10 sm:h-10 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-threads">
            <CardContent className="p-3 sm:pt-4 sm:px-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-500 text-xs sm:text-sm">Discussions</p>
                  <p className="text-2xl sm:text-3xl font-bold">{stats?.threads || 0}</p>
                </div>
                <MessageSquare className="w-6 h-6 sm:w-10 sm:h-10 text-slate-300" />
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-posts">
            <CardContent className="p-3 sm:pt-4 sm:px-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-500 text-xs sm:text-sm">Replies</p>
                  <p className="text-2xl sm:text-3xl font-bold">{stats?.posts || 0}</p>
                </div>
                <MessageSquare className="w-6 h-6 sm:w-10 sm:h-10 text-slate-300" />
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-stat-departments">
            <CardContent className="p-3 sm:pt-4 sm:px-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-500 text-xs sm:text-sm">Depts</p>
                  <p className="text-2xl sm:text-3xl font-bold">{departments.length}</p>
                </div>
                <Shield className="w-6 h-6 sm:w-10 sm:h-10 text-slate-300" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="lg:col-span-1 space-y-4">
            <Card data-testid="card-departments-filter">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  Departments
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <Button
                  variant={selectedDepartment === null ? "secondary" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => setSelectedDepartment(null)}
                  data-testid="button-filter-all"
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  All Discussions
                </Button>
                {departments.map((dept) => {
                  const IconComponent = departmentIcons[dept.icon] || Shield;
                  return (
                    <Button
                      key={dept.id}
                      variant={selectedDepartment === dept.id ? "secondary" : "ghost"}
                      className="w-full justify-start"
                      onClick={() => setSelectedDepartment(dept.id)}
                      data-testid={`button-filter-dept-${dept.id}`}
                    >
                      <span style={{ color: dept.color }}>
                        <IconComponent className="w-4 h-4 mr-2" />
                      </span>
                      {dept.name}
                    </Button>
                  );
                })}
              </CardContent>
            </Card>

            <Card data-testid="card-community-guidelines">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Community Guidelines
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-600 dark:text-slate-400 space-y-2">
                <p>1. Be respectful and supportive</p>
                <p>2. Share experiences, not personal details</p>
                <p>3. No spam or promotional content</p>
                <p>4. Report suspicious activity</p>
                <p>5. Protect your privacy - use handles only</p>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-3">
            <div className="mb-4 flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search discussions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-threads"
                />
              </div>
            </div>

            {threadsLoading ? (
              <div className="text-center py-12 text-slate-500">Loading discussions...</div>
            ) : threads.length === 0 ? (
              <Card className="p-12 text-center">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                <h3 className="font-semibold text-lg mb-2">No discussions yet</h3>
                <p className="text-slate-500 mb-4">Be the first to start a conversation!</p>
                <Button onClick={() => setIsNewThreadOpen(true)}>Start a Discussion</Button>
              </Card>
            ) : (
              <div className="space-y-3">
                {threads.map((thread) => {
                  const dept = getDepartment(thread.departmentId);
                  return (
                    <Card 
                      key={thread.id} 
                      className={`cursor-pointer hover:shadow-md transition-all ${thread.isPinned ? 'border-blue-300 bg-blue-50/50 dark:bg-blue-950/20' : ''}`}
                      onClick={() => setSelectedThread(thread)}
                      data-testid={`card-thread-${thread.id}`}
                    >
                      <CardContent className="py-4">
                        <div className="flex items-start gap-4">
                          <Avatar className="w-10 h-10">
                            <AvatarFallback className={getAvatarColor(thread.authorHandle)}>
                              {getInitials(thread.authorHandle)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              {thread.isPinned && (
                                <Badge variant="secondary" className="text-xs">
                                  <Pin className="w-3 h-3 mr-1" />Pinned
                                </Badge>
                              )}
                              {thread.isLocked && (
                                <Badge variant="outline" className="text-xs">
                                  <Lock className="w-3 h-3 mr-1" />Locked
                                </Badge>
                              )}
                              {dept && (
                                <Badge 
                                  variant="outline" 
                                  className="text-xs"
                                  style={{ borderColor: dept.color, color: dept.color }}
                                >
                                  {dept.name}
                                </Badge>
                              )}
                            </div>
                            <h3 className="font-semibold text-base mb-1 truncate" data-testid={`text-thread-title-${thread.id}`}>
                              {thread.title}
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-2">
                              {thread.content}
                            </p>
                            <div className="flex items-center gap-4 text-xs text-slate-500">
                              <span>{thread.authorHandle}</span>
                              <span className="flex items-center gap-1">
                                <Eye className="w-3 h-3" />
                                {thread.viewCount}
                              </span>
                              <span className="flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                {thread.replyCount} replies
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDistanceToNow(new Date(thread.lastActivityAt), { addSuffix: true })}
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
