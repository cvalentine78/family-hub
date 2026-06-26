import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFamily, getFamilyMembers } from "@/lib/family";
import { openGroupConversation } from "../actions";
import Nav from "../Nav";
import ChatApp from "./ChatApp";

export default async function ChatPage() {
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

  // Initial group messages (oldest first for display).
  const { data } = await supabase
    .from("messages")
    .select("id, user_id, body, created_at")
    .eq("conversation_id", groupConversationId)
    .order("created_at", { ascending: false })
    .limit(100);
  const initialMessages = (data ?? []).reverse();

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
        initialMessages={initialMessages}
      />
    </div>
  );
}
