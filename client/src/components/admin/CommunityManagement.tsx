import { useState, useMemo, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";

import { Label } from "@/components/ui/label";
import { buildFlaggedCsvLines } from "@/lib/flaggedCsvExport";
import { 
  Users, MessageSquare, Pin, Lock, Unlock, Trash2, Search, 
  Filter, Eye, Clock, Shield, RefreshCw, Plus, 
  TrendingUp, AlertTriangle, ShieldAlert, Check, X, CalendarDays, Download
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

function getAdminAuthHeader(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

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
  totalViews: number;
}

interface Keyword {
  id: number;
  pattern: string;
  isWildcard: boolean;
  isActive: boolean;
  createdAt: string;
  createdBy: string | null;
}

interface FlaggedPost {
  id: number;
  threadId: number;
  content: string;
  authorHandle: string;
  authorType: string;
  flagReason: string | null;
  createdAt: string;
}

interface FlaggedThread {
  id: number;
  title: string;
  content: string;
  authorHandle: string;
  authorType: string;
  flagReason: string | null;
  createdAt: string;
}

export function CommunityManagement() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "views">("recent");
  const [_isEditThreadOpen, _setIsEditThreadOpen] = useState(false);
  const [_selectedThread, _setSelectedThread] = useState<Thread | null>(null);
  const [isNewAnnouncementOpen, setIsNewAnnouncementOpen] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementContent, setAnnouncementContent] = useState("");
  const [announcementDepartment, setAnnouncementDepartment] = useState<string>("");
  const [newKeyword, setNewKeyword] = useState("");
  const [newKeywordIsWildcard, setNewKeywordIsWildcard] = useState(false);

  // Flagged content filters
  const [flaggedSearch, setFlaggedSearch] = useState("");
  const [flaggedAuthorFilter, setFlaggedAuthorFilter] = useState("");
  const [flaggedDateFilter, setFlaggedDateFilter] = useState("");

  // Flagged content selection
  const [selectedPostIds, setSelectedPostIds] = useState<Set<number>>(new Set());
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<number>>(new Set());

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

  const { data: threads = [], isLoading: threadsLoading, isFetching: threadsFetching } = useQuery<Thread[]>({
    queryKey: ["/api/community/threads", selectedDepartment, searchQuery, sortBy],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedDepartment !== "all") params.append("departmentId", selectedDepartment);
      if (searchQuery) params.append("search", searchQuery);
      if (sortBy === "views") params.append("sortBy", "views");
      params.append("limit", "100");
      const res = await fetch(`/api/community/threads?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch threads");
      return res.json();
    }
  });

  const { data: topThreads = [], isLoading: topThreadsLoading } = useQuery<Thread[]>({
    queryKey: ["/api/community/threads/top-views"],
    queryFn: async () => {
      const params = new URLSearchParams({ sortBy: "views", limit: "10" });
      const res = await fetch(`/api/community/threads?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch top threads");
      return res.json();
    }
  });

  const handleRefreshThreads = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/community/threads"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/community/stats"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/community/threads/top-views"] }),
    ]);
    toast({
      title: "Refreshed",
      description: "Discussion threads are up to date.",
    });
  };

  const invalidateThreadQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/community/threads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/community/threads/top-views"] });
  };

  const pinThreadMutation = useMutation({
    mutationFn: async ({ threadId, isPinned }: { threadId: number; isPinned: boolean }) => {
      const res = await fetch(`/api/community/threads/${threadId}`, {
        method: "PATCH",
        headers: { 
          "Content-Type": "application/json",
          ...getAdminAuthHeader()
        },
        body: JSON.stringify({ isPinned })
      });
      if (!res.ok) throw new Error("Failed to update thread");
      return res.json();
    },
    onSuccess: () => {
      invalidateThreadQueries();
      toast({ title: "Thread Updated", description: "Pin status changed successfully." });
    }
  });

  const lockThreadMutation = useMutation({
    mutationFn: async ({ threadId, isLocked }: { threadId: number; isLocked: boolean }) => {
      const res = await fetch(`/api/community/threads/${threadId}`, {
        method: "PATCH",
        headers: { 
          "Content-Type": "application/json",
          ...getAdminAuthHeader()
        },
        body: JSON.stringify({ isLocked })
      });
      if (!res.ok) throw new Error("Failed to update thread");
      return res.json();
    },
    onSuccess: () => {
      invalidateThreadQueries();
      toast({ title: "Thread Updated", description: "Lock status changed successfully." });
    }
  });

  const deleteThreadMutation = useMutation({
    mutationFn: async (threadId: number) => {
      const res = await fetch(`/api/community/threads/${threadId}`, {
        method: "DELETE",
        headers: getAdminAuthHeader()
      });
      if (!res.ok) throw new Error("Failed to delete thread");
      return res.json();
    },
    onSuccess: () => {
      invalidateThreadQueries();
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
          ...getAdminAuthHeader()
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
      invalidateThreadQueries();
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
        headers: getAdminAuthHeader()
      });
      if (!res.ok) throw new Error("Failed to seed community");
      return res.json();
    },
    onSuccess: (data) => {
      invalidateThreadQueries();
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

  const { data: keywords = [], refetch: refetchKeywords } = useQuery<Keyword[]>({
    queryKey: ["/api/admin/community/keywords"],
    queryFn: async () => {
      const res = await fetch("/api/admin/community/keywords", { headers: getAdminAuthHeader() });
      if (!res.ok) throw new Error("Failed to fetch keywords");
      return res.json();
    }
  });

  const { data: flaggedData, refetch: refetchFlagged } = useQuery<{ posts: FlaggedPost[]; threads: FlaggedThread[] }>({
    queryKey: ["/api/admin/community/flagged"],
    queryFn: async () => {
      const res = await fetch("/api/admin/community/flagged", { headers: getAdminAuthHeader() });
      if (!res.ok) throw new Error("Failed to fetch flagged content");
      return res.json();
    }
  });

  const allFlaggedPosts = flaggedData?.posts ?? [];
  const allFlaggedThreads = flaggedData?.threads ?? [];

  // Apply search/filter to flagged posts
  const flaggedPosts = useMemo(() => {
    let items = allFlaggedPosts;
    if (flaggedSearch.trim()) {
      const term = flaggedSearch.toLowerCase();
      items = items.filter(
        (p) =>
          p.content.toLowerCase().includes(term) ||
          (p.flagReason ?? "").toLowerCase().includes(term),
      );
    }
    if (flaggedAuthorFilter.trim()) {
      const term = flaggedAuthorFilter.toLowerCase();
      items = items.filter((p) => p.authorHandle.toLowerCase().includes(term));
    }
    if (flaggedDateFilter) {
      items = items.filter((p) => p.createdAt.startsWith(flaggedDateFilter));
    }
    return items;
  }, [allFlaggedPosts, flaggedSearch, flaggedAuthorFilter, flaggedDateFilter]);

  // Apply search/filter to flagged threads
  const flaggedThreads = useMemo(() => {
    let items = allFlaggedThreads;
    if (flaggedSearch.trim()) {
      const term = flaggedSearch.toLowerCase();
      items = items.filter(
        (t) =>
          t.title.toLowerCase().includes(term) ||
          t.content.toLowerCase().includes(term) ||
          (t.flagReason ?? "").toLowerCase().includes(term),
      );
    }
    if (flaggedAuthorFilter.trim()) {
      const term = flaggedAuthorFilter.toLowerCase();
      items = items.filter((t) => t.authorHandle.toLowerCase().includes(term));
    }
    if (flaggedDateFilter) {
      items = items.filter((t) => t.createdAt.startsWith(flaggedDateFilter));
    }
    return items;
  }, [allFlaggedThreads, flaggedSearch, flaggedAuthorFilter, flaggedDateFilter]);

  const hasSelection = selectedThreadIds.size > 0 || selectedPostIds.size > 0;
  const selectionCount = selectedThreadIds.size + selectedPostIds.size;

  function exportFlaggedCsv() {
    const sourceThreads = hasSelection ? flaggedThreads.filter((t) => selectedThreadIds.has(t.id)) : flaggedThreads;
    const sourcePosts = hasSelection ? flaggedPosts.filter((p) => selectedPostIds.has(p.id)) : flaggedPosts;
    const csvLines = buildFlaggedCsvLines(sourceThreads, sourcePosts);
    const blob = new Blob([csvLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `flagged-content-${timestamp}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // FLAGGED_POST_SELECTION_PRUNING_EFFECT_START
  // When filters change, remove post IDs that are no longer in the visible set.
  useEffect(() => {
    if (selectedPostIds.size === 0) return;
    const liveIds = new Set(flaggedPosts.map((p) => p.id));
    const pruned = new Set([...selectedPostIds].filter((id) => liveIds.has(id)));
    if (pruned.size !== selectedPostIds.size) {
      setSelectedPostIds(pruned);
    }
  }, [flaggedPosts]);

  // FLAGGED_THREAD_SELECTION_PRUNING_EFFECT_START
  // When filters change, remove thread IDs that are no longer in the visible set.
  useEffect(() => {
    if (selectedThreadIds.size === 0) return;
    const liveIds = new Set(flaggedThreads.map((t) => t.id));
    const pruned = new Set([...selectedThreadIds].filter((id) => liveIds.has(id)));
    if (pruned.size !== selectedThreadIds.size) {
      setSelectedThreadIds(pruned);
    }
  }, [flaggedThreads]);

  const addKeywordMutation = useMutation({
    mutationFn: async (data: { pattern: string; isWildcard: boolean }) => {
      const res = await fetch("/api/admin/community/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAdminAuthHeader() },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to add keyword");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/community/keywords"] });
      setNewKeyword("");
      setNewKeywordIsWildcard(false);
      toast({ title: "Keyword added", description: "Blocklist updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleKeywordMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await fetch(`/api/admin/community/keywords/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAdminAuthHeader() },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update keyword");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/community/keywords"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update keyword", variant: "destructive" });
    },
  });

  const deleteKeywordMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/community/keywords/${id}`, {
        method: "DELETE",
        headers: getAdminAuthHeader(),
      });
      if (!res.ok) throw new Error("Failed to delete keyword");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/community/keywords"] });
      toast({ title: "Keyword removed", description: "Blocklist updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete keyword", variant: "destructive" });
    },
  });

  const approvePostMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/community/flagged/posts/${id}/approve`, {
        method: "POST",
        headers: getAdminAuthHeader(),
      });
      if (!res.ok) throw new Error("Failed to approve post");
      return res.json();
    },
    onSuccess: () => {
      refetchFlagged();
      toast({ title: "Post approved", description: "Post is now visible to users." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to approve post", variant: "destructive" });
    },
  });

  const removePostMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/community/flagged/posts/${id}/remove`, {
        method: "POST",
        headers: getAdminAuthHeader(),
      });
      if (!res.ok) throw new Error("Failed to remove post");
      return res.json();
    },
    onSuccess: () => {
      refetchFlagged();
      toast({ title: "Post removed", description: "Post has been hidden." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove post", variant: "destructive" });
    },
  });

  const approveThreadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/community/flagged/threads/${id}/approve`, {
        method: "POST",
        headers: getAdminAuthHeader(),
      });
      if (!res.ok) throw new Error("Failed to approve thread");
      return res.json();
    },
    onSuccess: () => {
      refetchFlagged();
      invalidateThreadQueries();
      toast({ title: "Thread approved", description: "Thread is now visible to users." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to approve thread", variant: "destructive" });
    },
  });

  const removeThreadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/community/flagged/threads/${id}/remove`, {
        method: "POST",
        headers: getAdminAuthHeader(),
      });
      if (!res.ok) throw new Error("Failed to remove thread");
      return res.json();
    },
    onSuccess: () => {
      refetchFlagged();
      invalidateThreadQueries();
      toast({ title: "Thread removed", description: "Thread has been deleted." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove thread", variant: "destructive" });
    },
  });

  const bulkApprovePostsMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch("/api/admin/community/flagged/posts/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAdminAuthHeader() },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Failed to bulk approve posts");
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedPostIds(new Set());
      refetchFlagged();
      toast({ title: "Posts approved", description: `${data.count} ${data.count === 1 ? "reply" : "replies"} approved.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to bulk approve posts", variant: "destructive" });
    },
  });

  const bulkRemovePostsMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch("/api/admin/community/flagged/posts/bulk-remove", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAdminAuthHeader() },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Failed to bulk remove posts");
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedPostIds(new Set());
      refetchFlagged();
      toast({ title: "Posts removed", description: `${data.count} ${data.count === 1 ? "reply" : "replies"} removed.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to bulk remove posts", variant: "destructive" });
    },
  });

  const bulkApproveThreadsMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch("/api/admin/community/flagged/threads/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAdminAuthHeader() },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Failed to bulk approve threads");
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedThreadIds(new Set());
      refetchFlagged();
      invalidateThreadQueries();
      toast({ title: "Threads approved", description: `${data.count} ${data.count === 1 ? "thread" : "threads"} approved.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to bulk approve threads", variant: "destructive" });
    },
  });

  const bulkRemoveThreadsMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch("/api/admin/community/flagged/threads/bulk-remove", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAdminAuthHeader() },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Failed to bulk remove threads");
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedThreadIds(new Set());
      refetchFlagged();
      invalidateThreadQueries();
      toast({ title: "Threads removed", description: `${data.count} ${data.count === 1 ? "thread" : "threads"} deleted.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to bulk remove threads", variant: "destructive" });
    },
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

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
        <Card className="bg-slate-800 border-slate-700" data-testid="card-admin-stat-total-views">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm">Total Views</p>
                <p className="text-3xl font-bold text-white">
                  {statsLoading ? "..." : (stats?.totalViews ?? 0).toLocaleString()}
                </p>
              </div>
              <Eye className="w-10 h-10 text-slate-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-900 border-slate-800" data-testid="card-top-threads-by-views">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            <CardTitle className="text-base text-white">Most Popular Threads by Views</CardTitle>
          </div>
          <CardDescription className="text-slate-400 text-sm">
            Top 10 threads ranked by deduplicated view count
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {topThreadsLoading ? (
            <div className="p-6 text-center text-slate-500 text-sm">Loading...</div>
          ) : topThreads.length === 0 ? (
            <div className="p-6 text-center text-slate-500 text-sm">No threads found</div>
          ) : (
            <div className="divide-y divide-slate-800">
              {topThreads.map((thread, index) => {
                const dept = getDepartment(thread.departmentId);
                const views = parseInt(thread.viewCount || "0");
                const maxViews = parseInt(topThreads[0]?.viewCount || "1");
                const barWidth = maxViews > 0 ? Math.round((views / maxViews) * 100) : 0;
                return (
                  <div key={thread.id} className="px-4 py-3 flex items-center gap-3" data-testid={`top-thread-row-${thread.id}`}>
                    <span className="text-slate-500 text-sm font-mono w-5 shrink-0 text-right">{index + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {dept && (
                          <Badge variant="outline" className="text-xs" style={{ borderColor: dept.color, color: dept.color }}>
                            {dept.name}
                          </Badge>
                        )}
                        {thread.isPinned && (
                          <Badge variant="secondary" className="bg-blue-600/20 text-blue-400 text-xs">
                            <Pin className="w-3 h-3 mr-1" />Pinned
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-white truncate font-medium">{thread.title}</p>
                      <div className="mt-1.5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1 text-sm font-semibold text-white">
                      <Eye className="w-4 h-4 text-blue-400" />
                      {views.toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="threads" className="space-y-4">
        <TabsList className="bg-slate-900 border-slate-800">
          <TabsTrigger value="threads" className="data-[state=active]:bg-slate-800" data-testid="subtab-threads">
            <MessageSquare className="w-4 h-4 mr-2" /> Discussion Threads
          </TabsTrigger>
          <TabsTrigger value="departments" className="data-[state=active]:bg-slate-800" data-testid="subtab-departments">
            <Shield className="w-4 h-4 mr-2" /> Departments
          </TabsTrigger>
          <TabsTrigger value="keywords" className="data-[state=active]:bg-slate-800" data-testid="subtab-keywords">
            <ShieldAlert className="w-4 h-4 mr-2" /> Keyword Blocklist
          </TabsTrigger>
          <TabsTrigger value="flagged" className="data-[state=active]:bg-slate-800" data-testid="subtab-flagged">
            <AlertTriangle className="w-4 h-4 mr-2" /> Flagged Content
            {(flaggedPosts.length + flaggedThreads.length) > 0 && (
              <Badge className="ml-1.5 h-5 min-w-5 bg-red-600 text-white text-xs px-1.5">
                {flaggedPosts.length + flaggedThreads.length}
              </Badge>
            )}
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
                  <Select value={sortBy} onValueChange={(v) => setSortBy(v as "recent" | "views")}>
                    <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-white" data-testid="select-sort-threads">
                      {sortBy === "views" ? <Eye className="w-4 h-4 mr-2" /> : <Clock className="w-4 h-4 mr-2" />}
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="recent" className="text-white">
                        <span className="flex items-center gap-2"><Clock className="w-4 h-4" />Recent Activity</span>
                      </SelectItem>
                      <SelectItem value="views" className="text-white">
                        <span className="flex items-center gap-2"><Eye className="w-4 h-4" />Most Viewed</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  onClick={handleRefreshThreads}
                  disabled={threadsFetching}
                  className="text-slate-400 hover:text-white"
                  data-testid="button-refresh-threads"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${threadsFetching ? "animate-spin" : ""}`} />
                  {threadsFetching ? "Refreshing…" : "Refresh"}
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

        <TabsContent value="keywords">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="border-b border-slate-800 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white text-base flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-amber-400" />
                    Keyword Blocklist
                  </CardTitle>
                  <CardDescription className="text-slate-400 text-sm mt-1">
                    User posts matching these patterns are auto-flagged for review. Wildcards: use * as a placeholder (e.g. free*money).
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refetchKeywords()}
                  className="text-slate-400 hover:text-white"
                  data-testid="button-refresh-keywords"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex items-end gap-3 pt-4">
                <div className="flex-1">
                  <Label className="text-slate-400 text-xs mb-1.5 block">New Pattern</Label>
                  <Input
                    placeholder="e.g. scam  or  free*money"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newKeyword.trim()) {
                        addKeywordMutation.mutate({ pattern: newKeyword.trim(), isWildcard: newKeywordIsWildcard });
                      }
                    }}
                    className="bg-slate-800 border-slate-700 text-white"
                    data-testid="input-new-keyword"
                  />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <Label className="text-slate-400 text-xs">Wildcard</Label>
                  <Switch
                    checked={newKeywordIsWildcard}
                    onCheckedChange={setNewKeywordIsWildcard}
                    data-testid="switch-keyword-wildcard"
                  />
                </div>
                <Button
                  onClick={() => {
                    if (newKeyword.trim()) {
                      addKeywordMutation.mutate({ pattern: newKeyword.trim(), isWildcard: newKeywordIsWildcard });
                    }
                  }}
                  disabled={addKeywordMutation.isPending || !newKeyword.trim()}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  data-testid="button-add-keyword"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  Add
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {keywords.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <ShieldAlert className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p>No keywords in the blocklist yet.</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="divide-y divide-slate-800">
                    {keywords.map((kw) => (
                      <div
                        key={kw.id}
                        className="flex items-center gap-3 px-4 py-3"
                        data-testid={`keyword-row-${kw.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="text-amber-300 font-mono text-sm">{kw.pattern}</code>
                            {kw.isWildcard && (
                              <Badge className="bg-purple-600/20 text-purple-400 text-xs">wildcard</Badge>
                            )}
                            {!kw.isActive && (
                              <Badge className="bg-slate-700 text-slate-400 text-xs">disabled</Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Added {formatDistanceToNow(new Date(kw.createdAt), { addSuffix: true })}
                            {kw.createdBy ? ` by ${kw.createdBy}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Switch
                            checked={kw.isActive}
                            disabled={toggleKeywordMutation.isPending}
                            onCheckedChange={(checked) =>
                              toggleKeywordMutation.mutate({ id: kw.id, isActive: checked })
                            }
                            aria-label={kw.isActive ? "Disable keyword" : "Enable keyword"}
                            data-testid={`switch-keyword-active-${kw.id}`}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={toggleKeywordMutation.isPending || deleteKeywordMutation.isPending}
                            onClick={() => {
                              if (confirm(`Remove keyword "${kw.pattern}" from the blocklist?`)) {
                                deleteKeywordMutation.mutate(kw.id);
                              }
                            }}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/20"
                            data-testid={`button-delete-keyword-${kw.id}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="flagged">
          <div className="space-y-4">
            {/* Search / filter bar */}
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="py-3">
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-500 pointer-events-none" />
                    <Input
                      placeholder="Search by keyword match or content…"
                      value={flaggedSearch}
                      onChange={(e) => setFlaggedSearch(e.target.value)}
                      className="pl-9 bg-slate-800 border-slate-700 text-white text-sm"
                      data-testid="input-flagged-search"
                    />
                  </div>
                  <div className="relative">
                    <Filter className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-500 pointer-events-none" />
                    <Input
                      placeholder="Author handle…"
                      value={flaggedAuthorFilter}
                      onChange={(e) => setFlaggedAuthorFilter(e.target.value)}
                      className="pl-9 bg-slate-800 border-slate-700 text-white text-sm w-44"
                      data-testid="input-flagged-author"
                    />
                  </div>
                  <div className="relative">
                    <CalendarDays className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-500 pointer-events-none" />
                    <Input
                      type="date"
                      value={flaggedDateFilter}
                      onChange={(e) => setFlaggedDateFilter(e.target.value)}
                      className="pl-9 bg-slate-800 border-slate-700 text-white text-sm w-44"
                      data-testid="input-flagged-date"
                    />
                  </div>
                  {(flaggedSearch || flaggedAuthorFilter || flaggedDateFilter) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setFlaggedSearch(""); setFlaggedAuthorFilter(""); setFlaggedDateFilter(""); }}
                      className="text-slate-400 hover:text-white shrink-0"
                      data-testid="button-clear-flagged-filters"
                    >
                      <X className="w-4 h-4 mr-1" /> Clear
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportFlaggedCsv}
                    disabled={flaggedPosts.length === 0 && flaggedThreads.length === 0}
                    className="border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 shrink-0"
                    data-testid="button-export-flagged-csv"
                  >
                    <Download className="w-4 h-4 mr-1.5" />
                    {hasSelection ? `Export Selected (${selectionCount})` : "Export CSV"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Flagged Threads */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="border-b border-slate-800 pb-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="select-all-threads"
                      checked={flaggedThreads.length > 0 && flaggedThreads.every((t) => selectedThreadIds.has(t.id))}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedThreadIds(new Set(flaggedThreads.map((t) => t.id)));
                        } else {
                          setSelectedThreadIds((prev) => {
                            const next = new Set(prev);
                            flaggedThreads.forEach((t) => next.delete(t.id));
                            return next;
                          });
                        }
                      }}
                      aria-label="Select all threads"
                      data-testid="checkbox-select-all-threads"
                      className="border-slate-600"
                    />
                    <div>
                      <CardTitle className="text-white text-base flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                        Flagged Threads ({flaggedThreads.length}{allFlaggedThreads.length !== flaggedThreads.length ? ` of ${allFlaggedThreads.length}` : ""})
                      </CardTitle>
                      <CardDescription className="text-slate-400 text-sm mt-1">
                        Threads auto-flagged by keyword moderation. Approve to make visible, or remove permanently.
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedThreadIds.size > 0 && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => bulkApproveThreadsMutation.mutate(Array.from(selectedThreadIds))}
                          disabled={bulkApproveThreadsMutation.isPending}
                          className="bg-green-700 hover:bg-green-600 text-white h-8 px-3"
                          data-testid="button-bulk-approve-threads"
                        >
                          <Check className="w-3.5 h-3.5 mr-1" /> Approve {selectedThreadIds.size}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Permanently delete ${selectedThreadIds.size} flagged thread(s)?`)) {
                              bulkRemoveThreadsMutation.mutate(Array.from(selectedThreadIds));
                            }
                          }}
                          disabled={bulkRemoveThreadsMutation.isPending}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/20 h-8 px-3"
                          data-testid="button-bulk-remove-threads"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove {selectedThreadIds.size}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => refetchFlagged()}
                      className="text-slate-400 hover:text-white"
                      data-testid="button-refresh-flagged"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {flaggedThreads.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    <Check className="w-10 h-10 mx-auto mb-3 opacity-40 text-green-400" />
                    <p>{allFlaggedThreads.length === 0 ? "No flagged threads." : "No threads match the current filters."}</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[300px]">
                    <div className="divide-y divide-slate-800">
                      {flaggedThreads.map((thread) => (
                        <div
                          key={thread.id}
                          className={`px-4 py-3 space-y-2 ${selectedThreadIds.has(thread.id) ? "bg-slate-800/50" : ""}`}
                          data-testid={`flagged-thread-row-${thread.id}`}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={selectedThreadIds.has(thread.id)}
                              onCheckedChange={(checked) => {
                                setSelectedThreadIds((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(thread.id); else next.delete(thread.id);
                                  return next;
                                });
                              }}
                              aria-label={`Select thread ${thread.id}`}
                              data-testid={`checkbox-thread-${thread.id}`}
                              className="mt-0.5 border-slate-600 shrink-0"
                            />
                            <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-white text-sm font-medium truncate">{thread.title}</p>
                                <p className="text-slate-400 text-xs line-clamp-2 mt-0.5">{thread.content}</p>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <span className="text-xs text-slate-500">by {thread.authorHandle}</span>
                                  <span className="text-xs text-slate-600">·</span>
                                  <span className="text-xs text-slate-500">
                                    {formatDistanceToNow(new Date(thread.createdAt), { addSuffix: true })}
                                  </span>
                                  {thread.flagReason && (
                                    <Badge className="bg-red-600/20 text-red-400 text-xs">
                                      {thread.flagReason.replace("keyword_match:", "matched: ")}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Button
                                  size="sm"
                                  onClick={() => approveThreadMutation.mutate(thread.id)}
                                  disabled={approveThreadMutation.isPending}
                                  className="bg-green-700 hover:bg-green-600 text-white h-8 px-3"
                                  data-testid={`button-approve-thread-${thread.id}`}
                                >
                                  <Check className="w-3.5 h-3.5 mr-1" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    if (confirm("Permanently delete this flagged thread?")) {
                                      removeThreadMutation.mutate(thread.id);
                                    }
                                  }}
                                  disabled={removeThreadMutation.isPending}
                                  className="text-red-400 hover:text-red-300 hover:bg-red-500/20 h-8 px-3"
                                  data-testid={`button-remove-thread-${thread.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* Flagged Replies */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="border-b border-slate-800 pb-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="select-all-posts"
                      checked={flaggedPosts.length > 0 && flaggedPosts.every((p) => selectedPostIds.has(p.id))}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedPostIds(new Set(flaggedPosts.map((p) => p.id)));
                        } else {
                          setSelectedPostIds((prev) => {
                            const next = new Set(prev);
                            flaggedPosts.forEach((p) => next.delete(p.id));
                            return next;
                          });
                        }
                      }}
                      aria-label="Select all replies"
                      data-testid="checkbox-select-all-posts"
                      className="border-slate-600"
                    />
                    <div>
                      <CardTitle className="text-white text-base flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-orange-400" />
                        Flagged Replies ({flaggedPosts.length}{allFlaggedPosts.length !== flaggedPosts.length ? ` of ${allFlaggedPosts.length}` : ""})
                      </CardTitle>
                      <CardDescription className="text-slate-400 text-sm mt-1">
                        Replies auto-flagged by keyword moderation. Approve to make visible, or hide permanently.
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedPostIds.size > 0 && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => bulkApprovePostsMutation.mutate(Array.from(selectedPostIds))}
                          disabled={bulkApprovePostsMutation.isPending}
                          className="bg-green-700 hover:bg-green-600 text-white h-8 px-3"
                          data-testid="button-bulk-approve-posts"
                        >
                          <Check className="w-3.5 h-3.5 mr-1" /> Approve {selectedPostIds.size}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Permanently hide ${selectedPostIds.size} flagged repl${selectedPostIds.size === 1 ? "y" : "ies"}?`)) {
                              bulkRemovePostsMutation.mutate(Array.from(selectedPostIds));
                            }
                          }}
                          disabled={bulkRemovePostsMutation.isPending}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/20 h-8 px-3"
                          data-testid="button-bulk-remove-posts"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Hide {selectedPostIds.size}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {flaggedPosts.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    <Check className="w-10 h-10 mx-auto mb-3 opacity-40 text-green-400" />
                    <p>{allFlaggedPosts.length === 0 ? "No flagged replies." : "No replies match the current filters."}</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[300px]">
                    <div className="divide-y divide-slate-800">
                      {flaggedPosts.map((post) => (
                        <div
                          key={post.id}
                          className={`px-4 py-3 space-y-2 ${selectedPostIds.has(post.id) ? "bg-slate-800/50" : ""}`}
                          data-testid={`flagged-post-row-${post.id}`}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={selectedPostIds.has(post.id)}
                              onCheckedChange={(checked) => {
                                setSelectedPostIds((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(post.id); else next.delete(post.id);
                                  return next;
                                });
                              }}
                              aria-label={`Select post ${post.id}`}
                              data-testid={`checkbox-post-${post.id}`}
                              className="mt-0.5 border-slate-600 shrink-0"
                            />
                            <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-slate-300 text-sm line-clamp-3">{post.content}</p>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <span className="text-xs text-slate-500">by {post.authorHandle}</span>
                                  <span className="text-xs text-slate-600">·</span>
                                  <span className="text-xs text-slate-500">thread #{post.threadId}</span>
                                  <span className="text-xs text-slate-600">·</span>
                                  <span className="text-xs text-slate-500">
                                    {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                                  </span>
                                  {post.flagReason && (
                                    <Badge className="bg-red-600/20 text-red-400 text-xs">
                                      {post.flagReason.replace("keyword_match:", "matched: ")}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Button
                                  size="sm"
                                  onClick={() => approvePostMutation.mutate(post.id)}
                                  disabled={approvePostMutation.isPending}
                                  className="bg-green-700 hover:bg-green-600 text-white h-8 px-3"
                                  data-testid={`button-approve-post-${post.id}`}
                                >
                                  <Check className="w-3.5 h-3.5 mr-1" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    if (confirm("Permanently hide this flagged reply?")) {
                                      removePostMutation.mutate(post.id);
                                    }
                                  }}
                                  disabled={removePostMutation.isPending}
                                  className="text-red-400 hover:text-red-300 hover:bg-red-500/20 h-8 px-3"
                                  data-testid={`button-remove-post-${post.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Hide
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
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
