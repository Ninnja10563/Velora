import type { Metadata } from "next";
import "./globals.css";
import Application from "@/components/application";
export const metadata: Metadata = {
  title: "Velora — Find your kind of perfect",
  description:
    "A thoughtful shopping assistant. Find, compare, and save products that fit your life and your budget.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Application>{children}</Application>
      </body>
    </html>
  );
}
