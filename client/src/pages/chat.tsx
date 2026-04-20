import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Hash, Users, Send, Plus, Wifi, WifiOff, Circle, MessageSquare, MoreHorizontal
} from "lucide-react";
import type { ChatRoom, ChatMessage } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
interface OnlineUser {
  userId: string;
  userName: string;
  userRole: string;
  connectedAt: number;
}

type WsMsg =
  | { type: "rooms";        rooms: ChatRoom[] }
  | { type: "history";      roomId: number; messages: ChatMessage[] }
  | { type: "message";      message: ChatMessage }
  | { type: "presence";     online: OnlineUser[] }
  | { type: "user_joined";  userId: string; userName: string; userRole: string; online: OnlineUser[] }
  | { type: "user_left";    userId: string; userName: string; online: OnlineUser[] }
  | { type: "typing";       roomId: number; userId: string; userName: string }
  | { type: "pong" };

// ── Role badge colour ──────────────────────────────────────────────────────────
function roleBadge(role: string) {
  if (role === "admin")      return "bg-rose-500/20 text-rose-400 border-rose-500/30";
  if (role === "management") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return                            "bg-slate-500/20 text-slate-400 border-slate-500/30";
}

function roleLabel(role: string) {
  if (role === "admin")      return "Admin";
  if (role === "management") return "Mgmt";
  return "Viewer";
}

// ── Avatar initials ────────────────────────────────────────────────────────────
function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
}

function avatarColor(userId: string) {
  const colors = [
    "bg-violet-600", "bg-blue-600", "bg-cyan-600", "bg-emerald-600",
    "bg-amber-600",  "bg-rose-600", "bg-pink-600", "bg-indigo-600",
  ];
  let hash = 0;
  for (const c of userId) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

// ── Time format ────────────────────────────────────────────────────────────────
function fmtTime(ts: string | Date | null) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(ts: string | Date | null) {
  if (!ts) return "Unknown";
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString())     return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg, isMine, showAvatar }: { msg: ChatMessage; isMine: boolean; showAvatar: boolean }) {
  return (
    <div className={cn("flex gap-2 items-end group", isMine ? "flex-row-reverse" : "flex-row")} data-testid={`chat-msg-${msg.id}`}>
      {showAvatar ? (
        <div className={cn("h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0", avatarColor(msg.senderId))}>
          {getInitials(msg.senderName)}
        </div>
      ) : (
        <div className="w-7 flex-shrink-0" />
      )}
      <div className={cn("flex flex-col gap-0.5", isMine ? "items-end" : "items-start")}>
        {showAvatar && (
          <div className={cn("flex items-center gap-1.5 mb-0.5", isMine ? "flex-row-reverse" : "flex-row")}>
            <span className="text-xs font-medium text-foreground/80">{msg.senderName}</span>
            <span className={cn("text-[10px] px-1.5 py-0 rounded border font-medium", roleBadge(msg.senderRole))}>
              {roleLabel(msg.senderRole)}
            </span>
          </div>
        )}
        <div className={cn(
          "px-3 py-2 rounded-2xl text-sm max-w-xs lg:max-w-md break-words",
          isMine
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm"
        )}>
          {msg.content}
        </div>
        <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          {fmtTime(msg.createdAt)}
        </span>
      </div>
    </div>
  );
}

