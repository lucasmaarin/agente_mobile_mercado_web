import { NextResponse } from "next/server";
import { callWhatsappAuthApi, isWhatsappAuthEnabled } from "@/lib/whatsappAuthApi";
import { validatePhone } from "@/lib/validation";

export async function POST(req: Request) {
  if (!isWhatsappAuthEnabled()) {
    return NextResponse.json({ error: "whatsapp-auth-disabled" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const phone = validatePhone(String(body.phone ?? ""));
  const name = typeof body.name === "string" ? body.name.trim() : undefined;

  if (!phone) {
    return NextResponse.json({ error: "invalid-phone" }, { status: 400 });
  }

  try {
    const data = await callWhatsappAuthApi("/auth/send-code", { phone, name });
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    console.error("[WhatsAppAuth] Erro ao enviar codigo:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "send-code-failed" },
      { status: 502 },
    );
  }
}

