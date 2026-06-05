"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";

export function Navbar() {
  const { data: session, status } = useSession();

  return (
    <header className="topbar">
      <Link href="/" className="topbar-brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="24" rx="5" fill="black"/>
          <rect x="9" y="2" width="6" height="6" rx="1" fill="white"/>
          <rect x="2" y="9" width="6" height="6" rx="1" fill="white"/>
          <rect x="16" y="9" width="6" height="6" rx="1" fill="white"/>
          <rect x="9" y="16" width="6" height="6" rx="1" fill="white"/>
        </svg>
        Repl
      </Link>

      <div style={{ flex: 1 }} />

      <div className="topbar-actions">
        <Link href="/projects" className="topbar-link">Projects</Link>
        <Link href="/" className="btn btn-primary" style={{ height: 30, fontSize: 12 }}>
          + New
        </Link>
        <div className="topbar-sep" />
        {status === "authenticated" && session ? (
          <div className="topbar-user">
            {session.user.image ? (
              <Image src={session.user.image} alt="" width={26} height={26} className="topbar-avatar" />
            ) : (
              <div className="topbar-avatar-fallback">{session.user.name?.[0] ?? "?"}</div>
            )}
            <button className="topbar-link" style={{ cursor: "pointer" }} onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        ) : status !== "loading" ? (
          <button className="btn btn-primary" onClick={() => signIn("google")}>Sign in</button>
        ) : null}
      </div>
    </header>
  );
}
