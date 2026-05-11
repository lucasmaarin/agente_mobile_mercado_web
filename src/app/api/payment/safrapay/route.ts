import { NextRequest, NextResponse } from "next/server";
import {
  SafrapayClient,
  SafrapayPaymentType,
  SafrapayInstallmentType,
  SafrapayTransactionStatus,
} from "@/lib/safrapay";
import * as admin from "firebase-admin";

const endpointMap = {
  hml: "https://payment-hml.safrapay.com.br",
  prod: "https://payment.safrapay.com.br",
} as const;

type SafrapayEnvironment = keyof typeof endpointMap;

function normalizeEnvironment(value: unknown): SafrapayEnvironment {
  return value === "prod" ? "prod" : "hml";
}

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

async function resolveSafrapayCredentials(
  companyId: unknown,
  requestedEnvironment: unknown
) {
  const id = typeof companyId === "string" ? companyId.trim() : "";
  const fallbackEnvironment = normalizeEnvironment(requestedEnvironment || process.env.SAFRAPAY_ENV);
  const adminDb = getAdminDb();

  if (!adminDb && fallbackEnvironment === "prod") {
    return {
      merchantId: "",
      merchantToken: "",
      environment: "prod" as const,
      endpoint: endpointMap.prod,
      source: "firestore",
      missingFields: ["FIREBASE_ADMIN_EMAIL", "FIREBASE_ADMIN_KEY"],
    };
  }

  if (id && adminDb) {
    const snap = await adminDb.collection("estabelecimentos").doc(id).get();
    const safrapay = snap.data()?.safrapay as Record<string, unknown> | undefined;

    if (safrapay?.enabled) {
      const environment = normalizeEnvironment(safrapay.environment || fallbackEnvironment);
      const merchantId = typeof safrapay.merchantId === "string" ? safrapay.merchantId.trim() : "";
      const merchantToken =
        typeof safrapay.merchantToken === "string" ? safrapay.merchantToken.trim()
        : typeof safrapay.accessToken === "string" ? safrapay.accessToken.trim()
        : "";

      if (merchantId && merchantToken) {
        return {
          merchantId,
          merchantToken,
          environment,
          endpoint: endpointMap[environment],
          source: "firestore",
        };
      }

      if (environment === "prod") {
        return {
          merchantId,
          merchantToken,
          environment,
          endpoint: endpointMap.prod,
          source: "firestore",
          missingFields: [
            !merchantId ? "safrapay.merchantId" : "",
            !merchantToken ? "safrapay.merchantToken" : "",
          ].filter(Boolean),
        };
      }
    }
  }

  const environment = fallbackEnvironment;
  return {
    merchantId: process.env.SAFRAPAY_MERCHANT_ID || "",
    merchantToken: process.env.SAFRAPAY_MERCHANT_TOKEN || process.env.SAFRAPAY_ACCESS_TOKEN || "",
    environment,
    endpoint: process.env.SAFRAPAY_GATEWAY_URL || endpointMap[environment],
    source: "env",
  };
}

function onlyDigits(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function buildCustomer(body: Record<string, unknown>) {
  const document = onlyDigits(body.customerDocument);
  if (document.length !== 11 && document.length !== 14) {
    throw new Error("CPF/CNPJ do cliente é obrigatório para pagamentos Safrapay");
  }

  const rawPhone = onlyDigits(body.customerPhone) || "11999999999";
  const areaCode = rawPhone.length >= 10 ? rawPhone.slice(0, 2) : "11";
  const number = rawPhone.length >= 10 ? rawPhone.slice(2) : "999999999";
  const orderId = String(body.orderId || "pedido").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);

  return {
    name: String(body.customerName || "Cliente"),
    email: typeof body.customerEmail === "string" && body.customerEmail.includes("@")
      ? body.customerEmail
      : `cliente.${orderId || Date.now()}@mobilemercado.com.br`,
    document,
    documentType: document.length === 14 ? 2 : 1,
    phone: {
      countryCode: "55",
      areaCode,
      number,
      type: 5,
    },
  };
}

