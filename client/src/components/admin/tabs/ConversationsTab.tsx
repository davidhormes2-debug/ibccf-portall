import { Card, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, Send } from "lucide-react";
import { useAdminDashboard } from "../AdminDashboardContext";

export function ConversationsTab() {
  const {
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
  } = useAdminDashboard();

  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">User Conversations</h2>
        <p className="text-slate-400 text-sm">View and respond to user messages in real-time.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Conversation List */}
        <Card className="bg-slate-950 border-slate-800 lg:col-span-1">
          <CardHeader className="border-b border-slate-800 py-3">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-blue-400" />
              Active Chats
            </CardTitle>
          </CardHeader>
          <ScrollArea className="h-[300px] lg:h-[500px]">
            <div className="p-2" aria-label="Active conversations">
              {cases.filter(c => c.userName).map((c) => {
                const isActive = chatCase?.id === c.id;
                const initials = (c.userName || '?').slice(0, 2).toUpperCase();
                const unread = unreadCounts[c.id] || 0;
                const ariaLabel = `${c.userName}${c.userEmail ? `, ${c.userEmail}` : ''}, access code ${c.accessCode}${unread > 0 ? `, ${unread} unread message${unread === 1 ? '' : 's'}` : ''}${isActive ? ', currently selected' : ''}`;
                return (
                  <button
                    key={c.id}
                    type="button"
                    id={`chat-user-${c.id}`}
                    aria-current={isActive ? 'true' : undefined}
                    aria-label={ariaLabel}
                    className={`relative w-full text-left p-3 rounded-xl mb-2 transition-all border outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
                      isActive
                        ? 'border-blue-400/40'
                        : 'border-transparent hover:border-blue-400/20'
                    }`}
                    style={isActive ? {
                      background: 'linear-gradient(135deg, rgba(0,65,130,0.35) 0%, rgba(10,58,140,0.25) 100%)',
                      boxShadow: '0 4px 16px rgba(0,65,130,0.25), inset 0 1px 0 rgba(255,255,255,0.06)',
                    } : {
                      background: 'rgba(15,23,42,0.4)',
                    }}
                    onClick={() => {
                      setChatCase(c);
                      loadChatMessages(c.id);
                    }}
                    data-testid={`chat-user-${c.id}`}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-7 rounded-r bg-gradient-to-b from-blue-400 to-blue-600 shadow-[0_0_8px_rgba(96,165,250,0.6)]" />
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <div className="absolute inset-0 rounded-full bg-blue-500 blur-md opacity-30" />
                          <div className="relative w-10 h-10 rounded-full flex items-center justify-center font-semibold text-xs text-white bg-gradient-to-br from-[#004182] via-[#0a3a8c] to-[#001a3d] border border-blue-400/20"
                            style={{ boxShadow: '0 2px 8px rgba(0,65,130,0.4), inset 0 1px 0 rgba(255,255,255,0.12)' }}>
                            {initials}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="text-white font-medium text-sm truncate">{c.userName}</p>
                          <p className="text-slate-500 text-xs font-mono">{c.accessCode}</p>
                        </div>
                      </div>
                      {unreadCounts[c.id] > 0 && (
                        <Badge className="bg-red-500 text-white border-0 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.55)]">
                          {unreadCounts[c.id]}
                        </Badge>
                      )}
                    </div>
                  </button>
                );
              })}
              {cases.filter(c => c.userName).length === 0 && (
                <div className="text-center py-12 text-slate-500">
                  <div className="relative w-14 h-14 mx-auto mb-3">
                    <div className="absolute inset-0 rounded-full bg-blue-500/10 blur-lg" />
                    <MessageCircle className="relative w-14 h-14 mx-auto opacity-40" />
                  </div>
                  <p className="text-sm">No active conversations</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* Chat Window */}
        <Card className="bg-slate-950 border-slate-800 lg:col-span-2 overflow-hidden">
          {chatCase ? (
            <>
              <CardHeader className="border-b border-slate-800 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-blue-500 blur-md opacity-40" />
                      <div className="relative w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm text-white bg-gradient-to-br from-[#004182] via-[#0a3a8c] to-[#001a3d] border border-blue-400/20"
                        style={{ boxShadow: '0 4px 12px rgba(0,65,130,0.4), inset 0 1px 0 rgba(255,255,255,0.12)' }}>
                        {(chatCase.userName || '?').slice(0, 2).toUpperCase()}
                      </div>
                    </div>
                    <div>
                      <CardTitle className="text-base text-white">{chatCase.userName}</CardTitle>
                      <p className="text-xs text-slate-400">{chatCase.userEmail}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-slate-300 border-slate-700 font-mono text-[11px]">
                    {chatCase.accessCode}
                  </Badge>
                </div>
              </CardHeader>
              <div
                ref={chatScrollRef}
                onScroll={handleChatScroll}
                className="h-[250px] lg:h-[350px] overflow-y-auto p-4 space-y-3"
                style={{ background: 'linear-gradient(180deg, rgba(2,9,18,0.4) 0%, rgba(2,9,18,0.6) 100%)' }}
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
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[70%] px-4 py-2.5 rounded-2xl ${
                            isAdmin ? 'rounded-br-md text-white' : 'rounded-bl-md text-slate-100'
                          }`}
                          style={isAdmin ? {
                            background: 'linear-gradient(135deg, #004182 0%, #0a3a8c 100%)',
                            boxShadow: '0 4px 12px rgba(0,65,130,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
                          } : {
                            background: 'rgba(30,41,59,0.85)',
                            border: '1px solid rgba(148,163,184,0.12)',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                            backdropFilter: 'blur(8px)',
                          }}
                        >
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                          <p className={`text-[10px] mt-1.5 font-medium ${isAdmin ? 'text-blue-200/80' : 'text-slate-500'}`}>
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <CardFooter className="border-t border-slate-800 p-3">
                <div className="flex gap-2 w-full">
                  <Input
                    placeholder="Type your message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChatMessage()}
                    disabled={isSendingMessage}
                    className="flex-1 bg-slate-900 border-slate-700 text-white focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 transition-all"
                    data-testid="input-admin-chat"
                  />
                  <Button
                    onClick={sendChatMessage}
                    disabled={!newMessage.trim() || isSendingMessage}
                    className="text-white border-0 transition-all hover:brightness-110 active:scale-[0.98]"
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
            <div className="h-[300px] lg:h-[500px] flex items-center justify-center text-slate-500">
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
