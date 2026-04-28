import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { senha } = await req.json();
  const correta = process.env.ADMIN_SECRET;

  if (!correta || senha !== correta) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
