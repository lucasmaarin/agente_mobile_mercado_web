import { NextResponse } from "next/server";
import { callWhatsappAuthApi, isWhatsappAuthEnabled } from "@/lib/whatsappAuthApi";
import { validatePhone } from "@/lib/validation";

const SEND_CODE_COOLDOWN_MS = 60 * 1000;
const sendCodeAttempts = new Map<string, number>();

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

  const now = Date.now();
  const allowedAt = sendCodeAttempts.get(phone) ?? 0;
  if (allowedAt > now) {
    return NextResponse.json(
      {
        error: "send-code-cooldown",
        retryAfterMs: allowedAt - now,
      },
      { status: 429 },
    );
  }
  sendCodeAttempts.set(phone, now + SEND_CODE_COOLDOWN_MS);

  try {
    const data = await callWhatsappAuthApi("/auth/send-code", { phone, name });
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    sendCodeAttempts.delete(phone);
    console.error("[WhatsAppAuth] Erro ao enviar codigo:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "send-code-failed" },
      { status: 502 },
    );
  }
}
