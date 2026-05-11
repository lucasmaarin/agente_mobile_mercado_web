import { NextRequest, NextResponse } from "next/server";
import * as admin from "firebase-admin";

function getAdminDb(): admin.firestore.Firestore | null {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      databaseURL: `https://${projectId}.firebaseio.com`,
    });
  }

  return admin.firestore();
}

/**
 * Endpoint para configurar Safrapay em um estabelecimento
 * POST /api/admin/setup-safrapay
 * 
 * Body:
 * {
 *   adminSecret: string,
 *   establishmentId: string,
 *   safrapayConfig: {
 *     enabled: boolean,
 *     merchantId?: string,
 *     accessToken?: string,
 *     webhookSecret?: string,
 *     environment: "hml" | "prod"
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { adminSecret, establishmentId, safrapayConfig } = body;

    // Validar admin secret
    const correctSecret = process.env.ADMIN_SECRET;
    if (!adminSecret || adminSecret !== correctSecret) {
      return NextResponse.json(
        { error: "Acesso negado" },
        { status: 401 }
      );
    }

    if (!establishmentId || !safrapayConfig) {
      return NextResponse.json(
        { error: "Parâmetros obrigatórios faltando" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json(
        { error: "Firebase Admin nÃ£o configurado no servidor" },
        { status: 500 }
      );
    }

    // Atualizar documento no Firestore usando Admin SDK
    await db.collection("estabelecimentos").doc(establishmentId).update({
      safrapay: safrapayConfig,
    });

    return NextResponse.json({
      success: true,
      message: `Safrapay configurado para ${establishmentId}`,
      config: safrapayConfig,
    });
  } catch (error) {
    console.error("Erro ao configurar Safrapay:", error);
    return NextResponse.json(
      { error: "Erro ao processar requisição" },
      { status: 500 }
    );
  }
}
