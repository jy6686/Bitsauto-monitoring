import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Hash, Send, Plus, Wifi, WifiOff, MessageSquare, User } from "lucide-react";
import type { ChatRoom, ChatMessage } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
interface OnlineUser {
  userId: string;
  userName: string;
  userRole: string;
  connectedAt: number;
}

interface TeamMember {
  type: "kam" | "online";
  userId: string;
  name: string;
  email: string;
  orgRole: string;
  isOnline: boolean;
}

type WsMsg =
  | { type: "rooms";       rooms: ChatRoom[] }
  | { type: "history";     roomId: number; messages: ChatMessage[] }
  | { type: "message";     message: ChatMessage }
  | { type: "presence";    online: OnlineUser[] }
  | { type: "user_joined"; userId: string; userName: string; userRole: string; online: OnlineUser[] }
  | { type: "user_left";   userId: string; userName: string; online: OnlineUser[] }
  | { type: "typing";      roomId: number; userId: string; userName: string }
  | { type: "dm_opened";   room: ChatRoom; messages: ChatMessage[]; withUserId: string; withUserName: string }
  | { type: "dm_invited";  room: ChatRoom; messages: ChatMessage[]; fromUserId: string; fromUserName: string }
  | { type: "pong" };

// ── Helpers ───────────────────────────────────────────────────────────────────
function roleBadgeClass(role: string) {
  if (role === "admin")      return "text-rose-400";
  if (role === "management") return "text-amber-400";
  return "text-slate-400";
}

function roleLabel(role: string) {
  if (role === "admin")      return "Admin";
  if (role === "management") return "Mgmt";
  return "Viewer";
}

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
}

