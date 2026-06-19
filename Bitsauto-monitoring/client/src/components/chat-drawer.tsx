import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useChatDrawer } from "@/context/chat-drawer-context";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, ExternalLink, Send, Hash, Plus, Wifi, WifiOff,
  User, MessageSquare, Users, ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { ChatRoom, ChatMessage } from "@shared/schema";

// ── Types (mirror chat.tsx) ────────────────────────────────────────────────────
interface OnlineUser { userId: string; userName: string; userRole: string; connectedAt: number; }
interface TeamMember { type: "kam" | "online"; userId: string; name: string; email: string; orgRole: string; isOnline: boolean; }
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

// ── Helpers (mirror chat.tsx) ─────────────────────────────────────────────────
function roleBadgeClass(role: string) {
  if (role === "admin")      return "text-rose-400";
  if (role === "management") return "text-amber-400";
  return "text-slate-400";
}
function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
}
function avatarBg(userId: string) {
  const colors = ["bg-violet-600","bg-blue-600","bg-cyan-600","bg-emerald-600","bg-amber-600","bg-rose-600","bg-pink-600","bg-indigo-600"];
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

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ userId, name, size = 6 }: { userId: string; name: string; size?: number }) {
  return (
    <div className={cn(`h-${size} w-${size} rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0`, avatarBg(userId))}>
      {getInitials(name)}
    </div>
  );
}

