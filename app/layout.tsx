import type { Metadata } from "next";
import "./globals.css";
import "highlight.js/styles/github-dark.css";
import { SessionProvider } from "@/components/SessionProvider";

export const metadata: Metadata = {
  title: "AI Builder",
  description: "Generate and run full-stack apps in E2B sandboxes."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
