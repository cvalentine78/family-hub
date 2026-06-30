import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFamily, getFamilyMembers } from "@/lib/family";
import { openGroupConversation } from "../actions";
import Nav from "../Nav";
import ChatApp, { type InitialSelected } from "./ChatApp";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const family = await getCurrentFamily();
  if (!family) redirect("/app");

  const members = await getFamilyMembers(family.id);

  // Ensure the family group conversation exists.
  const group = await openGroupConversation(family.id);
  const groupConversationId = group.conversationId ?? "";

  // Resolve the initial conversation: a deep link (?c=) into a direct chat the
  // user belongs to, otherwise the family group.
  let initialSelected: InitialSelected = {
    type: "group",
    id: groupConversationId,
    otherId: null,
  };
  if (c && c !== groupConversationId) {
    const { data: parts } = await supabase
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", c);
    if (parts?.some((p) => p.user_id === user.id)) {
      const other = parts.find((p) => p.user_id !== user.id);
      initialSelected = { type: "direct", id: c, otherId: other?.user_id ?? null };
    }
  }

  // Initial messages for the selected conversation (oldest first for display).
  const { data } = await supabase
    .from("messages")
    .select("id, user_id, body, created_at")
    .eq("conversation_id", initialSelected.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const initialMessages = (data ?? []).reverse();

  // Unread badges: for each conversation I'm in, is the latest message newer
  // than my last_read_at and not mine? Resolve directs to the other member.
  const { data: myParts } = await supabase
    .from("conversation_participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", user.id);

  const convIds = (myParts ?? []).map((p) => p.conversation_id);
  let initialGroupUnread = false;
  const initialDirectUnread: string[] = [];

  if (convIds.length) {
    const [{ data: latest }, { data: allParts }] = await Promise.all([
      supabase
        .from("messages")
        .select("conversation_id, user_id, created_at")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("conversation_participants")
        .select("conversation_id, user_id")
        .in("conversation_id", convIds),
    ]);

    const lastReadByConv = new Map(
      (myParts ?? []).map((p) => [p.conversation_id, p.last_read_at])
    );
    // First row per conversation is its newest message (list is desc).
    const newestByConv = new Map<string, { user_id: string; created_at: string }>();
    for (const m of latest ?? []) {
      if (!newestByConv.has(m.conversation_id)) {
        newestByConv.set(m.conversation_id, { user_id: m.user_id, created_at: m.created_at });
      }
    }
    const otherByConv = new Map<string, string>();
    for (const p of allParts ?? []) {
      if (p.user_id !== user.id) otherByConv.set(p.conversation_id, p.user_id);
    }

    for (const convId of convIds) {
      const newest = newestByConv.get(convId);
      if (!newest || newest.user_id === user.id) continue;
      const lastRead = lastReadByConv.get(convId);
      const unread = !lastRead || new Date(newest.created_at) > new Date(lastRead);
      if (!unread) continue;
      if (convId === groupConversationId) initialGroupUnread = true;
      else {
        const other = otherByConv.get(convId);
        if (other) initialDirectUnread.push(other);
      }
    }
  }

  return (
    <div className="max-w-[1320px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Chat</h1>
          <p className="text-sm text-gray-500">{family.name}</p>
        </div>
        <Nav />
      </div>

      <ChatApp
        familyId={family.id}
        currentUserId={user.id}
        members={members}
        groupConversationId={groupConversationId}
        initialSelected={initialSelected}
        initialMessages={initialMessages}
        initialGroupUnread={initialGroupUnread}
        initialDirectUnread={initialDirectUnread}
        deepLinked={Boolean(c)}
      />
    </div>
  );
}