// ── Message bubble (compact for drawer) ──────────────────────────────────────
function MessageBubble({ msg, isMine, showHeader }: { msg: ChatMessage; isMine: boolean; showHeader: boolean }) {
  return (
    <div className={cn("flex gap-1.5 items-end group", isMine ? "flex-row-reverse" : "flex-row")}>
      {showHeader ? <Avatar userId={msg.senderId} name={msg.senderName} size={6} />
                  : <div className="w-6 flex-shrink-0" />}
      <div className={cn("flex flex-col gap-0.5", isMine ? "items-end" : "items-start")}>
        {showHeader && (
          <div className={cn("flex items-center gap-1 mb-0.5", isMine ? "flex-row-reverse" : "flex-row")}>
            <span className="text-[11px] font-medium text-foreground/80">{msg.senderName}</span>
            <span className={cn("text-[9px] font-medium", roleBadgeClass(msg.senderRole))}>{msg.senderRole}</span>
          </div>
        )}
        <div className={cn(
          "px-2.5 py-1.5 rounded-xl text-[12px] max-w-[220px] break-words leading-relaxed",
          isMine ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"
        )}>
          {msg.content}
        </div>
        <span className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity px-1">
          {fmtTime(msg.createdAt)}
        </span>
      </div>
    </div>
  );
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-2">
      <div className="flex-1 h-px bg-border/60" />
      <span className="text-[9px] text-muted-foreground font-medium px-2">{label}</span>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────
export function ChatDrawer() {
  const { isOpen, close } = useChatDrawer();
  const { user } = useAuth();
  const { toast } = useToast();

  const wsRef     = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const pingRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const [connected,    setConnected]    = useState(false);
  const [groupRooms,   setGroupRooms]   = useState<ChatRoom[]>([]);
  const [dmRooms,      setDmRooms]      = useState<ChatRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);
  const [msgsByRoom,   setMsgsByRoom]   = useState<Record<number, ChatMessage[]>>({});
  const [online,       setOnline]       = useState<OnlineUser[]>([]);
  const [members,      setMembers]      = useState<TeamMember[]>([]);
  const [inputVal,     setInputVal]     = useState("");
  const [typingUsers,  setTypingUsers]  = useState<Record<number, Record<string, { name: string }>>>({});
  const [unread,       setUnread]       = useState<Record<number, number>>({});
  const [dmWithNames,  setDmWithNames]  = useState<Record<number, string>>({});
  const [showPeople,   setShowPeople]   = useState(false);
  const [newRoomDlg,   setNewRoomDlg]   = useState(false);
  const [newRoomName,  setNewRoomName]  = useState("");

  const allRooms   = [...groupRooms, ...dmRooms];
  const activeRoom = allRooms.find(r => r.id === activeRoomId);
  const messages   = activeRoomId ? (msgsByRoom[activeRoomId] ?? []) : [];
  const onlineIds  = new Set(online.map(u => u.userId));
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 60);
  }, []);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/members", { credentials: "include" });
      if (res.ok) setMembers(await res.json());
    } catch { /* ignore */ }
  }, []);

  const handleWsMsg = useCallback((data: WsMsg) => {
    if (!user) return;
    switch (data.type) {
      case "rooms": {
        const groups = data.rooms.filter(r => r.type === "group");
        const dms    = data.rooms.filter(r => r.type === "direct");
        setGroupRooms(groups);
        setDmRooms(dms);
        if (groups.length > 0) {
          const firstId = groups[0].id;
          setActiveRoomId(prev => prev ?? firstId);
          wsRef.current?.send(JSON.stringify({ type: "join_room", roomId: firstId }));
        }
        break;
      }
      case "history":
        setMsgsByRoom(prev => ({ ...prev, [data.roomId]: data.messages }));
        scrollToBottom();
        break;
      case "message": {
        const msg = data.message;
        setMsgsByRoom(prev => ({ ...prev, [msg.roomId]: [...(prev[msg.roomId] ?? []), msg] }));
        setActiveRoomId(current => {
          if (current === msg.roomId) scrollToBottom();
          else setUnread(u => ({ ...u, [msg.roomId]: (u[msg.roomId] ?? 0) + 1 }));
          return current;
        });
        break;
      }
      case "presence":
      case "user_joined":
      case "user_left":
        setOnline((data as any).online as OnlineUser[]);
        fetchMembers();
        break;
      case "typing":
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
      case "dm_opened": {
        const { room, messages: hist, withUserId, withUserName } = data;
        setDmRooms(prev => prev.some(r => r.id === room.id) ? prev : [...prev, room]);
        setDmWithNames(prev => ({ ...prev, [room.id]: withUserName }));
        setMsgsByRoom(prev => ({ ...prev, [room.id]: hist }));
        setActiveRoomId(room.id);
        setShowPeople(false);
        scrollToBottom();
        break;
      }
      case "dm_invited": {
        const { room, messages: hist, fromUserName } = data;
        setDmRooms(prev => prev.some(r => r.id === room.id) ? prev : [...prev, room]);
        setDmWithNames(prev => ({ ...prev, [room.id]: fromUserName }));
        setMsgsByRoom(prev => ({ ...prev, [room.id]: hist }));
        setUnread(u => ({ ...u, [room.id]: (u[room.id] ?? 0) + 1 }));
        break;
      }
    }
  }, [user, scrollToBottom, fetchMembers]);

  const connectWs = useCallback(() => {
    if (!user) return;
    if (wsRef.current && wsRef.current.readyState < 2) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws`);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.id;
      ws.send(JSON.stringify({ type: "join", userId: user.id, userName: displayName, userRole: user.role || "viewer" }));
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 25000);
    };
    ws.onmessage = (ev) => { try { handleWsMsg(JSON.parse(ev.data)); } catch { /* */ } };
    ws.onclose = () => {
      setConnected(false);
      if (pingRef.current) clearInterval(pingRef.current);
      setTimeout(connectWs, 3000);
    };
    ws.onerror = () => ws.close();
  }, [user, handleWsMsg]);

  // Connect only when drawer opens for the first time
  useEffect(() => {
    if (isOpen && user?.id) {
      connectWs();
      fetchMembers();
    }
    return () => {
      if (!isOpen) return;
      if (pingRef.current) clearInterval(pingRef.current);
      // Keep WebSocket alive — don't close on drawer hide, just on unmount
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, []);

  // Focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
      scrollToBottom();
    }
  }, [isOpen, scrollToBottom]);

  // Keyboard: Escape closes drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && isOpen) close(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, close]);

  const switchRoom = useCallback((roomId: number) => {
    setActiveRoomId(roomId);
    setUnread(u => ({ ...u, [roomId]: 0 }));
    setShowPeople(false);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "join_room", roomId }));
    scrollToBottom();
    inputRef.current?.focus();
  }, [scrollToBottom]);

  const openDm = useCallback((targetUserId: string, targetUserName: string) => {
    if (!user || targetUserId === user.id) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast({ title: "Not connected", description: "Please wait for reconnection.", variant: "destructive" });
      return;
    }
    ws.send(JSON.stringify({ type: "open_dm", targetUserId, targetUserName }));
  }, [user, toast]);

  const sendMessage = useCallback(() => {
    const content = inputVal.trim();
    if (!content || !activeRoomId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "message", roomId: activeRoomId, content }));
    setInputVal("");
    inputRef.current?.focus();
  }, [inputVal, activeRoomId]);

  const handleTyping = useCallback((val: string) => {
    setInputVal(val);
    if (!activeRoomId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "typing", roomId: activeRoomId }));
  }, [activeRoomId]);

  const createRoom = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/chat/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name }) });
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
      items.push(<MessageBubble key={msg.id} msg={msg} isMine={msg.senderId === user?.id} showHeader={showHeader} />);
      lastSender = msg.senderId;
    }
    return items;
  }

  const typingInRoom = activeRoomId ? Object.values(typingUsers[activeRoomId] ?? {}) : [];
  const typingText   = typingInRoom.length === 1 ? `${typingInRoom[0].name} is typing…`
    : typingInRoom.length > 1 ? `${typingInRoom.map(t => t.name).join(", ")} are typing…` : "";

  const activeDmName = activeRoomId ? (dmWithNames[activeRoomId] ?? activeRoom?.name) : null;
  const otherMembers = members.filter(m => m.userId !== user?.id);

  return (
    <>
      {/* Backdrop — subtle, doesn't block main content */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[39] bg-black/20 pointer-events-auto"
            style={{ top: 44 }}
            onClick={close}
          />
        )}
      </AnimatePresence>

      {/* Drawer panel */}
      <motion.div
        initial={false}
        animate={{ x: isOpen ? 0 : "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.8 }}
        className={cn(
          "fixed right-0 bottom-0 z-40 flex flex-col w-[400px] max-w-[calc(100vw-48px)]",
          "border-l border-white/[0.08]",
        )}
        style={{
          top: 44,
          background: 'hsl(var(--background)/0.98)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
        data-testid="chat-drawer"
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.07] flex-shrink-0"
          style={{ background: 'hsl(var(--background)/0.95)' }}
        >
          <div className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", connected ? "bg-emerald-400" : "bg-rose-400")} />
          <span className="text-[12px] font-semibold text-foreground/90 flex-1">Team Chat</span>

          {/* Online count */}
          <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">
            {online.length} online
          </span>

          {/* People toggle */}
          <button
            onClick={() => setShowPeople(v => !v)}
            title="Team members"
            className={cn(
              "p-1.5 rounded-md transition-colors",
              showPeople ? "bg-white/[0.10] text-foreground" : "text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.06]"
            )}
          >
            <Users className="w-3.5 h-3.5" />
          </button>

          {/* Open full page */}
          <Link href="/chat" onClick={close}>
            <button
              title="Open full Team Chat"
              className="p-1.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.06] transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </Link>

          {/* Close */}
          <button
            onClick={close}
            data-testid="chat-drawer-close"
            title="Close chat (Esc)"
            className="p-1.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── Channel tab strip ── */}
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.06] flex-shrink-0 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          {groupRooms.map(room => {
            const isActive = activeRoomId === room.id;
            const badge    = unread[room.id] ?? 0;
            return (
              <button
                key={room.id}
                onClick={() => switchRoom(room.id)}
                data-testid={`drawer-room-${room.slug}`}
                className={cn(
                  "relative flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-all duration-150 flex-shrink-0",
                  isActive
                    ? "bg-white/[0.10] text-foreground"
                    : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05]"
                )}
              >
                <Hash className="w-3 h-3 flex-shrink-0" />
                <span>{room.name}</span>
                {badge > 0 && (
                  <span className="ml-0.5 bg-rose-500 text-white text-[9px] font-bold rounded-full px-1 py-0 leading-tight min-w-[14px] text-center">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </button>
            );
          })}
          {dmRooms.map(room => {
            const isActive = activeRoomId === room.id;
            const badge    = unread[room.id] ?? 0;
            const withName = dmWithNames[room.id] ?? room.name;
            const parts    = room.slug.replace(/^dm_/, "").split("_");
            const otherId  = parts.find(p => p !== user?.id) ?? parts[0];
            return (
              <button
                key={room.id}
                onClick={() => switchRoom(room.id)}
                data-testid={`drawer-dm-${room.id}`}
                className={cn(
                  "relative flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-all duration-150 flex-shrink-0",
                  isActive
                    ? "bg-white/[0.10] text-foreground"
                    : "text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05]"
                )}
              >
                <div className="relative flex-shrink-0">
                  <div className={cn("h-3.5 w-3.5 rounded-full flex items-center justify-center text-[7px] font-bold text-white", avatarBg(otherId))}>
                    {getInitials(withName)}
                  </div>
                  {onlineIds.has(otherId) && (
                    <div className="absolute -bottom-px -right-px h-1.5 w-1.5 rounded-full bg-emerald-400 border border-background" />
                  )}
                </div>
                <span className="max-w-[80px] truncate">{withName}</span>
                {badge > 0 && (
                  <span className="ml-0.5 bg-rose-500 text-white text-[9px] font-bold rounded-full px-1 leading-tight min-w-[14px] text-center">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </button>
            );
          })}
          {/* New channel button */}
          <button
            onClick={() => setNewRoomDlg(true)}
            title="New channel"
            className="p-1 rounded-md text-muted-foreground/30 hover:text-muted-foreground/70 hover:bg-white/[0.05] transition-colors flex-shrink-0 ml-auto"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {/* ── People panel (overlay inside drawer) ── */}
        {showPeople && (
          <div className="absolute inset-x-0 z-10 border-b border-white/[0.08] overflow-y-auto max-h-[50%]"
            style={{ top: 88, background: 'hsl(var(--background)/0.99)' }}
          >
            <div className="px-3 py-2 flex items-center justify-between sticky top-0"
              style={{ background: 'hsl(var(--background))' }}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Team Members</span>
              <button onClick={() => setShowPeople(false)} className="p-1 rounded text-muted-foreground/40 hover:text-foreground">
                <ChevronLeft className="w-3 h-3" />
              </button>
            </div>
            <div className="px-2 pb-2 space-y-0.5">
              {otherMembers.length === 0 && (
                <p className="text-[11px] text-muted-foreground/50 px-2 italic py-2">No other team members</p>
              )}
              {otherMembers.map(m => {
                const isOnline = onlineIds.has(m.userId);
                return (
                  <button
                    key={m.userId}
                    data-testid={`drawer-member-${m.userId}`}
                    onClick={() => openDm(m.userId, m.name)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="relative flex-shrink-0">
                      <div className={cn("h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white", avatarBg(m.userId))}>
                        {getInitials(m.name)}
                      </div>
                      <div className={cn("absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background", isOnline ? "bg-emerald-400" : "bg-slate-600")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium truncate">{m.name}</div>
                      <div className={cn("text-[9px]", roleBadgeClass(m.orgRole))}>{m.orgRole}</div>
                    </div>
                    <MessageSquare className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Messages area ── */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {activeRoom ? (
            <>
              {/* Room label bar */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.04] flex-shrink-0 bg-white/[0.02]">
                {activeRoom.type === "direct"
                  ? <><User className="h-3 w-3 text-muted-foreground/50" /><span className="text-[11px] font-medium text-foreground/70">{activeDmName ?? activeRoom.name}</span>
                      {online.some(u => { const p = activeRoom.slug.replace(/^dm_/,"").split("_"); return p.some(id => id !== user?.id && id === u.userId); }) && (
                        <span className="text-[9px] text-emerald-400">● online</span>
                      )}
                    </>
                  : <><Hash className="h-3 w-3 text-muted-foreground/50" /><span className="text-[11px] font-medium text-foreground/70">{activeRoom.name}</span></>
                }
                <span className="ml-auto text-[9px] text-muted-foreground/40">{messages.length} msg{messages.length !== 1 ? "s" : ""}</span>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-1 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-white/10" data-testid="drawer-messages">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                    {activeRoom.type === "direct"
                      ? <User className="h-8 w-8 text-muted-foreground/30" />
                      : <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
                    }
                    <p className="text-[12px] text-muted-foreground/50">
                      {activeRoom.type === "direct"
                        ? `Start a private conversation with ${activeDmName ?? "this person"}`
                        : "Be the first to send a message!"}
                    </p>
                  </div>
                ) : renderMessages()}
              </div>

              {/* Typing indicator */}
              <div className="px-3 h-4 flex items-center flex-shrink-0">
                {typingText && <span className="text-[10px] text-muted-foreground/60 animate-pulse">{typingText}</span>}
              </div>

              {/* Input */}
              <div className="px-3 pb-3 pt-1 flex-shrink-0 border-t border-white/[0.04]">
                <div className="flex gap-2 items-center">
                  <input
                    ref={inputRef}
                    value={inputVal}
                    onChange={e => handleTyping(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder={activeRoom.type === "direct" ? `Message ${activeDmName ?? "…"}` : `Message #${activeRoom.name}`}
                    disabled={!connected}
                    data-testid="drawer-input-message"
                    maxLength={2000}
                    className={cn(
                      "flex-1 h-8 px-2.5 text-[12px] rounded-lg border border-white/[0.10] bg-white/[0.04] text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors",
                      "focus:border-white/[0.18] focus:bg-white/[0.06]",
                      !connected && "opacity-50 cursor-not-allowed"
                    )}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!inputVal.trim() || !connected}
                    data-testid="drawer-btn-send"
                    className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                      inputVal.trim() && connected
                        ? "bg-primary text-primary-foreground hover:bg-primary/80"
                        : "bg-white/[0.06] text-muted-foreground/30 cursor-not-allowed"
                    )}
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                <p className="text-[12px] text-muted-foreground/50">
                  {connected ? "Select a channel above" : "Connecting…"}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer: connection status ── */}
        <div className="px-3 py-1.5 border-t border-white/[0.06] flex items-center gap-1.5 flex-shrink-0">
          {connected
            ? <><Wifi className="h-2.5 w-2.5 text-emerald-400" /><span className="text-[9px] text-emerald-400">Connected</span></>
            : <><WifiOff className="h-2.5 w-2.5 text-rose-400" /><span className="text-[9px] text-rose-400">Reconnecting…</span></>
          }
        </div>
      </motion.div>

      {/* New Channel dialog */}
      <Dialog open={newRoomDlg} onOpenChange={setNewRoomDlg}>
        <DialogContent data-testid="drawer-dialog-new-room">
          <DialogHeader><DialogTitle>Create New Channel</DialogTitle></DialogHeader>
          <div className="py-2">
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Input
                placeholder="channel-name"
                value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") createRoom.mutate(newRoomName); }}
                maxLength={64}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewRoomDlg(false)}>Cancel</Button>
            <Button onClick={() => createRoom.mutate(newRoomName)} disabled={!newRoomName.trim() || createRoom.isPending}>
              Create Channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
