"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";

export function Navbar() {
  const { data: session, status } = useSession();

  return (
    <header className="topbar">
      <Link href="/" className="topbar-brand">
        <span className="topbar-brand-dot" />
        Builder
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
