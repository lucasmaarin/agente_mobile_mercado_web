import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_SAFRAPAY_MOBILE_API_URL =
  "https://safrapi--appmobileprod-19505.us-east4.hosted.app";

type SafrapayPaymentType = "pix" | "card";

interface IncomingSafrapayBody {
  type?: unknown;
  amount?: unknown;
  orderId?: unknown;
  companyId?: unknown;
  companySlug?: unknown;
  whitelabelId?: unknown;
  description?: unknown;
  customerName?: unknown;
  customerDocument?: unknown;
  customerPhone?: unknown;
  customerEmail?: unknown;
  paymentMethod?: unknown;
  cardNumber?: unknown;
  cardholderName?: unknown;
  expirationMonth?: unknown;
  expirationYear?: unknown;
  cvv?: unknown;
  installments?: unknown;
}

function getSafrapayApiBaseUrl() {
  const configured =
    process.env.SAFRAPAY_MOBILE_API_URL ||
    process.env.SAFRAPAY_API_BASE_URL ||
    "";

  if (configured.trim()) {
    return configured.trim().replace(/\/+$/, "");
  }

  return DEFAULT_SAFRAPAY_MOBILE_API_URL;
}

function onlyDigits(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\D/g, "")
    : "";
}

function getString(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function normalizePaymentType(value: unknown): SafrapayPaymentType | null {
  return value === "pix" || value === "card" ? value : null;
}

function normalizeAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

function buildExternalPayload(body: IncomingSafrapayBody) {
  const type = normalizePaymentType(body.type);
  const amount = normalizeAmount(body.amount);
  const orderId = getString(body.orderId);
  const description = getString(body.description);

  if (!type || !amount || !orderId || !description) {
    return {
      error: "Parametros obrigatorios faltando",
      payload: null,
      type,
    };
  }

  const customerDocument = onlyDigits(body.customerDocument);
  if (customerDocument.length !== 11 && customerDocument.length !== 14) {
    return {
      error: "CPF/CNPJ do cliente e obrigatorio para pagamentos Safrapay",
      payload: null,
      type,
    };
  }

  const commonPayload = {
    amount,
    orderId,
    description,
    companyId: getString(body.companyId) || undefined,
    companySlug: getString(body.companySlug) || undefined,
    whitelabelId: getString(body.whitelabelId) || undefined,
    customer: {
      name: getString(body.customerName) || "Cliente",
      document: customerDocument,
      phone: onlyDigits(body.customerPhone) || undefined,
      email: getString(body.customerEmail) || undefined,
    },
  };

  if (type === "pix") {
    return { error: "", payload: commonPayload, type };
  }

  return {
    error: "",
    type,
    payload: {
      ...commonPayload,
      paymentMethod: getString(body.paymentMethod) || "credit",
      card: {
        cardNumber: onlyDigits(body.cardNumber),
        cardholderName: getString(body.cardholderName),
        expirationMonth: Number(body.expirationMonth),
        expirationYear: Number(body.expirationYear),
        cvv: onlyDigits(body.cvv),
        installments: Number(body.installments || 1),
      },
    },
  };
}

async function readApiResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text };
  }
}

function normalizeSuccessResponse(type: SafrapayPaymentType, data: Record<string, unknown>) {
  if (type === "pix") {
    return {
      ...data,
      success: data.success !== false,
      type: "pix",
      orderStatus: "waitingForOrderPayment",
    };
  }

  return {
    ...data,
    success: data.success === true,
    type: "card",
    orderStatus: data.orderStatus || (data.success === true ? "paidAwaitingConfirmation" : "paymentDenied"),
  };
}

export async function POST(request: NextRequest) {
  try {
    const apiBaseUrl = getSafrapayApiBaseUrl();
    if (!apiBaseUrl) {
      return NextResponse.json(
        { error: "SAFRAPAY_MOBILE_API_URL nao configurada" },
        { status: 500 }
      );
    }

    const body = (await request.json()) as IncomingSafrapayBody;
    const { error, payload, type } = buildExternalPayload(body);

    if (error || !payload || !type) {
      return NextResponse.json({ error: error || "Tipo de pagamento invalido" }, { status: 400 });
    }

    const endpoint = type === "pix" ? "/v1/payments/pix" : "/v1/payments/card";
    const response = await fetch(`${apiBaseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const data = await readApiResponse(response);
    if (!response.ok) {
      if (type === "card" && response.status === 402) {
        return NextResponse.json(normalizeSuccessResponse(type, data), { status: 200 });
      }

      return NextResponse.json(
        {
          error: getString(data.error) || getString(data.message) || "Erro ao processar pagamento Safrapay",
          details: data.details,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(normalizeSuccessResponse(type, data), { status: 200 });
  } catch (error) {
    console.error("Erro ao chamar safrapay_mobile_api:", error);
    return NextResponse.json(
      { error: "Erro interno ao processar pagamento Safrapay" },
      { status: 500 }
    );
  }
}
