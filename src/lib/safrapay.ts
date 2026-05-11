/**
 * Integração com API Safrapay
 * Documentação: https://safrapay.com.br/docs
 */

const SAFRAPAY_ENV = process.env.SAFRAPAY_ENV || 'hml';
const SAFRAPAY_MERCHANT_ID = process.env.SAFRAPAY_MERCHANT_ID;
const SAFRAPAY_MERCHANT_TOKEN = process.env.SAFRAPAY_MERCHANT_TOKEN || process.env.SAFRAPAY_ACCESS_TOKEN;

// Endpoints
const ENDPOINTS = {
  hml: {
    gateway: 'https://payment-hml.safrapay.com.br',
    portal: 'https://portal-api-hml.safrapay.com.br',
  },
  prod: {
    gateway: 'https://payment.safrapay.com.br',
    portal: 'https://portal-api.safrapay.com.br',
  },
};

const ENDPOINT_GATEWAY =
  process.env.SAFRAPAY_GATEWAY_URL ||
  ENDPOINTS[SAFRAPAY_ENV as keyof typeof ENDPOINTS]?.gateway ||
  ENDPOINTS.hml.gateway;

/**
 * Tipos de Pagamento Safrapay
 */
export enum SafrapayPaymentType {
  Debit = 1,
  Credit = 2,
  Voucher = 3,
  Boleto = 4,
  Ted = 5,
  Doc = 6,
  SafetyPay = 7,
  Pix = 8,
}

/**
 * Tipo de Parcelamento
 */
export enum SafrapayInstallmentType {
  None = 0,
  Merchant = 1,
  Issuer = 2,
}

/**
 * Status da Transação
 */
export enum SafrapayTransactionStatus {
  PreAuthorized = 1,
  Captured = 2,
  Denied = 3,
  Pending = 4,
  Canceled = 5,
  PendingCancel = 6,
  PendingPayment = 7,
  Paid = 8,
  ErrorCreation = 9,
  Expired = 10,
  PendingNewDeadline = 11,
  Timeout = 12,
}

/**
 * Interface para dados de pagamento com PIX
 */
export interface SafrapayPixPaymentRequest {
  amount: number;
  orderId: string;
  customer: SafrapayCustomer;
  description?: string;
  notificationUrl?: string;
}

/**
 * Interface para dados de pagamento com Cartão
 */
export interface SafrapayCardPaymentRequest {
  amount: number;
  paymentType?: SafrapayPaymentType.Credit | SafrapayPaymentType.Debit;
  cardNumber: string;
  cardholderName: string;
  cardholderDocument: string;
  expirationMonth: number;
  expirationYear: number;
  cvv: string;
  installments?: number;
  installmentType?: SafrapayInstallmentType;
  customer: SafrapayCustomer;
  orderId: string;
  description?: string;
  notificationUrl?: string;
}

export interface SafrapayCustomer {
  name: string;
  email: string;
  document: string;
  documentType?: number;
  phone: {
    countryCode: string;
    areaCode: string;
    number: string;
    type?: number;
  };
}

/**
 * Resposta padrão da API Safrapay
 */
export interface SafrapayResponse<T = any> {
  traceKey: string;
  success: boolean;
  charge?: T;
  data?: T;
  errors?: Array<{
    errorCode: number;
    message: string;
    field?: string;
  }>;
}

