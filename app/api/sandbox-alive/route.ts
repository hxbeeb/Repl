import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) return NextResponse.json({ alive: false });

  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(4000),
    });
    return NextResponse.json({ alive: res.ok || res.type === "opaque" });
  } catch {
    return NextResponse.json({ alive: false });
  }
}