// ── Date divider ───────────────────────────────────────────────────────────────
function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-3">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] text-muted-foreground font-medium px-2">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ChatPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [connected, setConnected] = useState(false);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);
  const [messagesByRoom, setMessagesByRoom] = useState<Record<number, ChatMessage[]>>({});
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [inputVal, setInputVal] = useState("");
  const [typingUsers, setTypingUsers] = useState<Record<number, Record<string, { name: string; ts: number }>>>({});
  const [newRoomDlg, setNewRoomDlg] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");

  const activeRoom = rooms.find(r => r.id === activeRoomId);
  const messages = activeRoomId ? (messagesByRoom[activeRoomId] ?? []) : [];

  // ── Scroll to bottom ───────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  // ── WebSocket connect ──────────────────────────────────────────────────────
  const connectWs = useCallback(() => {
    if (!user) return;
    if (wsRef.current && wsRef.current.readyState < 2) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.id;
      ws.send(JSON.stringify({
        type: "join",
        userId: user.id,
        userName: displayName,
        userRole: user.role || "viewer",
      }));
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 25000);
    };

    ws.onmessage = (ev) => {
      let data: WsMsg;
      try { data = JSON.parse(ev.data); } catch { return; }

      switch (data.type) {
        case "rooms":
          setRooms(data.rooms);
          if (data.rooms.length > 0 && !activeRoomId) {
            const firstId = data.rooms[0].id;
            setActiveRoomId(firstId);
            ws.send(JSON.stringify({ type: "join_room", roomId: firstId }));
          }
          break;

        case "history":
          setMessagesByRoom(prev => ({ ...prev, [data.roomId]: data.messages }));
          scrollToBottom();
          break;

        case "message":
          setMessagesByRoom(prev => {
            const existing = prev[data.message.roomId] ?? [];
            return { ...prev, [data.message.roomId]: [...existing, data.message] };
          });
          if (data.message.roomId === activeRoomId) scrollToBottom();
          break;

        case "presence":
        case "user_joined":
        case "user_left":
          setOnline((data as any).online ?? []);
          break;

        case "typing":
          if (data.userId === user.id) break;
          setTypingUsers(prev => {
            const roomTyping = { ...(prev[data.roomId] ?? {}) };
            roomTyping[data.userId] = { name: data.userName, ts: Date.now() };
            return { ...prev, [data.roomId]: roomTyping };
          });
          setTimeout(() => {
            setTypingUsers(prev => {
              const roomTyping = { ...(prev[data.roomId] ?? {}) };
              delete roomTyping[data.userId];
              return { ...prev, [data.roomId]: roomTyping };
            });
          }, 3000);
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingRef.current) clearInterval(pingRef.current);
      setTimeout(connectWs, 3000);
    };

    ws.onerror = () => ws.close();
  }, [user, activeRoomId, scrollToBottom]);

  useEffect(() => {
    connectWs();
    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Switch room ────────────────────────────────────────────────────────────
  const switchRoom = useCallback((roomId: number) => {
    setActiveRoomId(roomId);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "join_room", roomId }));
    }
    scrollToBottom();
    inputRef.current?.focus();
  }, [scrollToBottom]);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(() => {
    const content = inputVal.trim();
    if (!content || !activeRoomId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "message", roomId: activeRoomId, content }));
    setInputVal("");
    inputRef.current?.focus();
  }, [inputVal, activeRoomId]);

  // ── Typing indicator ───────────────────────────────────────────────────────
  const handleTyping = useCallback((val: string) => {
    setInputVal(val);
    if (!activeRoomId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    wsRef.current.send(JSON.stringify({ type: "typing", roomId: activeRoomId }));
  }, [activeRoomId]);

  // ── Create room ────────────────────────────────────────────────────────────
  const createRoom = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/chat/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<ChatRoom>;
    },
    onSuccess: (room) => {
      setRooms(prev => [...prev, room]);
      setNewRoomDlg(false);
      setNewRoomName("");
      switchRoom(room.id);
      toast({ title: `#${room.name} created`, description: "New channel is ready." });
    },
    onError: () => toast({ title: "Failed to create channel", variant: "destructive" }),
  });

  // ── Render messages with date dividers ─────────────────────────────────────
  function renderMessages() {
    const items: JSX.Element[] = [];
    let lastDate = "";
    let lastSenderId = "";

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const dateLabel = fmtDate(msg.createdAt);
      if (dateLabel !== lastDate) {
        items.push(<DateDivider key={`date-${dateLabel}`} label={dateLabel} />);
        lastDate = dateLabel;
      }
      const showAvatar = msg.senderId !== lastSenderId;
      const isMine = msg.senderId === user?.id;
      items.push(<MessageBubble key={msg.id} msg={msg} isMine={isMine} showAvatar={showAvatar} />);
      lastSenderId = msg.senderId;
    }
    return items;
  }

  // ── Typing indicator text ──────────────────────────────────────────────────
  const typingInRoom = activeRoomId ? Object.values(typingUsers[activeRoomId] ?? {}) : [];
  const typingText = typingInRoom.length === 1
    ? `${typingInRoom[0].name} is typing…`
    : typingInRoom.length > 1
    ? `${typingInRoom.map(t => t.name).join(", ")} are typing…`
    : "";

  // ── Unread count per room (messages since last switch — simplified) ─────────
  function unreadCount(roomId: number) {
    if (roomId === activeRoomId) return 0;
    return (messagesByRoom[roomId]?.length ?? 0) > 0 ? undefined : undefined;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-xl border border-border bg-background shadow-sm" data-testid="chat-page">
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <div className="w-60 flex flex-col border-r border-border bg-card/40 flex-shrink-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-400" : "bg-rose-400")} />
            <span className="text-sm font-semibold text-foreground">Team Chat</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setNewRoomDlg(true)} data-testid="btn-new-room">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Channel</TooltipContent>
          </Tooltip>
        </div>

        {/* Channels */}
        <div className="px-2 pt-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Channels</p>
          <div className="space-y-0.5">
            {rooms.filter(r => r.type === "group").map(room => (
              <button
                key={room.id}
                data-testid={`room-btn-${room.slug}`}
                onClick={() => switchRoom(room.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left",
                  activeRoomId === room.id
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
              >
                <Hash className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{room.name}</span>
              </button>
            ))}
          </div>
        </div>

        <Separator className="my-3" />

        {/* Online members */}
        <div className="px-2 flex-1 overflow-hidden flex flex-col">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">
            Online — {online.length}
          </p>
          <ScrollArea className="flex-1">
            <div className="space-y-1 pr-1">
              {online.map(u => (
                <div key={u.userId} className="flex items-center gap-2 px-2 py-1 rounded-md" data-testid={`online-user-${u.userId}`}>
                  <div className="relative">
                    <div className={cn("h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white", avatarColor(u.userId))}>
                      {getInitials(u.userName)}
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 border-2 border-card" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-foreground truncate">{u.userName}</span>
                    <span className={cn("text-[9px] font-medium", u.userRole === "admin" ? "text-rose-400" : u.userRole === "management" ? "text-amber-400" : "text-muted-foreground")}>
                      {roleLabel(u.userRole)}
                    </span>
                  </div>
                </div>
              ))}
              {online.length === 0 && (
                <p className="text-xs text-muted-foreground px-2">No one online</p>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Connection status */}
        <div className="px-4 py-2 border-t border-border">
          <div className="flex items-center gap-1.5">
            {connected ? (
              <><Wifi className="h-3 w-3 text-emerald-400" /><span className="text-[10px] text-emerald-400">Connected</span></>
            ) : (
              <><WifiOff className="h-3 w-3 text-rose-400" /><span className="text-[10px] text-rose-400">Reconnecting…</span></>
            )}
          </div>
        </div>
      </div>

      {/* ── Chat area ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeRoom ? (
          <>
            {/* Room header */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-card/20">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold text-foreground">{activeRoom.name}</span>
              <span className="text-xs text-muted-foreground ml-1">
                {messages.length > 0 ? `${messages.length} messages` : "No messages yet"}
              </span>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
              data-testid="chat-messages"
            >
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                    <MessageSquare className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">#{activeRoom.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">Be the first to send a message!</p>
                  </div>
                </div>
              ) : (
                renderMessages()
              )}
            </div>

            {/* Typing indicator */}
            <div className="px-4 h-5 flex items-center">
              {typingText && (
                <span className="text-xs text-muted-foreground animate-pulse">{typingText}</span>
              )}
            </div>

            {/* Input */}
            <div className="px-4 pb-4 pt-1">
              <div className="flex gap-2 items-end">
                <Input
                  ref={inputRef}
                  value={inputVal}
                  onChange={e => handleTyping(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder={`Message #${activeRoom.name}…`}
                  className="flex-1 bg-muted/60 border-border focus-visible:ring-primary"
                  disabled={!connected}
                  data-testid="input-message"
                  maxLength={2000}
                />
                <Button
                  size="icon"
                  onClick={sendMessage}
                  disabled={!inputVal.trim() || !connected}
                  data-testid="btn-send"
                  className="h-10 w-10 flex-shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 px-1">Press Enter to send · Shift+Enter for new line</p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">Select a channel to start chatting</p>
            </div>
          </div>
        )}
      </div>

      {/* ── New Room Dialog ────────────────────────────────────────────── */}
      <Dialog open={newRoomDlg} onOpenChange={setNewRoomDlg}>
        <DialogContent data-testid="dialog-new-room">
          <DialogHeader>
            <DialogTitle>Create New Channel</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Input
                placeholder="channel-name"
                value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") createRoom.mutate(newRoomName); }}
                data-testid="input-room-name"
                maxLength={64}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2 ml-6">
              Use lowercase letters, numbers, and hyphens.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewRoomDlg(false)}>Cancel</Button>
            <Button
              onClick={() => createRoom.mutate(newRoomName)}
              disabled={!newRoomName.trim() || createRoom.isPending}
              data-testid="btn-create-room"
            >
              Create Channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
