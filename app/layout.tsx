import type { Metadata } from "next";
import "./globals.css";
import "highlight.js/styles/github-dark.css";
import { SessionProvider } from "@/components/SessionProvider";

export const metadata: Metadata = {
  title: "Repl",
  description: "Generate and run full-stack apps in E2B sandboxes.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='5' fill='black'/><rect x='9' y='2' width='6' height='6' rx='1' fill='white'/><rect x='2' y='9' width='6' height='6' rx='1' fill='white'/><rect x='16' y='9' width='6' height='6' rx='1' fill='white'/><rect x='9' y='16' width='6' height='6' rx='1' fill='white'/></svg>",
  },
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
