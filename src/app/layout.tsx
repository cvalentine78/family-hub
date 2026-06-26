import type { Metadata } from "next";
import "./globals.css";
import NativeAuthHandler from "./NativeAuthHandler";

export const metadata: Metadata = {
  title: "Family Hub",
  description: "Your family's shared space",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NativeAuthHandler />
        {children}
      </body>
    </html>
  );
}
