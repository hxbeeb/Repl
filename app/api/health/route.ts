import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health — liveness/readiness probe for Kubernetes.
// `?ready=1` additionally verifies database connectivity.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const checkReady = url.searchParams.get("ready") === "1";

  if (!checkReady) {
    return NextResponse.json({ status: "ok" });
  }

  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "up" });
  } catch {
    return NextResponse.json({ status: "error", db: "down" }, { status: 503 });
  }
}
