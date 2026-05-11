import { NextRequest, NextResponse } from "next/server";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * DEBUG: Verificar configuração Safrapay de um estabelecimento
 * GET /api/debug/safrapay-config?establishmentId=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const establishmentId = searchParams.get("establishmentId");
    const adminSecret = searchParams.get("adminSecret");

    if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
      return NextResponse.json(
        { error: "Acesso negado" },
        { status: 401 }
      );
    }

    if (!establishmentId) {
      return NextResponse.json(
        { error: "establishmentId obrigatório" },
        { status: 400 }
      );
    }

    const docRef = doc(db, "estabelecimentos", establishmentId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return NextResponse.json(
        { error: "Estabelecimento não encontrado" },
        { status: 404 }
      );
    }

    const data = docSnap.data();
    const safrapayConfig = data.safrapay;
    const safeSafrapayConfig = safrapayConfig
      ? {
          enabled: Boolean(safrapayConfig.enabled),
          merchantId: safrapayConfig.merchantId ? "***" : undefined,
          accessToken: safrapayConfig.accessToken ? "***" : undefined,
          webhookSecret: safrapayConfig.webhookSecret ? "***" : undefined,
          environment: safrapayConfig.environment,
        }
      : null;

    return NextResponse.json({
      establishmentId,
      name: data.name,
      safrapayConfigured: !!safrapayConfig,
      safrapay: safeSafrapayConfig,
    });
  } catch (error) {
    console.error("Erro ao buscar config:", error);
    return NextResponse.json(
      { error: "Erro ao processar" },
      { status: 500 }
    );
  }
}
