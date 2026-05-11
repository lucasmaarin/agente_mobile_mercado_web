/**
 * Webhook para confirmação de pagamento PIX do Safrapay
 * 
 * Este arquivo é um EXEMPLO de como implementar o webhook
 * Você precisa configurar a URL deste endpoint no portal Safrapay
 * 
 * URL configurada no Safrapay: https://seu-dominio.com/api/webhook/safrapay/pix
 */

import { NextRequest, NextResponse } from "next/server";
import { updateDoc, query, collection, where, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import crypto from "crypto";

/**
 * Valida a assinatura do webhook (implementar com secret da Safrapay)
 */
function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return hash === signature;
}

/**
 * POST /api/webhook/safrapay/pix
 * 
 * Recebe notificações do Safrapay quando um PIX é pago
 * Atualiza o status do pedido no Firestore
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.text();
    const signature = request.headers.get("x-safrapay-signature");
    const eventType = request.headers.get("x-safrapay-event");

    if (!signature || !eventType) {
      return NextResponse.json(
        { error: "Headers obrigatórios faltando" },
        { status: 400 }
      );
    }

    // Validar assinatura (usar secret do Safrapay)
    const webhookSecret = process.env.SAFRAPAY_WEBHOOK_SECRET || "";
    if (!validateWebhookSignature(payload, signature, webhookSecret)) {
      console.warn("Assinatura de webhook inválida");
      return NextResponse.json(
        { error: "Assinatura inválida" },
        { status: 403 }
      );
    }

    const event = JSON.parse(payload);
    const { chargeId, transactionId, status, paidAt } = event;

    // Processar apenas eventos de pagamento confirmado
    if (status !== "paid" && status !== "Paid" && status !== 8) {
      return NextResponse.json({ success: true });
    }

    // Buscar o pedido no Firestore pelo transactionId
    // Esta é uma exemplo simples - você pode ajustar conforme sua estrutura
    const ordersCollection = collection(db, "PurchaseRequests");
    const q = query(
      ordersCollection,
      where("paymentTransactionId", "==", transactionId)
    );
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      console.warn(`Pedido não encontrado para transactionId: ${transactionId}`);
      return NextResponse.json(
        { error: "Pedido não encontrado" },
        { status: 404 }
      );
    }

    // Atualizar cada pedido encontrado
    for (const docSnap of querySnapshot.docs) {
      const statusListAtual: unknown[] = docSnap.data()?.statusList ?? [];
      const pendingStatus = "PurchaseStatus.pending";

      await updateDoc(docSnap.ref, {
        currentPurchaseStatus: pendingStatus,
        statusList: [...statusListAtual, { purchaseStatus: pendingStatus, createdAt: Timestamp.now() }],
        paymentStatus: "paid",
        paymentConfirmedAt: paidAt ? new Date(paidAt) : new Date(),
        paymentChargeId: chargeId,
        webhookProcessedAt: new Date(),
      });

      console.log(`Pedido atualizado: ${docSnap.id}`);
    }

    // Responder com sucesso para Safrapay
    return NextResponse.json(
      { success: true, processedAt: new Date() },
      { status: 200 }
    );
  } catch (error) {
    console.error("Erro ao processar webhook Safrapay:", error);
    return NextResponse.json(
      { error: "Erro ao processar webhook" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/webhook/safrapay/pix
 * 
 * Endpoint para teste - verifica se o webhook está ativo
 */
export async function GET() {
  return NextResponse.json({
    status: "active",
    endpoint: "/api/webhook/safrapay/pix",
    events: ["charge.paid", "charge.denied"],
  });
}
