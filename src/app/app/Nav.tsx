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
  { href: "/app/members", label: "Members", icon: "👨‍👩‍👧‍👦" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="hidden lg:flex gap-1 overflow-x-auto max-w-full -mx-1 px-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            title={tab.label}
            className={`shrink-0 whitespace-nowrap px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? "bg-sky-100 text-sky-700"
                : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
            }`}
          >
            <span className="sm:mr-1">{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
