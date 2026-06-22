import { NextResponse } from "next/server";
import { callWhatsappAuthApi, isWhatsappAuthEnabled } from "@/lib/whatsappAuthApi";
import { validatePhone } from "@/lib/validation";

function extractFirebaseCustomToken(data: Record<string, unknown>) {
  if (typeof data.firebaseCustomToken === "string") return data.firebaseCustomToken;
  const apiResponse = data.apiResponse;
  if (apiResponse && typeof apiResponse === "object" && "firebaseCustomToken" in apiResponse) {
    const token = (apiResponse as { firebaseCustomToken?: unknown }).firebaseCustomToken;
    if (typeof token === "string") return token;
  }
  return null;
}

export async function POST(req: Request) {
  if (!isWhatsappAuthEnabled()) {
    return NextResponse.json({ error: "whatsapp-auth-disabled" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const phone = validatePhone(String(body.phone ?? ""));
  const code = String(body.code ?? "").trim();

  if (!phone) {
    return NextResponse.json({ error: "invalid-phone" }, { status: 400 });
  }

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "invalid-code" }, { status: 400 });
  }

  try {
    const data = await callWhatsappAuthApi("/auth/verify-code", { phone, code });
    const firebaseCustomToken = extractFirebaseCustomToken(data);

    if (!firebaseCustomToken) {
      return NextResponse.json({ error: "missing-firebase-custom-token" }, { status: 502 });
    }

    return NextResponse.json({ ok: true, firebaseCustomToken });
  } catch (error) {
    console.error("[WhatsAppAuth] Erro ao verificar codigo:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "verify-code-failed" },
      { status: 502 },
    );
  }
}