interface SafrapayAuthCache {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

let authCache: SafrapayAuthCache | null = null;

/**
 * Dados de resposta de uma transação PIX
 */
export interface SafrapayPixResponse {
  chargeId: string;
  transactionId: string;
  qrCode: string;
  qrCodeBase64?: string;
  copyPasteKey: string;
  expiresAt?: string;
  status: SafrapayTransactionStatus | string;
}

/**
 * Dados de resposta de uma transação com Cartão
 */
export interface SafrapayCardResponse {
  chargeId: string;
  transactionId: string;
  status: SafrapayTransactionStatus | string;
  authorizationCode?: string;
  responseCode?: string;
  responseMessage?: string;
}

function detectCardBrand(cardNumber: string): number {
  const digits = cardNumber.replace(/\D/g, "");
  if (/^4/.test(digits)) return 1;
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 2;
  if (/^3[47]/.test(digits)) return 3;
  if (/^(4011|4312|4389|4514|4576|5041|5067|509|6277|6362|6363|650|6516|6550)/.test(digits)) return 4;
  if (/^(38|60)/.test(digits)) return 9;
  return 2;
}

/**
 * Classe para gerenciar operações com Safrapay
 */
export class SafrapayClient {
  private merchantId: string;
  private merchantToken: string;
  private endpoint: string;

  constructor(merchantId?: string, merchantToken?: string, endpoint?: string) {
    this.merchantId = merchantId || SAFRAPAY_MERCHANT_ID || '';
    this.merchantToken = merchantToken || SAFRAPAY_MERCHANT_TOKEN || '';
    this.endpoint = endpoint || ENDPOINT_GATEWAY;

    if (!this.merchantId || !this.merchantToken) {
      console.warn('Safrapay credentials not configured');
    }
  }

  private async authenticate(): Promise<string> {
    if (authCache && authCache.expiresAt > Date.now() + 60_000) {
      return authCache.accessToken;
    }

    if (this.merchantToken.trim() === this.merchantId.trim()) {
      throw new Error(
        'Safrapay Auth Error: SAFRAPAY_MERCHANT_TOKEN esta igual ao SAFRAPAY_MERCHANT_ID. ' +
        'Configure o Merchant Token real fornecido pela Safrapay.'
      );
    }

    const response = await fetch(`${this.endpoint}/v2/merchant/auth`, {
      method: 'POST',
      headers: {
        Authorization: this.merchantToken.trim(),
      },
    });

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      const fallbackMessage =
        response.status === 401
          ? 'Credenciais Safrapay recusadas. Verifique o Merchant Token e o ambiente configurado.'
          : `Resposta invalida da Safrapay (${response.status}).`;
      console.error('Safrapay Auth Response Parse Error:', {
        status: response.status,
        statusText: response.statusText,
        parseError,
      });
      throw new Error(`Safrapay Auth Error: ${fallbackMessage}`);
    }

    if (!response.ok || !data.success || !data.accessToken) {
      throw new Error(`Safrapay Auth Error: ${data.errors?.[0]?.message || response.statusText}`);
    }

    authCache = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + 29 * 60 * 1000,
    };

