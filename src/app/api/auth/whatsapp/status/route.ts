import { NextResponse } from "next/server";
import { isWhatsappAuthEnabled } from "@/lib/whatsappAuthApi";

export async function GET() {
  return NextResponse.json({
    enabled: isWhatsappAuthEnabled(),
  });
}

