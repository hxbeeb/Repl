import type { Metadata } from "next";
import "./globals.css";
import "highlight.js/styles/github.css";

export const metadata: Metadata = {
  title: "AI App Builder",
  description: "Generate and run full-stack apps in E2B sandboxes."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
