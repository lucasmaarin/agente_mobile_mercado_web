/**
 * Serviço para processar pagamentos com Safrapay
 */

import type { CardData } from "@/components/CheckoutModal/CardPaymentForm";

export interface SafrapayPaymentRequest {
  type: "pix" | "card";
  amount: number;
  orderId: string;
  description: string;
  customerName: string;
  cardData?: CardData;
}

export interface SafrapayPaymentResponse {
  success: boolean;
  type: "pix" | "card";
  transactionId: string;
  chargeId: string;
  orderStatus: string;
  qrCode?: string;
  qrCodeUrl?: string;
  copyPasteKey?: string;
  authorizationCode?: string;
  error?: string;
}

/**
 * Processar pagamento via Safrapay
 */
export async function processSafrapayPayment(
  request: SafrapayPaymentRequest
): Promise<SafrapayPaymentResponse> {
  const payload =
    request.type === "pix"
      ? {
          type: "pix",
          amount: request.amount,
          orderId: request.orderId,
          description: request.description,
          customerName: request.customerName,
        }
      : {
          type: "card",
          amount: request.amount,
          orderId: request.orderId,
          description: request.description,
          customerName: request.customerName,
          cardNumber: request.cardData?.cardNumber,
          cardholderName: request.cardData?.cardholderName,
          expirationMonth: request.cardData?.expirationMonth,
          expirationYear: request.cardData?.expirationYear,
          cvv: request.cardData?.cvv,
          installments: request.cardData?.installments,
        };

  const response = await fetch("/api/payment/safrapay", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Erro ao processar pagamento");
  }

  return response.json();
}

/**
 * Criar ordem após confirmação de pagamento
 */
export async function createOrderAfterPayment(
  orderId: string,
  paymentData: SafrapayPaymentResponse,
  companyId: string,
  userDocId: string,
  orderData: any
) {
  // Atualizar status do pedido com dados de pagamento
  const enhancedOrderData = {
    ...orderData,
    paymentStatus: paymentData.orderStatus,
    paymentTransactionId: paymentData.transactionId,
    paymentChargeId: paymentData.chargeId,
    paymentMethod: paymentData.type === "pix" ? "PIX" : "Cartão",
  };

  // Aqui você faria uma chamada para atualizar o pedido no Firestore
  // com os dados de pagamento do Safrapay
  return enhancedOrderData;
}