    return data.accessToken;
  }

  /**
   * Headers padrão para requisições
   */
  private async getHeaders(): Promise<HeadersInit> {
    const accessToken = await this.authenticate();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    };
  }

  /**
   * Fazer requisição para API Safrapay
   */
  private async request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<SafrapayResponse<T>> {
    const url = `${this.endpoint}${path}`;
    
    try {
      const response = await fetch(url, {
        method,
        headers: await this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });

      try {
        const data = await response.json();

        if (!response.ok) {
          console.error('Safrapay API Error Response:', {
            url,
            status: response.status,
            statusText: response.statusText,
            errors: data?.errors,
            traceKey: data?.traceKey,
          });

          const apiMessage =
            data?.errors?.[0]?.message ||
            data?.message ||
            response.statusText ||
            'Erro desconhecido';

          throw new Error(`Safrapay Error (${response.status}): ${apiMessage}`);
        }

        return data;
      } catch (parseError) {
        if (
          parseError instanceof Error &&
          parseError.message.startsWith('Safrapay Error')
        ) {
          throw parseError;
        }

        console.error('Safrapay Response Parse Error:', {
          url,
          status: response.status,
          parseError,
        });
        throw new Error(`Resposta inválida da Safrapay (${response.status})`);
      }
    } catch (error) {
      console.error('Safrapay API Error:', error);
      throw error;
    }
  }

  /**
   * Criar cobrança com PIX
   */
  async createPixCharge(request: SafrapayPixPaymentRequest): Promise<SafrapayPixResponse> {
    const payload = {
      charge: {
        merchantChargeId: request.orderId,
        customer: {
          ...request.customer,
          documentType: request.customer.documentType ?? 1,
          phone: {
            ...request.customer.phone,
            type: request.customer.phone.type ?? 5,
          },
        },
        transactions: [{ amount: request.amount }],
        metadata: request.description
          ? [{ key: "description", value: request.description }]
          : undefined,
        source: 1,
      },
    };

    const response = await this.request<any>(
      'POST',
      '/v2/charge/pix',
      payload
    );

    if (!response.success) {
      throw new Error(`Safrapay Error: ${response.errors?.[0]?.message || 'Unknown error'}`);
    }

    const charge = response.charge;
    const transaction = charge?.transactions?.[0];

    return {
      chargeId: charge?.id,
      transactionId: transaction?.transactionId,
      qrCode: transaction?.qrCode,
      qrCodeBase64: transaction?.qrCodeBase64,
      copyPasteKey: transaction?.qrCode,
      status: transaction?.transactionStatus,
    };
  }

  /**
   * Criar cobrança com Cartão
   */
  async createCardCharge(request: SafrapayCardPaymentRequest): Promise<SafrapayCardResponse> {
    const payload = {
      remoteIp: "203.0.113.45",
      charge: {
        merchantChargeId: request.orderId,
        customer: {
          ...request.customer,
          documentType: request.customer.documentType ?? 1,
          phone: {
            ...request.customer.phone,
            type: request.customer.phone.type ?? 5,
          },
        },
        transactions: [
          {
            card: {
              cardNumber: request.cardNumber,
              cvv: request.cvv,
              brand: detectCardBrand(request.cardNumber),
              cardholderName: request.cardholderName,
              cardholderDocument: request.cardholderDocument,
              expirationMonth: request.expirationMonth,
              expirationYear: request.expirationYear,
            },
            paymentType: request.paymentType || SafrapayPaymentType.Credit,
            amount: request.amount,
            installmentNumber: request.installments || 1,
            installmentType: request.installmentType || SafrapayInstallmentType.None,
            merchantTransactionId: request.orderId,
          },
        ],
        source: 1,
      },
      capture: true,
    };

    const response = await this.request<any>(
      'POST',
      '/v2/charge/authorization',
      payload
    );

    if (!response.success) {
      throw new Error(`Safrapay Error: ${response.errors?.[0]?.message || 'Unknown error'}`);
    }

    const charge = response.charge;
    const transaction = charge?.transactions?.[0];

    return {
      chargeId: charge?.id,
      transactionId: transaction?.transactionId,
      status: transaction?.transactionStatus,
      authorizationCode: transaction?.authorizationCode,
      responseCode: transaction?.authorizationResponseCode,
      responseMessage: transaction?.isApproved ? 'Transação aprovada' : 'Transação não aprovada',
    };
  }

  /**
   * Obter status de uma cobrança
   */
  async getChargeStatus(chargeId: string): Promise<any> {
    const response = await this.request<any>(
      'GET',
      `/v2/charge/${chargeId}`,
      undefined
    );

    if (!response.success) {
      throw new Error(`Safrapay Error: ${response.errors?.[0]?.message || 'Unknown error'}`);
    }

    return response.data;
  }

  /**
   * Cancelar uma cobrança
   */
  async cancelCharge(chargeId: string): Promise<any> {
    const response = await this.request<any>(
      'DELETE',
      `/v2/charge/${chargeId}`,
      undefined
    );

    if (!response.success) {
      throw new Error(`Safrapay Error: ${response.errors?.[0]?.message || 'Unknown error'}`);
    }

    return response.data;
  }
}

/**
 * Instância padrão do cliente Safrapay
 */
export const safrapayClient = new SafrapayClient();
