"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  sendMessage,
  openDirectConversation,
} from "../actions";
import Avatar from "../members/Avatar";
import type { Member } from "@/lib/family";
import { useFamilyPresence } from "../useFamilyPresence";
import { isActive } from "@/lib/presence";

type Message = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
};

type Read = { user_id: string; last_read_at: string | null };

export type InitialSelected = {
  type: "group" | "direct";
  id: string;
  otherId: string | null;
};

const EMOJIS = [
  "😀", "😂", "🥰", "😎", "🤔", "👍", "👏", "🙏", "🎉", "❤️",
  "🔥", "😢", "😮", "🙌", "😅", "😴", "🍕", "☕", "🚗", "🏠",
  "✅", "❌", "⭐", "💯", "🤣", "😍", "🥳", "👋", "💪", "🤗",
];

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

type Selected =
  | { type: "group"; id: string }
  | { type: "direct"; id: string; otherId: string };

export default function ChatApp({
  familyId,
  currentUserId,
  members,
  groupConversationId,
  initialSelected,
  initialMessages,
  initialGroupUnread,
  initialDirectUnread,
  deepLinked,
}: {
  familyId: string;
  currentUserId: string;
  members: Member[];
  groupConversationId: string;
  initialSelected: InitialSelected;
  initialMessages: Message[];
  initialGroupUnread: boolean;
  initialDirectUnread: string[];
  deepLinked: boolean;
}) {
  const [selected, setSelected] = useState<Selected>(() =>
    initialSelected.type === "direct" && initialSelected.otherId
      ? { type: "direct", id: initialSelected.id, otherId: initialSelected.otherId }
      : { type: "group", id: groupConversationId }
  );
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  // Mobile is list-first: land on the conversation list and tap one to open it
  // (listOpen = showing the list). A deep link from a notification opens
  // straight into its conversation. On desktop both panels always show.
  const [listOpen, setListOpen] = useState(!deepLinked);
  const [reads, setReads] = useState<Read[]>([]);
  // Seed unread from the server. If we deep-linked straight into a conversation
  // it's read on arrival; otherwise keep its badge until the user opens it.
  const [groupUnread, setGroupUnread] = useState(
    deepLinked && initialSelected.type === "group" ? false : initialGroupUnread
  );
  const [directUnread, setDirectUnread] = useState<Set<string>>(() => {
    const s = new Set(initialDirectUnread);
    if (deepLinked && initialSelected.type === "direct" && initialSelected.otherId) {
      s.delete(initialSelected.otherId);
    }
    return s;
  });
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const others = members.filter((m) => m.user_id !== currentUserId);
  const selectedOtherId = selected.type === "direct" ? selected.otherId : null;

  // Maps a direct conversation id -> the other participant, so an incoming
  // message in a closed DM can be matched to its sidebar row.
  const convToOther = useRef<Map<string, string>>(new Map());
  // The latest selection, readable from the global subscription without
  // forcing it to re-subscribe on every conversation switch.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  // Whether the messages panel is actually on screen (mobile hides it in list
  // view). Read from subscriptions without re-subscribing.
  const listOpenRef = useRef(listOpen);
  useEffect(() => {
    listOpenRef.current = listOpen;
  }, [listOpen]);
  // Whether we've already run the message-load effect once — lets it skip
  // re-fetching the very first conversation (we already have its messages
  // from the server) while still fetching fresh on later switches.
  const loadedInitialRef = useRef(false);
  // Which conversation the last "landing" scroll was for, so switching
  // conversations (or the initial mount) jumps straight to the bottom
  // instead of visibly animating up from wherever the div happened to start.
  const landedForRef = useRef<string | null>(null);

  // "X is typing" — ephemeral, not persisted, via a realtime broadcast
  // channel per conversation (same pattern as the map's location-refresh
  // broadcast). Other participants' user ids currently typing.
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSentRef = useRef(0);
  const stopTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-user auto-expire, in case a "stopped typing" broadcast is missed
  // (e.g. the other person's app gets backgrounded mid-keystroke).
  const typingExpireTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  useEffect(() => {
    const supabase = createClient();
    const timers = typingExpireTimersRef.current;
    const channel = supabase
      .channel(`typing:${selected.id}`)
      .on("broadcast", { event: "typing" }, (msg) => {
        const { userId, typing } = msg.payload as {
          userId: string;
          typing: boolean;
        };
        if (userId === currentUserId) return;

        const existing = timers.get(userId);
        if (existing) clearTimeout(existing);
        timers.delete(userId);

        if (typing) {
          setTypingUsers((prev) => new Set(prev).add(userId));
          timers.set(
            userId,
            setTimeout(() => {
              setTypingUsers((prev) => {
                const next = new Set(prev);
                next.delete(userId);
                return next;
              });
              timers.delete(userId);
            }, 4000)
          );
        } else {
          setTypingUsers((prev) => {
            const next = new Set(prev);
            next.delete(userId);
            return next;
          });
        }
      })
      .subscribe();
    typingChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current);
      setTypingUsers(new Set()); // leaving this conversation clears its indicator
    };
  }, [selected.id, currentUserId]);

  // Broadcasts "typing" at most once every 2s while the user types, and
  // "stopped" 3s after they pause (or immediately on send).
  function handleTextChange(value: string) {
    setText(value);
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2000) {
      typingChannelRef.current?.send({
        type: "broadcast",
        event: "typing",
        payload: { userId: currentUserId, typing: true },
      });
      lastTypingSentRef.current = now;
    }
    if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current);
    stopTypingTimerRef.current = setTimeout(() => {
      typingChannelRef.current?.send({
        type: "broadcast",
        event: "typing",
        payload: { userId: currentUserId, typing: false },
      });
    }, 3000);
  }
  useEffect(() => {
    if (initialSelected.type === "direct" && initialSelected.otherId) {
      convToOther.current.set(initialSelected.id, initialSelected.otherId);
    }
  }, [initialSelected]);

  // "Active now" dots, shared with the rest of the app via last_seen.
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);
  const initialSeen = useMemo(
    () => Object.fromEntries(members.map((m) => [m.user_id, m.last_seen])),
    [members]
  );
  const { lastSeen, now } = useFamilyPresence(memberIds, initialSeen);
  const onlineIds = useMemo(
    () =>
      new Set(
        members.filter((m) => isActive(lastSeen[m.user_id], now)).map((m) => m.user_id)
      ),
    [members, lastSeen, now]
  );

  // Stamp my last_read_at for a conversation (drives others' "Seen" status).
  const markRead = useCallback(
    async (conversationId: string) => {
      if (!conversationId) return;
      const supabase = createClient();
      await supabase
        .from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", currentUserId);
    },
    [currentUserId]
  );

  // Load + subscribe for the OPEN conversation: messages and read receipts.
  useEffect(() => {
    let active = true;
    const supabase = createClient();

    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("messages")
        .select("id, user_id, body, created_at")
        .eq("conversation_id", selected.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (active) {
        setMessages((data ?? []).reverse());
        setLoading(false);
      }
    }
    async function loadReads() {
      const { data } = await supabase
        .from("conversation_participants")
        .select("user_id, last_read_at")
        .eq("conversation_id", selected.id);
      if (active) setReads(data ?? []);
    }
    // Skip the redundant re-fetch for the conversation we already have
    // server-rendered messages for — it briefly swapped the list for a
    // "Loading…" placeholder (collapsing the scroll position) then snapped
    // back, which showed as a flash to the top right after a notification
    // deep-link. Only fetch fresh when actually switching conversations.
    if (loadedInitialRef.current) {
      load();
    } else {
      loadedInitialRef.current = true;
    }
    loadReads();

    const msgChannel = supabase
      .channel(`messages:${selected.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selected.id}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            const withoutTemp = prev.filter(
              (m) =>
                !(
                  m.id.startsWith("temp-") &&
                  m.user_id === msg.user_id &&
                  m.body === msg.body
                )
            );
            return [...withoutTemp, msg];
          });
          if (
            msg.user_id !== currentUserId &&
            document.visibilityState === "visible" &&
            !listOpenRef.current
          ) {
            void markRead(selected.id);
          }
        }
      )
      .subscribe();

    const readChannel = supabase
      .channel(`reads:${selected.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_participants",
          filter: `conversation_id=eq.${selected.id}`,
        },
        (payload) => {
          const row = payload.new as Read;
          setReads((prev) => [
            ...prev.filter((r) => r.user_id !== row.user_id),
            { user_id: row.user_id, last_read_at: row.last_read_at },
          ]);
        }
      )
      .subscribe();

    // Returning to the app while actually viewing this conversation marks it
    // read and clears any badge that landed while we were away.
    const onVisible = () => {
      if (document.visibilityState !== "visible" || listOpenRef.current) return;
      void markRead(selected.id);
      if (selected.type === "group") setGroupUnread(false);
      else if (selectedOtherId)
        setDirectUnread((prev) => {
          const next = new Set(prev);
          next.delete(selectedOtherId);
          return next;
        });
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(readChannel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [selected.id, selected.type, selectedOtherId, currentUserId, markRead]);

  // Mark the conversation read once it's actually on screen — i.e. not just the
  // background selection while the mobile list is open.
  useEffect(() => {
    if (listOpen) return;
    void markRead(selected.id);
  }, [listOpen, selected.id, markRead]);

  // Global: any message in a conversation I'm in (RLS-scoped) flags an unread
  // badge unless it's the one I'm currently looking at.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("messages:all")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const msg = payload.new as Message & { conversation_id: string };
          if (msg.user_id === currentUserId) return;
          const isViewing =
            msg.conversation_id === selectedRef.current.id &&
            !listOpenRef.current &&
            document.visibilityState === "visible";
          if (isViewing) return;

          if (msg.conversation_id === groupConversationId) {
            setGroupUnread(true);
            return;
          }
          let otherId = convToOther.current.get(msg.conversation_id);
          if (!otherId) {
            const { data } = await supabase
              .from("conversation_participants")
              .select("user_id")
              .eq("conversation_id", msg.conversation_id);
            otherId = data?.find((p) => p.user_id !== currentUserId)?.user_id;
            if (otherId) convToOther.current.set(msg.conversation_id, otherId);
          }
          if (otherId) {
            const id = otherId;
            setDirectUnread((prev) => new Set(prev).add(id));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, groupConversationId]);

  useEffect(() => {
    // Landing in a conversation (mount, or switching to a different one)
    // jumps straight to the bottom; only a new message arriving while
    // already viewing this conversation animates smoothly.
    const isLanding = landedForRef.current !== selected.id;
    bottomRef.current?.scrollIntoView({ behavior: isLanding ? "auto" : "smooth" });
    landedForRef.current = selected.id;
  }, [messages, selected.id]);

  function selectGroup() {
    setGroupUnread(false);
    setListOpen(false);
    setSelected({ type: "group", id: groupConversationId });
  }

  async function selectDirect(otherId: string) {
    setDirectUnread((prev) => {
      const next = new Set(prev);
      next.delete(otherId);
      return next;
    });
    setListOpen(false);
    const result = await openDirectConversation(familyId, otherId);
    if (result?.conversationId) {
      convToOther.current.set(result.conversationId, otherId);
      setSelected({ type: "direct", id: result.conversationId, otherId });
    }
  }

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText("");
    setShowEmoji(false);

    if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current);
    typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: currentUserId, typing: false },
    });

    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, user_id: currentUserId, body, created_at: new Date().toISOString() },
    ]);

    const result = await sendMessage(selected.id, body);
    setSending(false);
    if (result?.error) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(body);
    }
  }

  const headerTitle =
    selected.type === "group"
      ? "Family"
      : memberById.get(selected.otherId)?.display_name ?? "Member";

  // A conversation's unread badge is hidden while it's the one on screen.
  const viewing = !listOpen;
  const showGroupUnread = groupUnread && !(viewing && selected.type === "group");
  const showDirectUnread = (otherId: string) =>
    directUnread.has(otherId) &&
    !(viewing && selected.type === "direct" && selected.otherId === otherId);
  // Unread anywhere other than the conversation currently open (for the bar).
  const otherUnread =
    showGroupUnread || others.some((m) => showDirectUnread(m.user_id));

  // Index of the last message I sent — only this one shows a status line.
  let lastMineIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].user_id === currentUserId) {
      lastMineIndex = i;
      break;
    }
  }

  // "Sending…" / "Sent" / "Seen" / "Seen by <names>" for one of my messages.
  function statusFor(msg: Message): string {
    if (msg.id.startsWith("temp-")) return "Sending…";
    const sentAt = new Date(msg.created_at).getTime();
    const seers = reads.filter(
      (r) =>
        r.user_id !== currentUserId &&
        r.last_read_at &&
        new Date(r.last_read_at).getTime() >= sentAt
    );
    if (seers.length === 0) return "Sent";
    if (selected.type === "direct") return "Seen";
    const names = seers.map(
      (s) => memberById.get(s.user_id)?.display_name ?? "Someone"
    );
    return `Seen by ${names.join(", ")}`;
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* Conversation list */}
      <aside className="w-full lg:w-64 lg:shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm p-2">
        {/* Mobile-only "back to chats" bar, shown while a conversation is open. */}
        {!listOpen && (
          <button
            onClick={() => setListOpen(true)}
            className="lg:hidden w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50"
          >
            <span className="shrink-0 text-gray-400 text-xl leading-none">‹</span>
            {selected.type === "group" ? (
              <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center">
                👨‍👩‍👧‍👦
              </div>
            ) : (
              <Avatar
                name={headerTitle}
                url={memberById.get(selected.otherId)?.avatar_url ?? null}
                size={32}
              />
            )}
            <span className="flex-1 text-left text-sm text-gray-500 truncate">
              All chats
            </span>
            {otherUnread && (
              <span className="w-2.5 h-2.5 rounded-full bg-sky-600 shrink-0" />
            )}
          </button>
        )}

        <div className={`${listOpen ? "block" : "hidden"} lg:block`}>
        <p className="lg:hidden text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 pt-1 pb-1">
          Chats
        </p>
        <button
          onClick={selectGroup}
          className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${
            selected.type === "group" ? "bg-sky-50" : "hover:bg-gray-50"
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center text-lg">
            👨‍👩‍👧‍👦
          </div>
          <span
            className={`flex-1 text-left ${
              showGroupUnread ? "font-semibold text-gray-900" : "font-medium text-gray-800"
            }`}
          >
            Family
          </span>
          {showGroupUnread && (
            <span className="w-2.5 h-2.5 rounded-full bg-sky-600 shrink-0" />
          )}
        </button>

        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 pt-3 pb-1">
          Direct messages
        </p>
        {others.map((m) => {
          const online = onlineIds.has(m.user_id);
          const active = selected.type === "direct" && selected.otherId === m.user_id;
          const unread = showDirectUnread(m.user_id);
          return (
            <button
              key={m.user_id}
              onClick={() => selectDirect(m.user_id)}
              className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${
                active ? "bg-sky-50" : "hover:bg-gray-50"
              }`}
            >
              <div className="relative">
                <Avatar name={m.display_name} url={m.avatar_url} size={36} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                    online ? "bg-green-500" : "bg-gray-300"
                  }`}
                />
              </div>
              <span
                className={`flex-1 text-left truncate ${
                  unread ? "font-semibold text-gray-900" : "text-gray-800"
                }`}
              >
                {m.display_name}
              </span>
              {unread && (
                <span className="w-2.5 h-2.5 rounded-full bg-sky-600 shrink-0" />
              )}
            </button>
          );
        })}
        </div>
      </aside>

      {/* Conversation */}
      <div
        className={`${
          listOpen ? "hidden lg:flex" : "flex"
        } flex-1 min-w-0 w-full bg-white rounded-2xl border border-gray-100 shadow-sm flex-col h-[70vh]`}
      >
        <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">
          {selected.type === "group" ? "👨‍👩‍👧‍👦 Family chat" : `💬 ${headerTitle}`}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {loading ? (
            <p className="text-center text-gray-300 py-6 text-sm">Loading…</p>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-400">
              <div className="text-4xl mb-2">💬</div>
              <p>No messages yet. Say hello! 👋</p>
            </div>
          ) : (
            messages.map((m, i) => {
              const member = memberById.get(m.user_id);
              const isSelf = m.user_id === currentUserId;
              const prev = messages[i - 1];
              const showDay =
                !prev ||
                new Date(prev.created_at).toDateString() !==
                  new Date(m.created_at).toDateString();
              const grouped =
                prev &&
                prev.user_id === m.user_id &&
                !showDay &&
                new Date(m.created_at).getTime() -
                  new Date(prev.created_at).getTime() <
                  5 * 60 * 1000;
              return (
                <div key={m.id}>
                  {showDay && (
                    <div className="text-center my-3">
                      <span className="text-xs text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
                        {dayLabel(m.created_at)}
                      </span>
                    </div>
                  )}
                  <div
                    className={`flex items-end gap-2 ${
                      isSelf ? "flex-row-reverse" : ""
                    } ${grouped ? "mt-0.5" : "mt-3"}`}
                  >
                    <div className="w-8 shrink-0">
                      {!isSelf && !grouped && (
                        <Avatar
                          name={member?.display_name ?? "Member"}
                          url={member?.avatar_url ?? null}
                          size={32}
                        />
                      )}
                    </div>
                    <div className="max-w-[75%]">
                      {!grouped && (
                        <p
                          className={`text-xs text-gray-400 mb-0.5 ${
                            isSelf ? "text-right" : ""
                          }`}
                        >
                          {isSelf ? "You" : member?.display_name ?? "Member"}
                          <span className="ml-1.5">{formatTime(m.created_at)}</span>
                        </p>
                      )}
                      <div
                        className={`px-3 py-2 rounded-2xl break-words whitespace-pre-wrap ${
                          isSelf
                            ? "bg-sky-600 text-white rounded-br-md"
                            : "bg-gray-100 text-gray-800 rounded-bl-md"
                        }`}
                      >
                        {m.body}
                      </div>
                      {isSelf && i === lastMineIndex && (
                        <p className="text-[11px] text-gray-400 mt-0.5 text-right">
                          {statusFor(m)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {typingUsers.size > 0 && (
          <div className="px-4 py-1 flex items-center gap-2 text-xs text-gray-400">
            <span className="flex gap-0.5">
              <span
                className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </span>
            <span>
              {(() => {
                const names = Array.from(typingUsers).map(
                  (id) => memberById.get(id)?.display_name ?? "Someone"
                );
                if (names.length === 1) return `${names[0]} is typing`;
                if (names.length === 2)
                  return `${names[0]} and ${names[1]} are typing`;
                return `${names.length} people are typing`;
              })()}
            </span>
          </div>
        )}

        {showEmoji && (
          <div className="border-t border-gray-100 p-2 grid grid-cols-10 gap-1">
            {EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => {
                  setText((t) => t + em);
                  inputRef.current?.focus();
                }}
                className="text-xl hover:bg-gray-100 rounded p-1"
              >
                {em}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={handleSend}
          className="border-t border-gray-100 p-3 flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => setShowEmoji((s) => !s)}
            className="shrink-0 text-2xl leading-none px-1 text-gray-500 hover:text-gray-700"
            aria-label="Emoji"
          >
            😊
          </button>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder={`Message ${headerTitle}…`}
            className="flex-1 min-w-0 rounded-full border-2 border-gray-300 bg-gray-50 px-4 py-2 text-gray-900 outline-none focus:border-sky-500 focus:bg-white focus:ring-1 focus:ring-sky-500"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="shrink-0 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-full"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
