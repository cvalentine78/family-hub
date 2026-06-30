import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  ensureProfile,
  getCurrentFamily,
  getMyShareLocation,
} from "@/lib/family";
import SignOutButton from "./SignOutButton";
import LocationSharer from "./LocationSharer";
import NativeLocationSharer from "./NativeLocationSharer";
import NativePushRegistrar from "./NativePushRegistrar";
import Heartbeat from "./Heartbeat";
import BottomNav from "./BottomNav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await ensureProfile();

  const family = await getCurrentFamily();
  const shareLocation = family ? await getMyShareLocation() : false;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-[1320px] mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/app" className="flex items-center gap-2">
            <span className="text-2xl">🏠</span>
            <span className="font-bold text-sky-700">Family Hub</span>
          </Link>
          <SignOutButton />
        </div>
      </header>
      {family && (
        <>
          <LocationSharer
            enabled={shareLocation}
            familyId={family.id}
            userId={user.id}
          />
          <NativeLocationSharer
            enabled={shareLocation}
            familyId={family.id}
            userId={user.id}
          />
        </>
      )}
      <NativePushRegistrar userId={user.id} />
      <Heartbeat userId={user.id} />
      <div className="pb-20 lg:pb-0">{children}</div>
      <BottomNav />
    </div>
  );
}
