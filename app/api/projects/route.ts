import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/projects — list current user's projects
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await db.project.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      prompt: true,
      frontendUrl: true,
      sandboxId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(projects);
}

// POST /api/projects — save a new project
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, prompt, files, installCommands, startCommands, sandboxId, frontendUrl } = body;

  if (!name?.trim() || !prompt?.trim() || !files) {
    return NextResponse.json({ error: "name, prompt and files are required" }, { status: 400 });
  }

  const project = await db.project.create({
    data: {
      userId: session.user.id,
      name: name.trim(),
      prompt: prompt.trim(),
      files,
      installCommands: installCommands ?? [],
      startCommands: startCommands ?? [],
      sandboxId: sandboxId ?? null,
      frontendUrl: frontendUrl ?? null,
    },
  });

  return NextResponse.json(project, { status: 201 });
}
