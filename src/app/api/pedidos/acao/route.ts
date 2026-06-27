import { NextRequest, NextResponse } from "next/server";
import { admin, getAdminDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cleanStatus(status: unknown): string {
  return String(status ?? "")
    .replace(/^PurchaseStatus\./, "")
    .trim();
}

function isAutomaticCancelStatus(status: string): boolean {
  return status === "waitingForOrderPayment" || status === "waitingForPayment";
}

function isRefundRequestStatus(status: string): boolean {
  return status === "pending";
}

function isSupportRequestStatus(status: string): boolean {
  return ["accepted", "preparing", "delivering", "delivered"].includes(status);
}

async function verifyUser(userDocId: string, authHeader: string | null) {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return false;

  const decoded = await admin.auth().verifyIdToken(token);
  const db = getAdminDb();
  if (!db) return false;

  const userSnap = await db.collection("Users").doc(userDocId).get();
  return userSnap.exists && userSnap.data()?.userAuthId === decoded.uid;
}

function getSaoPauloDateId(date = new Date()): string {
  const dateParts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const getPart = (type: string) => dateParts.find((part) => part.type === type)?.value ?? "";
  return getPart("day") + "-" + getPart("month") + "-" + getPart("year");
}

function getReferenceId(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.split("/").filter(Boolean).pop() ?? "";
  if (typeof value === "object") {
    const maybeRef = value as { id?: unknown; path?: unknown };
    if (typeof maybeRef.id === "string") return maybeRef.id;
    if (typeof maybeRef.path === "string") {
      return maybeRef.path.split("/").filter(Boolean).pop() ?? "";
    }
  }
  return "";
}

function getCompanyIdFromPedido(pedido: FirebaseFirestore.DocumentData): string {
  return getReferenceId(pedido.companyReference) ||
    getReferenceId(pedido.companyRef) ||
    getReferenceId(pedido.estabelecimentoRef) ||
    (typeof pedido.companyId === "string" ? pedido.companyId : "") ||
    (typeof pedido.estabelecimentoId === "string" ? pedido.estabelecimentoId : "");
}

function isAgentOrder(pedido: FirebaseFirestore.DocumentData): boolean {
  if (
    pedido.agentOrder === true ||
    pedido.isAgentOrder === true ||
    pedido.createdByAgent === true ||
    pedido.fromAgent === true
  ) {
    return true;
  }

  const source = [
    pedido.source,
    pedido.channel,
    pedido.origin,
    pedido.origem,
    pedido.platform,
    pedido.purchaseOrigin,
    pedido.createdBy,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");

  return /(agent|agente|chat|ia)/.test(source);
}

function getAgentCancelMetricRefs(
  db: FirebaseFirestore.Firestore,
  pedido: FirebaseFirestore.DocumentData,
  pedidoId: string
) {
  if (!isAgentOrder(pedido)) return null;

  const companyId = getCompanyIdFromPedido(pedido);
  if (!companyId) return null;

  const dateId = getSaoPauloDateId();
  const eventId = `${companyId}:${pedidoId}:order_canceled`.replace(/\//g, "_").slice(0, 500);
  const root = db.collection("AgenteVendas").doc(companyId);

  return {
    companyId,
    dateId,
    eventId,
    eventRef: root.collection("capturasDeDados").doc(eventId),
    metricRef: root.collection("metricasDeCapturas").doc("resumo"),
    statsRefs: [
      db.collection("estabelecimentos").doc(companyId).collection("DailyStats").doc(dateId),
      db.collection("estabelecimentos").doc(companyId).collection("MonthlyStats").doc(dateId),
      db.collection("estabelecimentos").doc(companyId).collection("Stats").doc("allTime"),
    ],
  };
}

function recordAgentCanceledOrder(
  transaction: FirebaseFirestore.Transaction,
  refs: NonNullable<ReturnType<typeof getAgentCancelMetricRefs>>,
  existing: FirebaseFirestore.DocumentSnapshot,
  now: FirebaseFirestore.FieldValue,
  pedidoId: string,
  userDocId: string,
  motivo: string,
  statusAnterior: string
) {
  if (existing.exists) return;

  transaction.set(refs.eventRef, {
    idEvento: refs.eventId,
    tipoEvento: "order_canceled",
    estabelecimentoId: refs.companyId,
    visitanteId: userDocId,
    sessaoId: `pedido:${pedidoId}`,
    usuarioId: userDocId,
    dados: {
      pedidoId,
      motivo: motivo || null,
      statusAnterior,
      source: "pedido_acao",
    },
    criadoEm: now,
  });

  transaction.set(refs.metricRef, {
    estabelecimentoId: refs.companyId,
    atualizadoEm: now,
    pedidosCancelados: admin.firestore.FieldValue.increment(1),
  }, { merge: true });

  const statsUpdate = {
    estabelecimentoId: refs.companyId,
    dateId: refs.dateId,
    agentCanceledOrdersCount: admin.firestore.FieldValue.increment(1),
    agentStatsUpdatedAt: now,
  };

  refs.statsRefs.forEach((ref) => {
    transaction.set(ref, statsUpdate, { merge: true });
  });
}

export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: "Firebase Admin nao configurado" }, { status: 500 });
    }

    const body = await request.json();
    const pedidoId = typeof body?.pedidoId === "string" ? body.pedidoId : "";
    const userDocId = typeof body?.userDocId === "string" ? body.userDocId : "";
    const motivo = typeof body?.motivo === "string" ? body.motivo.trim().slice(0, 500) : "";

    if (!pedidoId || !userDocId) {
      return NextResponse.json({ error: "pedidoId e userDocId sao obrigatorios" }, { status: 400 });
    }

    const autorizado = await verifyUser(userDocId, request.headers.get("authorization"));
    if (!autorizado) {
      return NextResponse.json({ error: "Nao autorizado" }, { status: 403 });
    }

    const pedidoRef = db.collection("PurchaseRequests").doc(pedidoId);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const statusCreatedAt = admin.firestore.Timestamp.now();

    const result = await db.runTransaction(async (transaction) => {
      const pedidoSnap = await transaction.get(pedidoRef);
      if (!pedidoSnap.exists) {
        return { status: 404, body: { error: "Pedido nao encontrado" } };
      }

      const pedido = pedidoSnap.data() ?? {};
      if (pedido.clientId !== userDocId) {
        return { status: 403, body: { error: "Pedido nao pertence a esta conta" } };
      }

      const statusAtual = cleanStatus(pedido.currentPurchaseStatus);
      const paymentProvider = typeof pedido.paymentProvider === "string" ? pedido.paymentProvider : null;
      const statusListAtual = Array.isArray(pedido.statusList) ? pedido.statusList : [];
      const requestRef = pedidoRef.collection("solicitacoesCancelamento").doc();
      const agentCancelRefs = getAgentCancelMetricRefs(db, pedido, pedidoId);
      const agentCancelSnap = agentCancelRefs ? await transaction.get(agentCancelRefs.eventRef) : null;

      if (isAutomaticCancelStatus(statusAtual)) {
        const novoStatus = "PurchaseStatus.canceled";
        transaction.update(pedidoRef, {
          currentPurchaseStatus: novoStatus,
          paymentStatus: "canceled",
          cancelReason: motivo || "Cancelado pelo cliente antes da confirmacao do pagamento",
          cancelRequestedAt: now,
          canceledAt: now,
          updatedAt: now,
          statusList: [...statusListAtual, { purchaseStatus: novoStatus, createdAt: statusCreatedAt }],
        });
        transaction.set(requestRef, {
          tipo: "cancelamento_local",
          status: "completed",
          motivo,
          pagamento: paymentProvider,
          criadoEm: now,
        });
        if (agentCancelRefs && agentCancelSnap) {
          recordAgentCanceledOrder(
            transaction,
            agentCancelRefs,
            agentCancelSnap,
            now,
            pedidoId,
            userDocId,
            motivo,
            statusAtual
          );
        }
        return {
          status: 200,
          body: {
            success: true,
            action: "canceled",
            updatedStatus: novoStatus,
            message: "Pedido cancelado. Como o Pix ainda nao foi pago, nao ha reembolso a processar.",
          },
        };
      }

      if (isRefundRequestStatus(statusAtual)) {
        const novoStatus = paymentProvider === "safrapay"
          ? "PurchaseStatus.refundRequested"
          : "PurchaseStatus.canceled";
        transaction.update(pedidoRef, {
          currentPurchaseStatus: novoStatus,
          refundStatus: paymentProvider === "safrapay" ? "requested" : null,
          cancelReason: motivo || "Cancelamento solicitado pelo cliente",
          refundRequestedAt: paymentProvider === "safrapay" ? now : null,
          cancelRequestedAt: now,
          updatedAt: now,
          statusList: [...statusListAtual, { purchaseStatus: novoStatus, createdAt: statusCreatedAt }],
        });
        transaction.set(requestRef, {
          tipo: paymentProvider === "safrapay" ? "solicitacao_reembolso" : "cancelamento",
          status: paymentProvider === "safrapay" ? "requested" : "completed",
          motivo,
          pagamento: paymentProvider,
          criadoEm: now,
        });
        if (paymentProvider !== "safrapay" && agentCancelRefs && agentCancelSnap) {
          recordAgentCanceledOrder(
            transaction,
            agentCancelRefs,
            agentCancelSnap,
            now,
            pedidoId,
            userDocId,
            motivo,
            statusAtual
          );
        }
        return {
          status: 200,
          body: {
            success: true,
            action: paymentProvider === "safrapay" ? "refundRequested" : "canceled",
            updatedStatus: novoStatus,
            message: paymentProvider === "safrapay"
              ? "Solicitacao de reembolso enviada para analise."
              : "Pedido cancelado.",
          },
        };
      }

      if (isSupportRequestStatus(statusAtual)) {
        transaction.update(pedidoRef, {
          cancelRequestStatus: "requested",
          cancelReason: motivo || "Cancelamento solicitado pelo cliente",
          cancelRequestedAt: now,
          updatedAt: now,
        });
        transaction.set(requestRef, {
          tipo: "solicitacao_cancelamento_atendimento",
          status: "requested",
          motivo,
          pagamento: paymentProvider,
          criadoEm: now,
        });
        return {
          status: 200,
          body: {
            success: true,
            action: "supportRequested",
            updatedStatus: pedido.currentPurchaseStatus,
            message: "Solicitacao enviada para atendimento da loja.",
          },
        };
      }

      return {
        status: 409,
        body: { error: "Este pedido nao permite cancelamento pelo cliente neste status." },
      };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Erro ao processar acao do pedido:", error);
    return NextResponse.json({ error: "Erro interno ao processar pedido" }, { status: 500 });
  }
}
