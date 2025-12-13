import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, MessageCircle, Send, ChevronDown } from "lucide-react";
import { useAdmin, Case, ChatTemplate, playNotificationSound } from "./AdminContext";

export function Conversations() {
  const { 
    cases, 
    chatCase, 
    setChatCase, 
    chatMessages, 
    setChatMessages,
    unreadCounts,
    chatTemplates,
    authToken,
    toast,
    lastMessageCountRef,
    isInitialLoadRef
  } = useAdmin();
  
  const [newMessage, setNewMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const loadChatMessages = async (caseId: string) => {
    try {
      const res = await fetch(`/api/chat/${caseId}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const messages = await res.json();
        const currentCount = messages.length;
        const lastCount = lastMessageCountRef.current[caseId] || 0;
        
        if (!isInitialLoadRef.current && currentCount > lastCount) {
          const newMessages = messages.slice(lastCount);
          const hasNewUserMessage = newMessages.some((m: any) => m.sender === 'user');
          if (hasNewUserMessage) {
            playNotificationSound();
          }
        }
        lastMessageCountRef.current[caseId] = currentCount;
        
        if (isInitialLoadRef.current) {
          isInitialLoadRef.current = false;
        }
        
        setChatMessages(messages);
        
        await fetch(`/api/chat/${caseId}/read`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        setTimeout(() => {
          if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
          }
        }, 100);
      }
    } catch (error) {
      console.error('Failed to load chat messages:', error);
    }
  };

  const sendChatMessage = async () => {
    if (!chatCase || !newMessage.trim() || isSendingMessage) return;
    
    setIsSendingMessage(true);
    try {
      const res = await fetch(`/api/chat/${chatCase.id}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          sender: 'admin',
          message: newMessage.trim()
        })
      });
      
      if (res.ok) {
        setNewMessage("");
        loadChatMessages(chatCase.id);
      } else {
        toast({ variant: "destructive", title: "Error", description: "Failed to send message." });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Network error occurred." });
    } finally {
      setIsSendingMessage(false);
    }
  };

  const useTemplate = async (template: ChatTemplate) => {
    setNewMessage(template.content);
    setShowTemplateDropdown(false);
    try {
      await fetch(`/api/chat-templates/${template.id}/use`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
    } catch (error) {
      console.error('Failed to increment template usage:', error);
    }
  };

  useEffect(() => {
    if (chatCase) {
      const interval = setInterval(() => {
        loadChatMessages(chatCase.id);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [chatCase?.id]);

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">User Conversations</h2>
        <p className="text-slate-400 text-sm">View and respond to user messages in real-time.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-slate-950 border-slate-800 lg:col-span-1">
          <CardHeader className="border-b border-slate-800 py-3">
            <CardTitle className="text-base text-white">Active Chats</CardTitle>
          </CardHeader>
          <ScrollArea className="h-[300px] lg:h-[500px]">
            <div className="p-2">
              {cases.filter(c => c.userName).map((c) => (
                <div
                  key={c.id}
                  className={`p-3 rounded-lg cursor-pointer mb-2 transition-colors ${
                    chatCase?.id === c.id 
                      ? 'bg-blue-600/20 border border-blue-500/50' 
                      : 'bg-slate-900/50 hover:bg-slate-800 border border-transparent'
                  }`}
                  onClick={() => {
                    setChatCase(c);
                    loadChatMessages(c.id);
                  }}
                  data-testid={`chat-user-${c.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                        <User className="w-5 h-5 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">{c.userName}</p>
                        <p className="text-slate-500 text-xs">{c.accessCode}</p>
                      </div>
                    </div>
                    {unreadCounts[c.id] > 0 && (
                      <Badge className="bg-red-500 text-white animate-pulse">
                        {unreadCounts[c.id]}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
              {cases.filter(c => c.userName).length === 0 && (
                <div className="text-center py-8 text-slate-500">
                  <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No active conversations</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </Card>

        <Card className="bg-slate-950 border-slate-800 lg:col-span-2">
          {chatCase ? (
            <>
              <CardHeader className="border-b border-slate-800 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                      <User className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-base text-white">{chatCase.userName}</CardTitle>
                      <p className="text-xs text-slate-400">{chatCase.userEmail}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-slate-400 border-slate-700">
                    {chatCase.accessCode}
                  </Badge>
                </div>
              </CardHeader>
              <div ref={chatScrollRef} className="h-[250px] lg:h-[350px] overflow-y-auto p-4 space-y-3 bg-slate-900/30">
                {chatMessages.length === 0 ? (
                  <div className="text-center text-slate-500 mt-12">
                    <MessageCircle className="h-12 w-12 mx-auto text-slate-700 mb-3" />
                    <p className="text-sm">No messages yet</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sender === 'admin' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[70%] px-4 py-2 rounded-2xl ${
                          msg.sender === 'admin'
                            ? 'bg-blue-600 text-white rounded-br-md'
                            : 'bg-slate-800 text-slate-100 rounded-bl-md'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                        <p className={`text-xs mt-1 ${msg.sender === 'admin' ? 'text-blue-200' : 'text-slate-500'}`}>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <CardFooter className="border-t border-slate-800 p-3">
                <div className="flex gap-2 w-full relative">
                  {chatTemplates.length > 0 && (
                    <div className="relative">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                        className="border-slate-700 text-slate-400"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      {showTemplateDropdown && (
                        <div className="absolute bottom-full mb-2 left-0 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 min-w-[200px]">
                          {chatTemplates.map(t => (
                            <button
                              key={t.id}
                              onClick={() => useTemplate(t)}
                              className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 first:rounded-t-lg last:rounded-b-lg"
                            >
                              {t.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <Input
                    placeholder="Type your message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChatMessage()}
                    disabled={isSendingMessage}
                    className="flex-1 bg-slate-900 border-slate-700 text-white"
                    data-testid="input-admin-chat"
                  />
                  <Button
                    onClick={sendChatMessage}
                    disabled={!newMessage.trim() || isSendingMessage}
                    className="bg-blue-600 hover:bg-blue-700"
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
                <MessageCircle className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">Select a conversation</p>
                <p className="text-sm">Choose a user from the list to start chatting</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default Conversations;
