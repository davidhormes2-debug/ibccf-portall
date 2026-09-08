import { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, Send, Mail, Phone, MapPin, Network, Clock3, ShieldCheck, Search, Inbox, MessageSquareText, Archive, ArchiveRestore, MessagesSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAdminDashboard } from "../AdminDashboardContext";

function decodeMessageText(value: string): string {
  if (!value || typeof document === "undefined") return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

type ConversationFilter = 'inbox' | 'unread' | 'all' | 'archived';

function formatLastSeen(value?: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function ConversationsTab() {
  const {
    authToken,
    adminRole,
    cases,
    chatCase,
    setChatCase,
    chatMessages,
    loadChatMessages,
    sendChatMessage,
    chatScrollRef,
    handleChatScroll,
    newMessage,
    setNewMessage,
    isSendingMessage,
    unreadCounts,
    loadData,
  } = useAdminDashboard();

  const { toast } = useToast();
  const [conversationQuery, setConversationQuery] = useState("");
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('inbox');
  const [archiveBusy, setArchiveBusy] = useState(false);

  const conversationCases = useMemo(() => cases.filter((c) => c.userName), [cases]);
  const counts = useMemo(() => ({
    inbox: conversationCases.filter((c) => !c.chatArchivedAt).length,
    unread: conversationCases.filter((c) => !c.chatArchivedAt && (unreadCounts[c.id] || 0) > 0).length,
    all: conversationCases.length,
    archived: conversationCases.filter((c) => !!c.chatArchivedAt).length,
  }), [conversationCases, unreadCounts]);

  const visibleCases = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    return conversationCases
      .filter((c) => {
        const archived = !!c.chatArchivedAt;
        if (conversationFilter === 'inbox' && archived) return false;
        if (conversationFilter === 'unread' && (archived || (unreadCounts[c.id] || 0) === 0)) return false;
        if (conversationFilter === 'archived' && !archived) return false;
        if (!query) return true;
        return [c.userName, c.userEmail, c.userMobile, c.accessCode, c.caseRef]
          .some((value) => String(value ?? '').toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const unreadDelta = (unreadCounts[b.id] || 0) - (unreadCounts[a.id] || 0);
        if (unreadDelta !== 0) return unreadDelta;
        const aSeen = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
        const bSeen = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
        return bSeen - aSeen;
      });
  }, [conversationCases, conversationFilter, conversationQuery, unreadCounts]);

  const canManageArchive = adminRole === 'admin' || adminRole === 'super_admin';

  const toggleArchive = async () => {
    if (!chatCase || !authToken || archiveBusy || !canManageArchive) return;
    const restoring = !!chatCase.chatArchivedAt;
    setArchiveBusy(true);
    try {
      const res = await fetch(`/api/cases/${chatCase.id}/conversation/archive`, {
        method: restoring ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadData();
      setChatCase(null);
      setNewMessage("");
      setConversationFilter(restoring ? 'inbox' : 'inbox');
      toast({
        title: restoring ? 'Conversation restored' : 'Conversation archived',
        description: restoring
          ? 'The chat is back in the inbox.'
          : 'The chat is hidden from the inbox but all history is preserved.',
      });
    } catch {
      toast({
        variant: 'destructive',
        title: restoring ? 'Could not restore conversation' : 'Could not archive conversation',
        description: 'Nothing was deleted. Please try again.',
      });
    } finally {
      setArchiveBusy(false);
    }
  };

  const filterItems: Array<{ key: ConversationFilter; label: string; count: number; icon: typeof Inbox }> = [
    { key: 'inbox', label: 'Inbox', count: counts.inbox, icon: Inbox },
    { key: 'unread', label: 'Unread', count: counts.unread, icon: MessageSquareText },
    { key: 'all', label: 'All chats', count: counts.all, icon: MessagesSquare },
    { key: 'archived', label: 'Archived', count: counts.archived, icon: Archive },
  ];

  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">User Conversations</h2>
        <p className="text-slate-400 text-sm">Full-fidelity live chat with visitor context and complete message rendering.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-slate-950 border-slate-800 lg:col-span-1 overflow-hidden">
          <div className="flex h-[360px] lg:h-[620px] min-h-0">
            <div className="w-14 shrink-0 border-r border-slate-800 bg-slate-950/90 py-3 flex flex-col items-center gap-2">
              {filterItems.map((item) => {
                const Icon = item.icon;
                const active = conversationFilter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setConversationFilter(item.key)}
                    title={`${item.label} (${item.count})`}
                    aria-label={`${item.label}, ${item.count}`}
                    aria-pressed={active}
                    className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all border ${
                      active
                        ? 'bg-blue-600/20 text-blue-300 border-blue-500/40 shadow-[0_4px_16px_rgba(37,99,235,0.18)]'
                        : 'text-slate-500 border-transparent hover:text-slate-200 hover:bg-slate-900 hover:border-slate-800'
                    }`}
                    data-testid={`conversation-filter-${item.key}`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.count > 0 && (item.key === 'unread' || item.key === 'archived') && (
                      <span className={`absolute -right-1 -top-1 min-w-4 h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${
                        item.key === 'unread' ? 'bg-red-500 text-white' : 'bg-slate-700 text-slate-200'
                      }`}>
                        {item.count > 99 ? '99+' : item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-w-0 flex flex-col">
              <CardHeader className="border-b border-slate-800 p-3 space-y-3 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm text-white flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-blue-400" />
                    {filterItems.find((item) => item.key === conversationFilter)?.label || 'Messages'}
                  </CardTitle>
                  <Badge variant="outline" className="border-slate-700 text-slate-500 text-[10px]">
                    {visibleCases.length}
                  </Badge>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                  <Input
                    value={conversationQuery}
                    onChange={(e) => setConversationQuery(e.target.value)}
                    placeholder="Find name, email, phone or code"
                    className="h-9 pl-9 bg-slate-900 border-slate-800 text-white text-xs placeholder:text-slate-600"
                    data-testid="conversation-search"
                  />
                </div>
              </CardHeader>

              <ScrollArea className="flex-1 min-h-0">
                <div className="p-2" aria-label="Conversation sessions">
                  {visibleCases.map((c) => {
                    const isActive = chatCase?.id === c.id;
                    const initials = (c.userName || '?').slice(0, 2).toUpperCase();
                    const unread = unreadCounts[c.id] || 0;
                    const archived = !!c.chatArchivedAt;
                    const ariaLabel = `${c.userName}${c.userEmail ? `, ${c.userEmail}` : ''}, access code ${c.accessCode}${unread > 0 ? `, ${unread} unread message${unread === 1 ? '' : 's'}` : ''}${archived ? ', archived' : ''}${isActive ? ', currently selected' : ''}`;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        id={`chat-user-${c.id}`}
                        aria-current={isActive ? 'true' : undefined}
                        aria-label={ariaLabel}
                        className={`relative w-full text-left p-3 rounded-xl mb-1.5 transition-all border outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                          isActive ? 'border-blue-400/40 bg-blue-500/10' : 'border-transparent hover:border-slate-700 hover:bg-slate-900/80'
                        }`}
                        onClick={() => {
                          setChatCase(c);
                          loadChatMessages(c.id);
                        }}
                        data-testid={`chat-user-${c.id}`}
                      >
                        {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 rounded-r bg-blue-400" />}
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center font-semibold text-[11px] text-white bg-gradient-to-br from-[#004182] to-[#0a3a8c] border border-blue-400/20">
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-white font-medium text-sm truncate">{c.userName}</p>
                              {archived && <Archive className="ml-auto w-3.5 h-3.5 text-slate-600 shrink-0" aria-label="Archived" />}
                              {unread > 0 && (
                                <Badge className="ml-auto h-5 min-w-5 px-1.5 bg-red-500 text-white border-0 text-[10px] shrink-0">
                                  {unread}
                                </Badge>
                              )}
                            </div>
                            <p className="text-slate-500 text-[11px] truncate mt-0.5">{c.userEmail || c.userMobile || c.accessCode}</p>
                            <div className="flex items-center justify-between gap-2 mt-1">
                              <span className="text-[10px] font-mono text-slate-600 truncate">{c.accessCode}</span>
                              {c.lastLoginAt && <span className="text-[10px] text-slate-700 shrink-0">{new Date(c.lastLoginAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {visibleCases.length === 0 && (
                    <div className="text-center py-12 text-slate-500 px-4">
                      <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">{conversationQuery ? 'No chats match your search' : conversationFilter === 'archived' ? 'No archived chats' : 'No conversations here'}</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-950 border-slate-800 lg:col-span-2 overflow-hidden flex flex-col min-h-[620px]">
          {chatCase ? (
            <>
              <CardHeader className="border-b border-slate-800 py-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <div className="absolute inset-0 rounded-full bg-blue-500 blur-md opacity-40" />
                      <div className="relative w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm text-white bg-gradient-to-br from-[#004182] via-[#0a3a8c] to-[#001a3d] border border-blue-400/20"
                        style={{ boxShadow: '0 4px 12px rgba(0,65,130,0.4), inset 0 1px 0 rgba(255,255,255,0.12)' }}>
                        {(chatCase.userName || '?').slice(0, 2).toUpperCase()}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base text-white break-words">{chatCase.userName || 'Unknown user'}</CardTitle>
                      <p className="text-xs text-slate-400 break-all">{chatCase.userEmail || 'No email on file'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {chatCase.chatArchivedAt && (
                      <Badge variant="outline" className="border-slate-700 text-slate-400 text-[10px]">Archived</Badge>
                    )}
                    <Badge variant="outline" className="text-slate-300 border-slate-700 font-mono text-[11px] shrink-0">
                      {chatCase.accessCode}
                    </Badge>
                    {canManageArchive && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={toggleArchive}
                        disabled={archiveBusy}
                        className="h-8 w-8 p-0 border-slate-700 bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800"
                        title={chatCase.chatArchivedAt ? 'Restore conversation to inbox' : 'Archive conversation'}
                        aria-label={chatCase.chatArchivedAt ? 'Restore conversation to inbox' : 'Archive conversation'}
                        data-testid="button-toggle-chat-archive"
                      >
                        {chatCase.chatArchivedAt ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 min-w-0">
                    <div className="flex items-center gap-2 text-slate-500 mb-1"><Mail className="w-3.5 h-3.5" /> Email</div>
                    <div className="text-slate-200 break-all">{chatCase.userEmail || 'Not provided'}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 min-w-0">
                    <div className="flex items-center gap-2 text-slate-500 mb-1"><Phone className="w-3.5 h-3.5" /> Phone</div>
                    <div className="text-slate-200 break-all">{chatCase.userMobile || 'Not provided'}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 min-w-0">
                    <div className="flex items-center gap-2 text-slate-500 mb-1"><Network className="w-3.5 h-3.5" /> Last IP</div>
                    <div className="text-slate-200 break-all font-mono">{chatCase.lastLoginIp || 'Not available'}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 min-w-0">
                    <div className="flex items-center gap-2 text-slate-500 mb-1"><MapPin className="w-3.5 h-3.5" /> Country</div>
                    <div className="text-slate-200 break-words">{chatCase.country || 'Not available'}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 min-w-0">
                    <div className="flex items-center gap-2 text-slate-500 mb-1"><Clock3 className="w-3.5 h-3.5" /> Last seen</div>
                    <div className="text-slate-200 break-words">{formatLastSeen(chatCase.lastLoginAt)}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5 min-w-0">
                    <div className="flex items-center gap-2 text-slate-500 mb-1"><ShieldCheck className="w-3.5 h-3.5" /> Status</div>
                    <div className="text-slate-200 break-words capitalize">{chatCase.status}{chatCase.vipStatus ? ` · ${chatCase.vipStatus}` : ''}</div>
                  </div>
                </div>
              </CardHeader>

              <div
                ref={chatScrollRef}
                onScroll={handleChatScroll}
                className="flex-1 min-h-[300px] max-h-[520px] overflow-y-auto p-4 sm:p-5 space-y-3"
                style={{ background: 'linear-gradient(180deg, rgba(2,9,18,0.4) 0%, rgba(2,9,18,0.65) 100%)' }}
              >
                {chatMessages.length === 0 ? (
                  <div className="text-center text-slate-500 mt-12">
                    <div className="relative w-14 h-14 mx-auto mb-3">
                      <div className="absolute inset-0 rounded-full bg-blue-500/10 blur-lg" />
                      <MessageCircle className="relative h-14 w-14 mx-auto text-slate-700" />
                    </div>
                    <p className="text-sm">No messages yet</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => {
                    const isAdmin = msg.sender === 'admin';
                    const renderedMessage = decodeMessageText(msg.message);
                    return (
                      <div key={msg.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[88%] sm:max-w-[78%] px-4 py-2.5 rounded-2xl ${isAdmin ? 'rounded-br-md text-white' : 'rounded-bl-md text-slate-100'}`}
                          style={isAdmin ? {
                            background: 'linear-gradient(135deg, #004182 0%, #0a3a8c 100%)',
                            boxShadow: '0 4px 12px rgba(0,65,130,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
                          } : {
                            background: 'rgba(30,41,59,0.88)',
                            border: '1px solid rgba(148,163,184,0.12)',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                            backdropFilter: 'blur(8px)',
                          }}
                        >
                          <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed select-text">{renderedMessage}</p>
                          <p className={`text-[10px] mt-1.5 font-medium ${isAdmin ? 'text-blue-200/80' : 'text-slate-500'}`}>
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <CardFooter className="border-t border-slate-800 p-3 bg-slate-950/95 sticky bottom-0">
                <div className="flex gap-2 w-full items-end">
                  <Textarea
                    placeholder="Type your message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendChatMessage();
                      }
                    }}
                    disabled={isSendingMessage}
                    rows={1}
                    className="flex-1 min-h-10 max-h-32 resize-none bg-slate-900 border-slate-700 text-white focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 transition-all"
                    data-testid="input-admin-chat"
                  />
                  <Button
                    onClick={sendChatMessage}
                    disabled={!newMessage.trim() || isSendingMessage}
                    className="text-white border-0 transition-all hover:brightness-110 active:scale-[0.98] shrink-0"
                    style={{
                      background: 'linear-gradient(135deg, #004182 0%, #0a3a8c 100%)',
                      boxShadow: '0 4px 12px rgba(0,65,130,0.4), inset 0 1px 0 rgba(255,255,255,0.12)',
                    }}
                    data-testid="button-send-admin-chat"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardFooter>
            </>
          ) : (
            <div className="h-[300px] lg:h-[620px] flex items-center justify-center text-slate-500">
              <div className="text-center">
                <div className="relative w-20 h-20 mx-auto mb-5">
                  <div className="absolute inset-0 rounded-2xl bg-blue-500/15 blur-xl" />
                  <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center bg-gradient-to-br from-slate-800/60 to-slate-900/60 border border-slate-700/40"
                    style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
                    <MessageCircle className="w-10 h-10 text-blue-400/70" />
                  </div>
                </div>
                <p className="text-lg font-semibold text-slate-300">Select a conversation</p>
                <p className="text-sm mt-1">Choose a user from the list to start chatting</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}