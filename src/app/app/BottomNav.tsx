"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app", label: "Home", icon: "🏠" },
  { href: "/app/calendar", label: "Calendar", icon: "📅" },
  { href: "/app/chat", label: "Chat", icon: "💬" },
  { href: "/app/groceries", label: "Groceries", icon: "🛒" },
  { href: "/app/projects", label: "Projects", icon: "📌" },
  { href: "/app/map", label: "Map", icon: "📍" },
  { href: "/app/members", label: "Family", icon: "👨‍👩‍👧‍👦" },
];

// Fixed bottom tab bar for mobile — always-available navigation so you can get
// out of a chat (or anywhere) without scrolling. Hidden on desktop, where the
// top Nav is shown instead.
export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around">
        {TABS.map((tab) => {
          const active =
            tab.href === "/app"
              ? pathname === "/app"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                active ? "text-sky-700" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              <span className="truncate">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
