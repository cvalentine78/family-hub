"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  sendMessage,
  openDirectConversation,
} from "../actions";
import Avatar from "../members/Avatar";
import type { Member } from "@/lib/family";

type Message = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
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
  initialMessages,
}: {
  familyId: string;
  currentUserId: string;
  members: Member[];
  groupConversationId: string;
  initialMessages: Message[];
}) {
  const [selected, setSelected] = useState<Selected>({
    type: "group",
    id: groupConversationId,
  });
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const others = members.filter((m) => m.user_id !== currentUserId);

  // Presence for online dots.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`presence:family:${familyId}`, {
      config: { presence: { key: currentUserId } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyId, currentUserId]);

  // Load messages + subscribe whenever the selected conversation changes.
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
    load();

    const channel = supabase
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
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [selected.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function selectGroup() {
    setSelected({ type: "group", id: groupConversationId });
  }

  async function selectDirect(otherId: string) {
    const result = await openDirectConversation(familyId, otherId);
    if (result?.conversationId) {
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

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* Conversation list */}
      <aside className="w-full lg:w-64 lg:shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm p-2">
        <button
          onClick={selectGroup}
          className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${
            selected.type === "group" ? "bg-sky-50" : "hover:bg-gray-50"
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center text-lg">
            👨‍👩‍👧‍👦
          </div>
          <span className="font-medium text-gray-800">Family</span>
        </button>

        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 pt-3 pb-1">
          Direct messages
        </p>
        {others.map((m) => {
          const online = onlineIds.has(m.user_id);
          const active = selected.type === "direct" && selected.otherId === m.user_id;
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
              <span className="text-gray-800 truncate">{m.display_name}</span>
            </button>
          );
        })}
      </aside>

      {/* Conversation */}
      <div className="flex-1 min-w-0 w-full bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col h-[70vh]">
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
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

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
            className="text-2xl leading-none px-1 text-gray-500 hover:text-gray-700"
            aria-label="Emoji"
          >
            😊
          </button>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Message ${headerTitle}…`}
            className="flex-1 rounded-full border border-gray-300 px-4 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-full"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
