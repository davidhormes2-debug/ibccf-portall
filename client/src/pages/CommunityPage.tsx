import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute, Link } from "wouter";
import { 
  Users, MessageSquare, Eye, Clock, Search, Filter, 
  ChevronRight, Plus, Shield, ArrowLeft, ThumbsUp, 
  Pin, Lock, FileText, ClipboardList, AlertTriangle, 
  Scale, TrendingUp, Home
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { BuildStampLine } from "@/components/BuildStampLine";


import { getPortalToken, hasPortalSession } from "@/lib/portalSession";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useFormat } from "@/i18n/format";

// Thrown by community mutation fetchers on a 429 response so onError can
// distinguish "you're going too fast" from a generic failure and show a
// friendly retry message instead of a raw/opaque error.
class RateLimitError extends Error {
  constructor(message?: string) {
    super(message || "Too many requests. Please try again later.");
    this.name = "RateLimitError";
  }
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
  if (handle.includes('#')) {
    const code = handle.split('#')[1] || handle;
    return code.slice(0, 2).toUpperCase();
  }
  return handle.slice(0, 2).toUpperCase();
}

function getAvatarColor(handle: string): string {
  const colors = [
    "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-orange-500",
    "bg-pink-500", "bg-teal-500", "bg-indigo-500", "bg-red-500"
  ];
  // Hash the full handle for even color distribution across Member #XXXXX codes
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = (hash * 31 + handle.charCodeAt(i)) & 0x7fffffff;
  }
  return colors[hash % colors.length];
}