function avatarBg(userId: string) {
  const colors = [
    "bg-violet-600", "bg-blue-600", "bg-cyan-600", "bg-emerald-600",
    "bg-amber-600",  "bg-rose-600", "bg-pink-600", "bg-indigo-600",
  ];
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

function fmtTime(ts: string | Date | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

// Given a DM room, return the display name for the OTHER person
function dmDisplayName(room: ChatRoom, myUserId: string): string {
  // room.name is "A ↔ B"; room.slug is "dm_uid1_uid2"
  // Prefer parsing the name: "Alice ↔ Bob" → return the one that isn't us
  const parts = room.name.split(" ↔ ");
  if (parts.length === 2) return parts[0] + " ↔ " + parts[1]; // fallback: show full
  return room.name;
}

// ── Avatar component ───────────────────────────────────────────────────────────
function Avatar({ userId, name, size = 7 }: { userId: string; name: string; size?: number }) {
  return (
    <div className={cn(`h-${size} w-${size} rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0`, avatarBg(userId))}>
      {getInitials(name)}
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg, isMine, showHeader }: { msg: ChatMessage; isMine: boolean; showHeader: boolean }) {
  return (
    <div className={cn("flex gap-2 items-end group", isMine ? "flex-row-reverse" : "flex-row")} data-testid={`chat-msg-${msg.id}`}>
      {showHeader ? (
        <Avatar userId={msg.senderId} name={msg.senderName} size={7} />
      ) : (
        <div className="w-7 flex-shrink-0" />
      )}
      <div className={cn("flex flex-col gap-0.5", isMine ? "items-end" : "items-start")}>
        {showHeader && (
          <div className={cn("flex items-center gap-1.5 mb-0.5", isMine ? "flex-row-reverse" : "flex-row")}>
            <span className="text-xs font-medium text-foreground/80">{msg.senderName}</span>
            <span className={cn("text-[10px] font-medium", roleBadgeClass(msg.senderRole))}>
              {roleLabel(msg.senderRole)}
            </span>
          </div>
        )}
        <div className={cn(
          "px-3 py-2 rounded-2xl text-sm max-w-xs lg:max-w-md break-words leading-relaxed",
          isMine ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"
        )}>
          {msg.content}
        </div>
        <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity px-1">
          {fmtTime(msg.createdAt)}
        </span>
      </div>
    </div>
  );
}

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

  const wsRef       = useRef<WebSocket | null>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const pingRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  const [connected,       setConnected]       = useState(false);
  const [groupRooms,      setGroupRooms]       = useState<ChatRoom[]>([]);
  const [dmRooms,         setDmRooms]          = useState<ChatRoom[]>([]);   // DM conversations
  const [activeRoomId,    setActiveRoomId]     = useState<number | null>(null);
  const [msgsByRoom,      setMsgsByRoom]       = useState<Record<number, ChatMessage[]>>({});
  const [online,          setOnline]           = useState<OnlineUser[]>([]);
  const [members,         setMembers]          = useState<TeamMember[]>([]);
  const [inputVal,        setInputVal]         = useState("");
  const [typingUsers,     setTypingUsers]      = useState<Record<number, Record<string, { name: string }>>>({});
  const [newRoomDlg,      setNewRoomDlg]       = useState(false);
  const [newRoomName,     setNewRoomName]      = useState("");
  const [unread,          setUnread]           = useState<Record<number, number>>({}); // roomId → count
  const [dmWithNames,     setDmWithNames]      = useState<Record<number, string>>({}); // roomId → other person's name

  const activeRoom = [...groupRooms, ...dmRooms].find(r => r.id === activeRoomId);
  const messages   = activeRoomId ? (msgsByRoom[activeRoomId] ?? []) : [];

  // ── Scroll to bottom ───────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 60);
  }, []);

  // ── Fetch team members for DM list ─────────────────────────────────────────
  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/members", { credentials: "include" });
      if (res.ok) setMembers(await res.json());
    } catch { /* ignore */ }
  }, []);

  // ── Handle WebSocket messages ──────────────────────────────────────────────
  const handleWsMsg = useCallback((data: WsMsg) => {
    if (!user) return;
    switch (data.type) {
      case "rooms": {
        const groups = data.rooms.filter(r => r.type === "group");
        const dms    = data.rooms.filter(r => r.type === "direct");
        setGroupRooms(groups);
        setDmRooms(dms);
        // Open first group room by default
        if (groups.length > 0) {
          const firstId = groups[0].id;
          setActiveRoomId(prev => prev ?? firstId);
          wsRef.current?.send(JSON.stringify({ type: "join_room", roomId: firstId }));
        }
        break;
      }

      case "history": {
        setMsgsByRoom(prev => ({ ...prev, [data.roomId]: data.messages }));
        scrollToBottom();
        break;
      }

      case "message": {
        const msg = data.message;
        setMsgsByRoom(prev => ({
          ...prev,
          [msg.roomId]: [...(prev[msg.roomId] ?? []), msg],
        }));
        setActiveRoomId(current => {
          if (current === msg.roomId) {
            scrollToBottom();
          } else {
            // increment unread badge
            setUnread(u => ({ ...u, [msg.roomId]: (u[msg.roomId] ?? 0) + 1 }));
          }
          return current;
        });
        break;
      }

      case "presence":
      case "user_joined":
      case "user_left": {
        const newOnline = (data as any).online as OnlineUser[];
        setOnline(newOnline);
        fetchMembers();
        break;
      }

      case "typing": {
        if (data.userId === user.id) break;
        setTypingUsers(prev => {
          const rt = { ...(prev[data.roomId] ?? {}) };
          rt[data.userId] = { name: data.userName };
          return { ...prev, [data.roomId]: rt };
        });
        setTimeout(() => {
          setTypingUsers(prev => {
            const rt = { ...(prev[data.roomId] ?? {}) };
            delete rt[data.userId];
            return { ...prev, [data.roomId]: rt };
          });
        }, 3000);
        break;
      }

      case "dm_opened": {
        const { room, messages: hist, withUserId, withUserName } = data;
        setDmRooms(prev => prev.some(r => r.id === room.id) ? prev : [...prev, room]);
        setDmWithNames(prev => ({ ...prev, [room.id]: withUserName }));
        setMsgsByRoom(prev => ({ ...prev, [room.id]: hist }));
        setActiveRoomId(room.id);
        scrollToBottom();
        break;
      }

      case "dm_invited": {
        const { room, messages: hist, fromUserName } = data;
        setDmRooms(prev => prev.some(r => r.id === room.id) ? prev : [...prev, room]);
        setDmWithNames(prev => ({ ...prev, [room.id]: fromUserName }));
        setMsgsByRoom(prev => ({ ...prev, [room.id]: hist }));
        // Increment unread for DM invite
        setUnread(u => ({ ...u, [room.id]: (u[room.id] ?? 0) + 1 }));
        break;
      }
    }
  }, [user, scrollToBottom, fetchMembers]);

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
      try { handleWsMsg(JSON.parse(ev.data)); } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingRef.current) clearInterval(pingRef.current);
      setTimeout(connectWs, 3000);
    };

    ws.onerror = () => ws.close();
  }, [user, handleWsMsg]);

  useEffect(() => {
    if (user?.id) {
      connectWs();
      fetchMembers();
    }
    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Switch room ────────────────────────────────────────────────────────────
  const switchRoom = useCallback((roomId: number) => {
    setActiveRoomId(roomId);
    setUnread(u => ({ ...u, [roomId]: 0 }));
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "join_room", roomId }));
    }
    scrollToBottom();
    inputRef.current?.focus();
  }, [scrollToBottom]);

  // ── Open DM with a member ──────────────────────────────────────────────────
  const openDm = useCallback((targetUserId: string, targetUserName: string) => {
    if (!user || targetUserId === user.id) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast({ title: "Not connected", description: "Please wait for reconnection.", variant: "destructive" });
      return;
    }
    ws.send(JSON.stringify({ type: "open_dm", targetUserId, targetUserName }));
  }, [user, toast]);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(() => {
    const content = inputVal.trim();
    if (!content || !activeRoomId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "message", roomId: activeRoomId, content }));
    setInputVal("");
    inputRef.current?.focus();
  }, [inputVal, activeRoomId]);

  // ── Typing ─────────────────────────────────────────────────────────────────
  const handleTyping = useCallback((val: string) => {
    setInputVal(val);
    if (!activeRoomId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "typing", roomId: activeRoomId }));
  }, [activeRoomId]);

  // ── Create channel ─────────────────────────────────────────────────────────
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
      setGroupRooms(prev => [...prev, room]);
      setNewRoomDlg(false);
      setNewRoomName("");
      switchRoom(room.id);
      toast({ title: `#${room.name} created` });
    },
    onError: () => toast({ title: "Failed to create channel", variant: "destructive" }),
  });

  // ── Render messages ────────────────────────────────────────────────────────
  function renderMessages() {
    const items: JSX.Element[] = [];
    let lastDate = "";
    let lastSender = "";
    for (const msg of messages) {
      const dateLabel = fmtDate(msg.createdAt);
      if (dateLabel !== lastDate) {
        items.push(<DateDivider key={`d-${dateLabel}`} label={dateLabel} />);
        lastDate = dateLabel;
      }
      const showHeader = msg.senderId !== lastSender;
      items.push(
        <MessageBubble key={msg.id} msg={msg} isMine={msg.senderId === user?.id} showHeader={showHeader} />
      );
      lastSender = msg.senderId;
    }
    return items;
  }

  const typingInRoom = activeRoomId ? Object.values(typingUsers[activeRoomId] ?? {}) : [];
  const typingText   = typingInRoom.length === 1 ? `${typingInRoom[0].name} is typing…`
    : typingInRoom.length > 1 ? `${typingInRoom.map(t => t.name).join(", ")} are typing…` : "";

  // Members excluding self
  const otherMembers = members.filter(m => m.userId !== user?.id);
  const onlineIds    = new Set(online.map(u => u.userId));

  // For DM header — the other person's name
  const activeDmName = activeRoomId ? (dmWithNames[activeRoomId] ?? activeRoom?.name) : null;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-xl border border-border bg-background shadow-sm" data-testid="chat-page">

      {/* ══════════════ SIDEBAR ══════════════ */}
      <div className="w-64 flex flex-col border-r border-border bg-card/40 flex-shrink-0">

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

        <ScrollArea className="flex-1">
          <div className="px-2 pt-3 pb-4 space-y-4">

            {/* ── Channels ── */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Channels</p>
              <div className="space-y-0.5">
                {groupRooms.map(room => {
                  const isActive = activeRoomId === room.id;
                  const badge    = unread[room.id] ?? 0;
                  return (
                    <button
                      key={room.id}
                      data-testid={`room-btn-${room.slug}`}
                      onClick={() => switchRoom(room.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left",
                        isActive ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      )}
                    >
                      <Hash className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate flex-1">{room.name}</span>
                      {badge > 0 && (
                        <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full px-1.5 py-0 min-w-[18px] text-center">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Direct Messages ── */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Direct Messages</p>
              <div className="space-y-0.5">
                {dmRooms.map(room => {
                  const isActive  = activeRoomId === room.id;
                  const badge     = unread[room.id] ?? 0;
                  const withName  = dmWithNames[room.id] ?? room.name;
                  // Try to find the other user's slug-based ID for colour/initials
                  const parts = room.slug.replace(/^dm_/, "").split("_");
                  const otherId = parts.find(p => p !== user?.id) ?? parts[0];
                  return (
                    <button
                      key={room.id}
                      data-testid={`dm-btn-${room.id}`}
                      onClick={() => switchRoom(room.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left",
                        isActive ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      )}
                    >
                      <div className="relative flex-shrink-0">
                        <div className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white", avatarBg(otherId))}>
                          {getInitials(withName)}
                        </div>
                        {onlineIds.has(otherId) && (
                          <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 border border-card" />
                        )}
                      </div>
                      <span className="truncate flex-1">{withName}</span>
                      {badge > 0 && (
                        <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full px-1.5 py-0 min-w-[18px] text-center">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </button>
                  );
                })}
                {dmRooms.length === 0 && (
                  <p className="text-[11px] text-muted-foreground px-2 italic">Click a member below to start a chat</p>
                )}
              </div>
            </div>

            {/* ── Team Members (click to DM) ── */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">
                Team Members
              </p>
              <div className="space-y-0.5">
                {otherMembers.length === 0 && (
                  <p className="text-[11px] text-muted-foreground px-2 italic">No members found</p>
                )}
                {otherMembers.map(m => {
                  const isOnline = onlineIds.has(m.userId);
                  return (
                    <Tooltip key={m.userId}>
                      <TooltipTrigger asChild>
                        <button
                          data-testid={`member-btn-${m.userId}`}
                          onClick={() => openDm(m.userId, m.name)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                        >
                          <div className="relative flex-shrink-0">
                            <div className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white", avatarBg(m.userId))}>
                              {getInitials(m.name)}
                            </div>
                            <div className={cn(
                              "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-card",
                              isOnline ? "bg-emerald-400" : "bg-slate-500"
                            )} />
                          </div>
                          <span className="truncate flex-1 text-xs">{m.name}</span>
                          <span className={cn("text-[9px] font-medium flex-shrink-0", roleBadgeClass(m.orgRole))}>
                            {m.orgRole}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p className="font-medium">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.email || m.orgRole}</p>
                        <p className="text-xs mt-0.5">{isOnline ? "🟢 Online" : "⚫ Offline"}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

          </div>
        </ScrollArea>

        {/* Connection status */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-1.5">
          {connected
            ? <><Wifi className="h-3 w-3 text-emerald-400" /><span className="text-[10px] text-emerald-400">Connected</span></>
            : <><WifiOff className="h-3 w-3 text-rose-400" /><span className="text-[10px] text-rose-400">Reconnecting…</span></>
          }
          <span className="ml-auto text-[10px] text-muted-foreground">{online.length} online</span>
        </div>
      </div>

      {/* ══════════════ CHAT AREA ══════════════ */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeRoom ? (
          <>
            {/* Room header */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-card/20 flex-shrink-0">
              {activeRoom.type === "direct" ? (
                <>
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold text-foreground">{activeDmName ?? activeRoom.name}</span>
                  {online.some(u => {
                    const parts = activeRoom.slug.replace(/^dm_/, "").split("_");
                    return parts.some(p => p !== user?.id && p === u.userId);
                  }) && (
                    <span className="text-[10px] text-emerald-400 font-medium">● Online</span>
                  )}
                </>
              ) : (
                <>
                  <Hash className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold text-foreground">{activeRoom.name}</span>
                </>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {messages.length > 0 ? `${messages.length} messages` : "No messages yet"}
              </span>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1" data-testid="chat-messages">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                    {activeRoom.type === "direct"
                      ? <User className="h-6 w-6 text-muted-foreground" />
                      : <MessageSquare className="h-6 w-6 text-muted-foreground" />
                    }
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {activeRoom.type === "direct" ? activeDmName : `#${activeRoom.name}`}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {activeRoom.type === "direct"
                        ? `Start a private conversation with ${activeDmName}.`
                        : "Be the first to send a message!"
                      }
                    </p>
                  </div>
                </div>
              ) : (
                renderMessages()
              )}
            </div>

            {/* Typing indicator */}
            <div className="px-5 h-5 flex items-center flex-shrink-0">
              {typingText && <span className="text-xs text-muted-foreground animate-pulse">{typingText}</span>}
            </div>

            {/* Input */}
            <div className="px-4 pb-4 pt-1 flex-shrink-0">
              <div className="flex gap-2 items-center">
                <Input
                  ref={inputRef}
                  value={inputVal}
                  onChange={e => handleTyping(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder={activeRoom.type === "direct"
                    ? `Message ${activeDmName ?? "…"}`
                    : `Message #${activeRoom.name}`
                  }
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
              <p className="text-[10px] text-muted-foreground mt-1.5 px-1">Enter to send</p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">Select a channel or start a direct message</p>
            </div>
          </div>
        )}
      </div>

      {/* ── New Channel Dialog ─────────────────────────────────────────── */}
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
            <p className="text-xs text-muted-foreground mt-2 ml-6">Lowercase letters, numbers, hyphens.</p>
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
