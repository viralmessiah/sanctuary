import React, { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send, MessageSquare, ArrowLeft, Search } from "lucide-react";

export default function Messages() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState("");
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [searchingRecipients, setSearchingRecipients] = useState(false);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connectionState, setConnectionState] = useState("connecting");
  const [messageVersion, setMessageVersion] = useState(0);
  const messagesEndRef = useRef(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  async function load() {
    try {
      const convs = await api.entities.Conversation.list("-last_message_date", 500);
      setConversations(convs);
      const conversationId = searchParams.get("conversation_id");
      setSelected((current) => {
        const targetId = conversationId || current?.id;
        const refreshed = convs.find((conversation) => conversation.id === targetId);
        if (!refreshed) return current;
        if (
          current?.id === refreshed.id
          && current.last_message === refreshed.last_message
          && current.last_message_date === refreshed.last_message_date
        ) return current;
        return refreshed;
      });
      setError("");
    } catch (err) {
      setError(err.message || "Unable to load your conversations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const query = recipientQuery.trim();
    if (!query) {
      setRecipients([]);
      return undefined;
    }
    let active = true;
    const timeout = setTimeout(async () => {
      setSearchingRecipients(true);
      try {
        const results = await api.messaging.searchRecipients(query);
        if (active) setRecipients(results);
      } catch (err) {
        if (active) setError(err.message || "Unable to search system users.");
      } finally {
        if (active) setSearchingRecipients(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [recipientQuery]);

  useEffect(() => api.messaging.connect((event) => {
    if (event.type !== "message.created") return;
    setMessageVersion((version) => version + 1);
    loadRef.current();
  }, setConnectionState), [user?.id]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const refresh = async () => {
      try {
        const msgs = await api.entities.Message.filter({ conversation_id: selected.id }, "created_date", 500);
        if (!active) return;
        setMessages(msgs);
        const unread = msgs.filter((m) => m.recipient_id === user.id && !m.read);
        await Promise.all(unread.map((message) => api.entities.Message.update(message.id, { read: true })));
        if (unread.length) await load();
        setError("");
      } catch (err) {
        if (active) setError(err.message || "Unable to refresh this conversation.");
      }
    };
    refresh();
    const interval = connectionState === "connected" ? null : setInterval(refresh, 3000);
    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [selected?.id, connectionState, messageVersion, user?.id]);

  useEffect(() => {
    if (connectionState === "connected") return undefined;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [connectionState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!content.trim() || !selected) return;
    setBusy(true);
    setError("");
    try {
      const msg = await api.entities.Message.create({
        conversation_id: selected.id,
        sender_id: user.id,
        recipient_id: selected.user1_id === user.id ? selected.user2_id : selected.user1_id,
        content: content.trim(),
      });
      setMessages((prev) => prev.some((item) => item.id === msg.id) ? prev : [...prev, msg]);
      setContent("");
      await load();
    } catch (err) {
      setError(err.message || "Your message could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const startConversation = async (recipient) => {
    setStarting(true);
    setError("");
    try {
      const conversation = await api.messaging.startConversation(recipient.id);
      setSelected(conversation);
      setMessages([]);
      setRecipientQuery("");
      setRecipients([]);
      await load();
    } catch (err) {
      setError(err.message || "Unable to start a conversation.");
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-700" /></div>;

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Messages</h1>
        <span className={`text-xs ${connectionState === "connected" ? "text-emerald-700" : "text-amber-700"}`}>
          {connectionState === "connected" ? "Live connection" : "Reconnecting · temporary refresh enabled"}
        </span>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden" style={{ height: "70vh" }}>
        <div className="flex h-full">
          <div className={`border-r border-slate-100 overflow-y-auto ${selected ? "hidden sm:block sm:w-64" : "w-full"}`}>
            <div className="border-b border-slate-100 p-3">
              <label className="relative block">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                  type="search"
                  value={recipientQuery}
                  onChange={(event) => setRecipientQuery(event.target.value)}
                  placeholder="Find a user or staff"
                  aria-label="Find a user or staff to message"
                  className="pl-9"
              />
              </label>
              {recipientQuery.trim() && (
                <div className="mt-2 max-h-56 overflow-y-auto">
                  {searchingRecipients && <p className="p-2 text-xs text-slate-500">Searching users…</p>}
                  {!searchingRecipients && recipients.length === 0 && (
                    <p className="p-2 text-xs text-slate-500">No matching active users found.</p>
                  )}
                  {recipients.map((recipient) => (
                    <button
                      key={recipient.id}
                      type="button"
                      disabled={starting}
                      onClick={() => startConversation(recipient)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg p-2 text-left hover:bg-emerald-50 disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {recipient.full_name || "Unnamed user"}
                        </span>
                        <span className="block truncate text-xs text-slate-500">{recipient.email}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] capitalize text-slate-600">
                        {recipient.role === "admin" ? "Admin" : (recipient.user_type || "User").replaceAll("_", " ")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {conversations.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                No conversations yet.
              </div>
            ) : (
              conversations.map((c) => {
                const otherName = c.user1_id === user.id ? c.user2_name : c.user1_name;
                return (
                  <button key={c.id} onClick={() => setSelected(c)} className={`w-full text-left p-3 border-b border-slate-50 hover:bg-slate-50 ${selected?.id === c.id ? "bg-emerald-50" : ""}`}>
                    <p className="text-sm font-medium text-slate-900">{otherName}</p>
                    <p className="text-xs text-slate-400 truncate">{c.last_message || "Start a conversation"}</p>
                    <p className="text-[10px] text-slate-300 mt-0.5">{c.last_message_date ? new Date(c.last_message_date).toLocaleDateString() : ""}</p>
                  </button>
                );
              })
            )}
          </div>

          {selected ? (
            <div className="flex-1 flex flex-col">
              <div className="p-3 border-b border-slate-100 flex items-center gap-2">
                <button onClick={() => setSelected(null)} className="sm:hidden text-slate-400"><ArrowLeft className="w-4 h-4" /></button>
                <p className="font-medium text-slate-900">{selected.user1_id === user.id ? selected.user2_name : selected.user1_name}</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender_id === user.id ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${m.sender_id === user.id ? "bg-emerald-800 text-white" : "bg-slate-100 text-slate-900"}`}>
                      {m.content}
                      <p className={`text-[10px] mt-0.5 ${m.sender_id === user.id ? "text-emerald-200" : "text-slate-400"}`}>{new Date(m.created_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={send} className="p-3 border-t border-slate-100 flex gap-2">
                <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Type a message..." className="flex-1" />
                <Button type="submit" disabled={busy || !content.trim()} className="bg-emerald-800 hover:bg-emerald-900"><Send className="w-4 h-4" /></Button>
              </form>
            </div>
          ) : (
            <div className="hidden sm:flex flex-1 items-center justify-center text-sm text-slate-400">
              <div className="text-center">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                Select a conversation to start chatting.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}