export default function CommunityPage() {
  const { t } = useTranslation("community");
  const { formatRelative } = useFormat();
  const [, navigate] = useLocation();
  // `/community/:threadId` is the crawlable, permalink URL for a single
  // discussion thread. Clicking a thread card or sharing a link now
  // navigates here instead of only mutating in-memory state, so search
  // engines and social crawlers have a real document to index.
  const [isThreadRoute, threadRouteParams] = useRoute("/community/:threadId");
  const routeThreadId = isThreadRoute && threadRouteParams?.threadId
    ? parseInt(threadRouteParams.threadId, 10)
    : null;
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

  const threadParamHandledRef = useRef(false);
  const postParamHandledRef = useRef(false);

  const isAuthenticated = useMemo(() => {
    return hasPortalSession();
  }, []);

  const { data: myParticipant } = useQuery<{ anonymousHandle: string } | null>({
    queryKey: ["/api/community/participants/me"],
    queryFn: async () => {
      const sessionToken = getPortalToken();
      const res = await fetch("/api/community/participants/me", {
        headers: { "x-portal-session-token": sessionToken }
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

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
    },
    refetchInterval: 60000,
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
    },
    refetchInterval: 30000,
  });

  // Legacy `?thread=` deep links (query-string only, never crawlable) are
  // redirected to the canonical `/community/:threadId` URL so old
  // bookmarks/shares keep working while every reference converges on one
  // indexable address per thread.
  useEffect(() => {
    if (threadParamHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const threadIdParam = params.get("thread");
    if (!threadIdParam) {
      threadParamHandledRef.current = true;
      return;
    }
    const id = parseInt(threadIdParam, 10);
    if (!Number.isFinite(id)) {
      threadParamHandledRef.current = true;
      return;
    }
    threadParamHandledRef.current = true;
    const postParam = params.get("post");
    navigate(`/community/${id}${postParam ? `?post=${postParam}` : ""}`, { replace: true });
  }, [navigate]);

  // Keep `selectedThread` in sync with the `/community/:threadId` route:
  // prefer the already-fetched list entry (avoids a redundant request when
  // the user simply clicked a card), falling back to a direct fetch below
  // for permalinks/shares that land on a thread not present in the
  // current list/filter window.
  useEffect(() => {
    if (routeThreadId === null) {
      setSelectedThread(null);
      return;
    }
    if (selectedThread?.id === routeThreadId) return;
    const found = threads.find((th) => th.id === routeThreadId);
    if (found) setSelectedThread(found);
  }, [routeThreadId, threads, selectedThread]);

  const { data: directThread } = useQuery<Thread | null>({
    queryKey: ["/api/community/threads", routeThreadId, "direct"],
    queryFn: async () => {
      if (routeThreadId === null) return null;
      const res = await fetch(`/api/community/threads/${routeThreadId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.thread ?? null;
    },
    enabled: routeThreadId !== null && !threads.some((th) => th.id === routeThreadId),
  });

  useEffect(() => {
    if (directThread && directThread.id === routeThreadId) {
      setSelectedThread(directThread);
    }
  }, [directThread, routeThreadId]);

  // Reset the post-param handler whenever the user opens a new thread,
  // so a fresh ?post= deep link can be honoured even after the first one fires.
  useEffect(() => {
    postParamHandledRef.current = false;
  }, [selectedThread?.id]);

  const { data: posts = [], isLoading: postsLoading } = useQuery<Post[]>({
    queryKey: ["/api/community/threads", selectedThread?.id, "posts"],
    queryFn: async () => {
      if (!selectedThread) return [];
      const res = await fetch(`/api/community/threads/${selectedThread.id}/posts`);
      if (!res.ok) throw new Error("Failed to fetch posts");
      return res.json();
    },
    enabled: !!selectedThread,
    refetchInterval: selectedThread ? 15000 : false,
  });

  // Deep-link to a specific reply: scroll into view + briefly highlight.
  useEffect(() => {
    if (postParamHandledRef.current) return;
    if (!selectedThread || posts.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const postIdParam = params.get("post");
    if (!postIdParam) {
      postParamHandledRef.current = true;
      return;
    }
    const targetPostId = parseInt(postIdParam, 10);
    if (!Number.isFinite(targetPostId)) {
      postParamHandledRef.current = true;
      return;
    }
    if (!posts.some((p) => p.id === targetPostId)) return;

    postParamHandledRef.current = true;

    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-testid="card-post-${targetPostId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("post-flash-highlight");
      window.setTimeout(() => el.classList.remove("post-flash-highlight"), 1600);
    }, 120);

    return () => window.clearTimeout(t);
  }, [posts, selectedThread?.id]);

  const createThreadMutation = useMutation({
    mutationFn: async (data: { departmentId: number; title: string; content: string }) => {
      const sessionToken = getPortalToken();
      const res = await fetch("/api/community/threads", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-portal-session-token": sessionToken
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 429) {
          throw new RateLimitError(err.message);
        }
        throw new Error(err.error || t("toast.createThreadFail"));
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/threads"] });
      setIsNewThreadOpen(false);
      setNewThreadTitle("");
      setNewThreadContent("");
      setNewThreadDepartment("");
      toast({ title: t("toast.threadCreatedTitle"), description: t("toast.threadCreatedDesc") });
    },
    onError: (error: unknown) => {
      if (error instanceof RateLimitError) {
        toast({ title: t("toast.rateLimitedTitle"), description: t("toast.rateLimitedDesc"), variant: "destructive" });
        return;
      }
      toast({ title: t("toast.errorTitle"), description: t("toast.createThreadFail"), variant: "destructive" });
    }
  });

  const createPostMutation = useMutation({
    mutationFn: async (data: { threadId: number; content: string }) => {
      const sessionToken = getPortalToken();
      const res = await fetch(`/api/community/threads/${data.threadId}/posts`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-portal-session-token": sessionToken
        },
        body: JSON.stringify({ content: data.content })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 429) {
          throw new RateLimitError(err.message);
        }
        throw new Error(err.error || t("toast.postReplyFail"));
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/community/threads", selectedThread?.id, "posts"] });
      setReplyContent("");
      toast({ title: t("toast.replyPostedTitle"), description: t("toast.replyPostedDesc") });
    },
    onError: (error: unknown) => {
      if (error instanceof RateLimitError) {
        toast({ title: t("toast.rateLimitedTitle"), description: t("toast.rateLimitedDesc"), variant: "destructive" });
        return;
      }
      toast({ title: t("toast.errorTitle"), description: t("toast.postReplyFail"), variant: "destructive" });
    }
  });

  const handleCreateThread = () => {
    if (!newThreadTitle.trim() || !newThreadContent.trim() || !newThreadDepartment) {
      toast({ title: t("toast.missingFieldsTitle"), description: t("toast.missingFieldsDesc"), variant: "destructive" });
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
      <div className="min-h-screen community-premium-bg">
        <header className="sticky top-0 z-50 border-b border-slate-200/60 dark:border-white/10 bg-white/92 dark:bg-slate-900/92 backdrop-blur-2xl"
          style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 4px 24px rgba(0,0,0,0.08)' }}>
          <div className="max-w-6xl mx-auto px-4 py-4">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost"
                size="sm" 
                onClick={() => navigate("/community")}
                data-testid="button-back-to-threads"
                className="hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t("actions.backToDiscussions")}
              </Button>
              {threadDept && (
                <span
                  className="hidden sm:inline-flex items-center px-3 py-1 rounded-full text-xs font-bold"
                  style={{ backgroundColor: `${threadDept.color}18`, color: threadDept.color }}
                >
                  {threadDept.name}
                </span>
              )}
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
          {/* Thread header card */}
          <div className="glass-card rounded-2xl mb-6 card-depth overflow-hidden" data-testid="card-thread-detail">
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                {selectedThread.isPinned && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-[#004182]/10 text-[#004182] dark:text-blue-400">
                    <Pin className="w-3 h-3" />{t("thread.pinned")}
                  </span>
                )}
                {selectedThread.isLocked && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-700 text-slate-500">
                    <Lock className="w-3 h-3" />{t("thread.locked")}
                  </span>
                )}
                {threadDept && (
                  <span
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold"
                    style={{ backgroundColor: `${threadDept.color}18`, color: threadDept.color }}
                  >
                    {threadDept.name}
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-4" data-testid="text-thread-title">
                {selectedThread.title}
              </h1>
              <div className="flex items-center gap-5 text-sm text-slate-500 dark:text-slate-400 mb-6 flex-wrap">
                <span className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold ${getAvatarColor(selectedThread.authorHandle)}`}>
                    {getInitials(selectedThread.authorHandle)}
                  </div>
                  {selectedThread.authorHandle}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {formatRelative(selectedThread.createdAt)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" />
                  {selectedThread.viewCount} {t("thread.views")}
                </span>
              </div>
              <div className="prose prose-slate dark:prose-invert max-w-none">
                <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed" data-testid="text-thread-content">
                  {selectedThread.content}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-5">
              <h2 className="font-bold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#004182] dark:text-blue-400" />
                {t("thread.repliesCount", { count: posts.length })}
              </h2>
              <span className="flex items-center gap-1.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse inline-block" />
                {t("thread.live")}
              </span>
            </div>

            {postsLoading ? (
              <div className="text-center py-10 text-slate-500">
                <div className="w-8 h-8 border-2 border-[#004182] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                {t("thread.loading")}
              </div>
            ) : posts.length === 0 ? (
              <div className="glass-card rounded-2xl p-10 text-center">
                <p className="text-slate-500 dark:text-slate-400">{t("thread.noReplies")}</p>
              </div>
            ) : (
              posts.map((post) => {
                const isOwnPost = !!(myParticipant?.anonymousHandle && post.authorHandle === myParticipant.anonymousHandle);
                return (
                <div
                  key={post.id}
                  className={`thread-card-premium rounded-2xl ${post.isModeratorPost ? 'ring-1 ring-[#004182]/30' : ''} ${isOwnPost ? 'border-l-2 border-blue-400/70 bg-blue-500/[0.04]' : ''}`}
                  data-testid={`card-post-${post.id}`}
                >
                  <div className="p-5 sm:p-6">
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center font-bold text-sm text-white ${getAvatarColor(post.authorHandle)}`}
                        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                        {getInitials(post.authorHandle)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="font-bold text-slate-800 dark:text-white" data-testid={`text-post-author-${post.id}`}>
                            {post.authorHandle}
                          </span>
                          {post.isModeratorPost && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-[#004182]/10 text-[#004182] dark:text-blue-400">
                              <Shield className="w-3 h-3" />{t("thread.moderator")}
                            </span>
                          )}
                          {isOwnPost && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-500/15 text-blue-400 border border-blue-400/30" data-testid={`badge-own-post-${post.id}`}>
                              {t("thread.you")}
                            </span>
                          )}
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            {formatRelative(post.createdAt)}
                          </span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed" data-testid={`text-post-content-${post.id}`}>
                          {post.content}
                        </p>
                        <div className="flex items-center gap-4 mt-3">
                          <button className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-[#004182] dark:hover:text-blue-400 transition-colors">
                            <ThumbsUp className="w-4 h-4" />
                            <span>{post.likeCount}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
              })
            )}

            {!selectedThread.isLocked && (
              isAuthenticated ? (
                <div className="glass-card rounded-2xl mt-6 card-depth overflow-hidden" data-testid="card-reply-form">
                  <div className="p-5 sm:p-6">
                    <h3 className="font-bold text-lg text-slate-800 dark:text-white mb-4">{t("actions.postReply")}</h3>
                    <Textarea
                      placeholder={t("actions.replyPlaceholder")}
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      rows={4}
                      className="mb-4 rounded-xl border-slate-200 dark:border-slate-700 resize-none"
                      data-testid="input-reply-content"
                    />
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        {myParticipant?.anonymousHandle
                          ? <>{t("thread.postingAs")} <span className="font-semibold text-blue-400">{myParticipant.anonymousHandle}</span></>
                          : t("thread.postingAsAnonymous")}
                      </p>
                      <Button 
                        onClick={handleCreateReply}
                        disabled={!replyContent.trim() || createPostMutation.isPending}
                        className="bg-gradient-to-r from-[#004182] to-[#0066cc] hover:from-[#003366] hover:to-[#004182] text-white rounded-xl"
                        data-testid="button-submit-reply"
                      >
                        {createPostMutation.isPending ? t("actions.posting") : t("actions.submitReply")}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="glass-card rounded-2xl mt-6 card-depth overflow-hidden" data-testid="card-reply-signin-prompt">
                  <div className="p-5 sm:p-6 text-center">
                    <div className="w-10 h-10 bg-[#004182]/10 rounded-xl flex items-center justify-center mx-auto mb-3">
                      <Lock className="w-5 h-5 text-[#004182] dark:text-blue-400" />
                    </div>
                    <h3 className="font-semibold text-slate-800 dark:text-white mb-1">{t("thread.signInToReplyTitle")}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                      {t("thread.signInToReplyDesc")}
                    </p>
                    <Link href="/verify?redirect=/community">
                      <Button className="bg-gradient-to-r from-[#004182] to-[#0066cc] hover:from-[#003366] hover:to-[#004182] text-white rounded-xl" data-testid="button-reply-signin">
                        {t("thread.signInToReply")}
                      </Button>
                    </Link>
                  </div>
                </div>
              )
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen community-premium-bg">
      <header className="sticky top-0 z-50 border-b border-slate-200/60 dark:border-white/10 bg-white/92 dark:bg-slate-900/92 backdrop-blur-2xl"
        style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 4px 24px rgba(0,0,0,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-4">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  navigate(hasPortalSession() ? "/dashboard" : "/");
                }}
                data-testid="button-back-home"
                className="px-2 sm:px-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Home className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">{t("header.home")}</span>
              </Button>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
              <div className="flex items-center gap-1.5 sm:gap-2">
                <div className="w-7 h-7 bg-gradient-to-br from-[#004182] to-[#0066cc] rounded-lg flex items-center justify-center shadow-md">
                  <Shield className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-sm sm:text-lg text-[#004182] dark:text-blue-400">{t("header.brand")}</span>
                <span className="flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse inline-block" />
                  {t("header.live")}
                </span>
              </div>
            </div>
            <Dialog open={isNewThreadOpen} onOpenChange={isAuthenticated ? setIsNewThreadOpen : undefined}>
              <DialogTrigger asChild>
                {isAuthenticated ? (
                  <Button 
                    data-testid="button-new-thread" 
                    size="sm" 
                    className="text-xs sm:text-sm bg-gradient-to-r from-[#004182] to-[#0066cc] hover:from-[#003366] hover:to-[#004182] text-white shadow-md hover:shadow-lg transition-all"
                    style={{ boxShadow: '0 2px 8px rgba(0,65,130,0.3)' }}
                  >
                    <Plus className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t("actions.newDiscussion")}</span>
                    <span className="sm:hidden">{t("actions.newShort")}</span>
                  </Button>
                ) : (
                  <Link href="/verify?redirect=/community">
                    <Button
                      data-testid="button-new-thread"
                      size="sm"
                      variant="outline"
                      className="text-xs sm:text-sm border-[#004182] text-[#004182] dark:border-blue-400 dark:text-blue-400 hover:bg-[#004182]/10 shadow-sm transition-all"
                    >
                      <Lock className="w-4 h-4 sm:mr-2" />
                      <span className="hidden sm:inline">{t("actions.signInToPost")}</span>
                      <span className="sm:hidden">{t("actions.signInShort")}</span>
                    </Button>
                  </Link>
                )}
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{t("dialog.title")}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">{t("dialog.department")}</label>
                    <Select value={newThreadDepartment} onValueChange={setNewThreadDepartment}>
                      <SelectTrigger data-testid="select-thread-department">
                        <SelectValue placeholder={t("dialog.departmentPlaceholder")} />
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
                    <label className="text-sm font-medium mb-2 block">{t("dialog.titleLabel")}</label>
                    <Input
                      placeholder={t("dialog.titlePlaceholder")}
                      value={newThreadTitle}
                      onChange={(e) => setNewThreadTitle(e.target.value)}
                      data-testid="input-thread-title"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">{t("dialog.content")}</label>
                    <Textarea
                      placeholder={t("dialog.contentPlaceholder")}
                      value={newThreadContent}
                      onChange={(e) => setNewThreadContent(e.target.value)}
                      rows={5}
                      data-testid="input-thread-content"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsNewThreadOpen(false)}>{t("dialog.cancel")}</Button>
                  <Button 
                    onClick={handleCreateThread}
                    disabled={createThreadMutation.isPending}
                    data-testid="button-submit-thread"
                  >
                    {createThreadMutation.isPending ? t("dialog.creating") : t("dialog.create")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {/* Community Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[
            { label: t("stats.members"), value: stats?.members || 0, icon: Users, color: "from-blue-500 to-blue-700", testId: "card-stat-members", glow: "rgba(59,130,246,0.3)" },
            { label: t("stats.discussions"), value: stats?.threads || 0, icon: MessageSquare, color: "from-purple-500 to-purple-700", testId: "card-stat-threads", glow: "rgba(168,85,247,0.3)" },
            { label: t("stats.replies"), value: stats?.posts || 0, icon: MessageSquare, color: "from-emerald-500 to-emerald-700", testId: "card-stat-posts", glow: "rgba(16,185,129,0.3)" },
            { label: t("stats.departments"), value: departments.length, icon: Shield, color: "from-amber-500 to-orange-600", testId: "card-stat-departments", glow: "rgba(245,158,11,0.3)" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="relative rounded-2xl overflow-hidden card-depth transition-all duration-300 hover:-translate-y-1"
              data-testid={stat.testId}
              style={{
                background: 'white',
                boxShadow: '0 4px 20px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.8) inset'
              }}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${stat.color} opacity-5`} />
              <div className="p-3 sm:p-5 relative">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-widest mb-1">{stat.label}</p>
                    <p className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-white">{stat.value}</p>
                  </div>
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br ${stat.color} rounded-xl flex items-center justify-center`}
                    style={{ boxShadow: `0 4px 12px ${stat.glow}` }}>
                    <stat.icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-4">
            <div className="glass-card rounded-2xl overflow-hidden card-depth" data-testid="card-departments-filter">
              <div className="p-4 border-b border-slate-100 dark:border-slate-700/50">
                <h3 className="text-sm font-bold flex items-center gap-2 text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  <Filter className="w-4 h-4 text-[#004182] dark:text-blue-400" />
                  {t("sidebar.departments")}
                </h3>
              </div>
              <div className="p-3 space-y-1">
                <button
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    selectedDepartment === null
                      ? 'bg-[#004182] text-white shadow-md'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                  onClick={() => setSelectedDepartment(null)}
                  data-testid="button-filter-all"
                >
                  <MessageSquare className="w-4 h-4 shrink-0" />
                  {t("sidebar.allDiscussions")}
                </button>
                {departments.map((dept) => {
                  const IconComponent = departmentIcons[dept.icon] || Shield;
                  const isActive = selectedDepartment === dept.id;
                  return (
                    <button
                      key={dept.id}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                        isActive
                          ? 'text-white shadow-md'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                      style={isActive ? { backgroundColor: dept.color } : {}}
                      onClick={() => setSelectedDepartment(dept.id)}
                      data-testid={`button-filter-dept-${dept.id}`}
                    >
                      <span style={isActive ? { color: 'white' } : { color: dept.color }}>
                        <IconComponent className="w-4 h-4 shrink-0" />
                      </span>
                      {dept.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="glass-card rounded-2xl overflow-hidden card-depth" data-testid="card-community-guidelines">
              <div className="p-4 border-b border-slate-100 dark:border-slate-700/50">
                <h3 className="text-sm font-bold flex items-center gap-2 text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  <Shield className="w-4 h-4 text-emerald-500" />
                  {t("guidelines.title")}
                </h3>
              </div>
              <div className="p-4 text-sm text-slate-600 dark:text-slate-400 space-y-2.5">
                {[
                  t("guidelines.rule1"),
                  t("guidelines.rule2"),
                  t("guidelines.rule3"),
                  t("guidelines.rule4"),
                  t("guidelines.rule5")
                ].map((rule, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#004182]/10 text-[#004182] dark:text-blue-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    <p>{rule}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Thread list */}
          <div className="lg:col-span-3">
            <div className="mb-5 flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder={t("actions.search")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-11 rounded-xl border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm"
                  data-testid="input-search-threads"
                />
              </div>
            </div>

            {threadsLoading ? (
              <div className="text-center py-16 text-slate-500">
                <div className="w-8 h-8 border-2 border-[#004182] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                {t("loading")}
              </div>
            ) : threads.length === 0 ? (
              <div className="glass-card rounded-2xl p-14 text-center card-depth">
                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                </div>
                <h3 className="font-bold text-lg mb-2 text-slate-700 dark:text-slate-300">{t("empty.noThreads")}</h3>
                <p className="text-slate-500 dark:text-slate-400 mb-5 text-sm">
                  {isAuthenticated ? t("empty.ctaAuthed") : t("empty.ctaGuest")}
                </p>
                {isAuthenticated ? (
                  <Button 
                    onClick={() => setIsNewThreadOpen(true)}
                    className="bg-gradient-to-r from-[#004182] to-[#0066cc] text-white hover:from-[#003366] hover:to-[#004182]"
                  >
                    {t("actions.newThread")}
                  </Button>
                ) : (
                  <Link href="/verify?redirect=/community">
                    <Button className="bg-gradient-to-r from-[#004182] to-[#0066cc] text-white hover:from-[#003366] hover:to-[#004182]">
                      <Lock className="w-4 h-4 mr-2" />{t("actions.signInToPost")}
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {threads.map((thread) => {
                  const dept = getDepartment(thread.departmentId);
                  const isOwnThread = !!(myParticipant?.anonymousHandle && thread.authorHandle === myParticipant.anonymousHandle);
                  return (
                    <Link
                      key={thread.id}
                      href={`/community/${thread.id}`}
                      className={`thread-card-premium rounded-2xl cursor-pointer group block ${thread.isPinned ? 'ring-1 ring-[#004182]/20' : ''}`}
                      data-testid={`card-thread-${thread.id}`}
                    >
                      <div className="py-4 px-5">
                        <div className="flex items-start gap-4">
                          <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center font-bold text-sm text-white ${getAvatarColor(thread.authorHandle)}`}
                            style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                            {getInitials(thread.authorHandle)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              {thread.isPinned && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-[#004182]/10 text-[#004182] dark:text-blue-400">
                                  <Pin className="w-2.5 h-2.5" />{t("thread.pinned")}
                                </span>
                              )}
                              {thread.isLocked && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-700 text-slate-500">
                                  <Lock className="w-2.5 h-2.5" />{t("thread.locked")}
                                </span>
                              )}
                              {dept && (
                                <span 
                                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
                                  style={{ backgroundColor: `${dept.color}18`, color: dept.color }}
                                >
                                  {dept.name}
                                </span>
                              )}
                            </div>
                            <h3 className="font-bold text-base mb-1.5 text-slate-800 dark:text-white group-hover:text-[#004182] dark:group-hover:text-blue-400 transition-colors truncate" data-testid={`text-thread-title-${thread.id}`}>
                              {thread.title}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mb-3 leading-relaxed">
                              {thread.content}
                            </p>
                            <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
                              <span className="font-medium flex items-center gap-1.5">
                                {thread.authorHandle}
                                {isOwnThread && (
                                  <span
                                    className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-500/15 text-blue-400 border border-blue-400/30"
                                    data-testid={`badge-own-thread-${thread.id}`}
                                  >
                                    {t("thread.you")}
                                  </span>
                                )}
                              </span>
                              <span className="flex items-center gap-1">
                                <Eye className="w-3 h-3" />
                                {thread.viewCount}
                              </span>
                              <span className="flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                {thread.replyCount} {t("thread.replies")}
                              </span>
                              <span className="flex items-center gap-1 hidden sm:flex">
                                <Clock className="w-3 h-3" />
                                {formatRelative(thread.lastActivityAt)}
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0 group-hover:text-[#004182] dark:group-hover:text-blue-400 transition-colors" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          <div className="mt-12 flex justify-center">
            <BuildStampLine className="text-slate-500" />
          </div>
        </div>
      </main>
    </div>
  );
}