/**
 * Processa pagamentos com Safrapay
 * POST /api/payment/safrapay
 * 
 * Body:
 * {
 *   type: "pix" | "card",
 *   amount: number,
 *   orderId: string,
 *   companyId: string,
 *   description: string,
 *   customerName: string,
 *   safrapayConfig?: { enabled, environment },
 *   // Para cartão:
 *   cardNumber?: string,
 *   cardholderName?: string,
 *   expirationMonth?: number,
 *   expirationYear?: number,
 *   cvv?: string,
 *   installments?: number,
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, amount, orderId, description, safrapayConfig, companyId } = body;

    if (!type || !amount || !orderId || !description) {
      return NextResponse.json(
        { error: "Parâmetros obrigatórios faltando" },
        { status: 400 }
      );
    }

    if (type !== "pix" && type !== "card") {
      return NextResponse.json(
        { error: "Tipo de pagamento inválido" },
        { status: 400 }
      );
    }

    const credentials = await resolveSafrapayCredentials(companyId, safrapayConfig?.environment);
    const { merchantId, merchantToken, endpoint } = credentials;

    if (!merchantId || !merchantToken) {
      const missingFields =
        "missingFields" in credentials && credentials.missingFields
          ? credentials.missingFields
          : [
              !merchantId ? "SAFRAPAY_MERCHANT_ID" : "",
              !merchantToken ? "SAFRAPAY_MERCHANT_TOKEN" : "",
            ].filter(Boolean);
      
      console.error("Safrapay Config Error:", {
        missingFields,
        companyId,
        source: credentials.source,
        environment: credentials.environment,
      });

      return NextResponse.json(
        { 
          error: `Credenciais Safrapay não configuradas. Faltando: ${missingFields.join(", ")}`,
          debug: { missingFields }
        },
        { status: 500 }
      );
    }

    const client = new SafrapayClient(merchantId, merchantToken, endpoint);
    let customer: ReturnType<typeof buildCustomer>;
    try {
      customer = buildCustomer(body);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Dados do cliente inválidos" },
        { status: 400 }
      );
    }

    // Processar PIX
    if (type === "pix") {
      try {
        const pixResponse = await client.createPixCharge({
          amount,
          orderId,
          description,
          customer,
        });

        return NextResponse.json({
          success: true,
          type: "pix",
          transactionId: pixResponse.transactionId,
          chargeId: pixResponse.chargeId,
          qrCode: pixResponse.qrCode,
          qrCodeBase64: pixResponse.qrCodeBase64,
          qrCodeUrl: pixResponse.qrCodeBase64 ? `data:image/bmp;base64,${pixResponse.qrCodeBase64}` : undefined,
          copyPasteKey: pixResponse.copyPasteKey,
          expiresAt: pixResponse.expiresAt,
          status: pixResponse.status,
          // Para o pedido no Firebase
          orderStatus: "waitingForPayment",
        });
      } catch (error) {
        console.error("Erro ao processar PIX:", error);
        return NextResponse.json(
          { error: "Erro ao gerar PIX. Tente novamente." },
          { status: 500 }
        );
      }
    }

    // Processar Cartão
    if (type === "card") {
      const {
        cardNumber,
        cardholderName,
        expirationMonth,
        expirationYear,
        cvv,
        installments = 1,
        paymentMethod = "credit",
      } = body;

      if (
        !cardNumber ||
        !cardholderName ||
        !expirationMonth ||
        !expirationYear ||
        !cvv ||
        !customer.document
      ) {
        return NextResponse.json(
          { error: "Dados do cartão incompletos" },
          { status: 400 }
        );
      }

      try {
        const cardResponse = await client.createCardCharge({
          amount,
          cardNumber: cardNumber.replace(/\D/g, ""),
          cardholderName,
          cardholderDocument: customer.document,
          expirationMonth: parseInt(expirationMonth, 10),
          expirationYear: parseInt(expirationYear, 10),
          cvv,
          paymentType: paymentMethod === "debit" ? SafrapayPaymentType.Debit : SafrapayPaymentType.Credit,
          installments: parseInt(installments, 10),
          installmentType:
            installments > 1
              ? SafrapayInstallmentType.Merchant
              : SafrapayInstallmentType.None,
          orderId,
          description,
          customer,
        });

        // Verificar status da transação
        const isApproved =
          cardResponse.status === SafrapayTransactionStatus.Captured ||
          cardResponse.status === SafrapayTransactionStatus.PreAuthorized ||
          cardResponse.status === "Captured" ||
          cardResponse.status === "PreAuthorized" ||
          cardResponse.status === "Authorized";

        return NextResponse.json({
          success: isApproved,
          type: "card",
          transactionId: cardResponse.transactionId,
          chargeId: cardResponse.chargeId,
          authorizationCode: cardResponse.authorizationCode,
          status: cardResponse.status,
          responseMessage: cardResponse.responseMessage,
          // Para o pedido no Firebase
          orderStatus: isApproved ? "paidAwaitingConfirmation" : "paymentDenied",
        });
      } catch (error) {
        console.error("Erro ao processar cartão:", error);
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Erro ao processar cartão. Tente novamente.",
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: "Tipo de pagamento não suportado" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Erro na API de pagamento:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
