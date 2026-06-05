import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/projects/:id — fetch full project (including files for re-launch)
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = await db.project.findFirst({
    where: { id: params.id, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}

// PATCH /api/projects/:id — update sandbox URL after re-launch
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = await db.project.findFirst({
    where: { id: params.id, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const updated = await db.project.update({
    where: { id: params.id },
    data: {
      name: body.name ?? project.name,
      prompt: body.prompt ?? project.prompt,
      files: body.files ?? project.files,
      installCommands: body.installCommands ?? project.installCommands,
      startCommands: body.startCommands ?? project.startCommands,
      sandboxId: body.sandboxId ?? project.sandboxId,
      frontendUrl: body.frontendUrl ?? project.frontendUrl,
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/projects/:id
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = await db.project.findFirst({
    where: { id: params.id, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.project.delete({ where: { id: params.id } });

  return NextResponse.json({ ok: true });
}
