import React, { useState, useEffect } from "react";
import { QrCode, Copy, Check } from "lucide-react";
import styles from "./PIXPaymentForm.module.css";

function isQrImage(value: string) {
  return value.startsWith("data:image/") || value.startsWith("http://") || value.startsWith("https://");
}

export interface PixPaymentData {
  qrCode: string;
  qrCodeUrl?: string;
  copyPasteKey: string;
  transactionId?: string;
  chargeId?: string;
  expiresAt?: string;
}

interface PIXPaymentFormProps {
  total: number;
  nomeCliente: string;
  customerDocument: string;
  orderId: string;
  description: string;
  safrapayConfig?: { enabled: boolean; environment?: "hml" | "prod" };
  onQRCodeGenerated?: (data: PixPaymentData) => void;
  loading?: boolean;
  error?: string;
}

export const PIXPaymentForm: React.FC<PIXPaymentFormProps> = ({
  total,
  nomeCliente,
  customerDocument,
  orderId,
  description,
  safrapayConfig,
  onQRCodeGenerated,
  loading = false,
  error,
}) => {
  const [qrCode, setQrCode] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [copyPasteKey, setCopyPasteKey] = useState("");
  const [copiedExpiresAt, setCopiedExpiresAt] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [internalError, setInternalError] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || !safrapayConfig?.enabled) return;
    if (customerDocument.replace(/\D/g, "").length !== 11) return;

    let cancelled = false;

    async function generatePix() {
      setGenerating(true);
      setInternalError("");
      setInitialized(true);

      try {
        const response = await fetch("/api/payment/safrapay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "pix",
            amount: Math.round(total * 100),
            orderId,
            description,
            customerName: nomeCliente,
            customerDocument: customerDocument.replace(/\D/g, ""),
            safrapayConfig,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Erro ao gerar PIX");
        }

        if (cancelled) return;
        const pixData = {
          qrCode: data.qrCode || "",
          qrCodeUrl: data.qrCodeUrl,
          copyPasteKey: data.copyPasteKey || "",
          transactionId: data.transactionId,
          chargeId: data.chargeId,
          expiresAt: data.expiresAt,
        };
        setQrCode(pixData.qrCode);
        setQrCodeUrl(pixData.qrCodeUrl || "");
        setCopyPasteKey(pixData.copyPasteKey);
        onQRCodeGenerated?.(pixData);
      } catch (err) {
        if (!cancelled) {
          setInternalError(err instanceof Error ? err.message : "Erro ao gerar PIX");
        }
      } finally {
        if (!cancelled) setGenerating(false);
      }
    }

    generatePix();

    return () => {
      cancelled = true;
    };
  }, [customerDocument, description, initialized, nomeCliente, onQRCodeGenerated, orderId, safrapayConfig, total]);

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(copyPasteKey);
      setCopiedExpiresAt(true);
      setTimeout(() => setCopiedExpiresAt(false), 2000);
    } catch (err) {
      console.error("Erro ao copiar:", err);
    }
  };

  return (
    <div className={styles.container}>
      {(error || internalError) && (
        <div className={styles.error}>
          <p>{error || internalError}</p>
        </div>
      )}

      <div className={styles.section}>
        <h3>Escaneie o QR Code</h3>
        {loading || generating ? (
          <div className={styles.loadingQr}>Gerando QR Code...</div>
        ) : (
          <div className={styles.qrContainer}>
            <div className={styles.qrBox}>
              {isQrImage(qrCodeUrl || qrCode) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrCodeUrl || qrCode} alt="PIX QR Code" />
              ) : (
                <QrCode size={200} strokeWidth={1} />
              )}
            </div>
            <p className={styles.qrHint}>
              Use o aplicativo de seu banco para escanear o codigo acima
            </p>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h3>Ou copie o codigo</h3>
        <div className={styles.copyContainer}>
          <input
            type="text"
            value={copyPasteKey}
            readOnly
            className={styles.copyInput}
            onClick={handleCopyToClipboard}
          />
          <button
            className={styles.copyBtn}
            onClick={handleCopyToClipboard}
            title="Copiar codigo"
            disabled={!copyPasteKey}
          >
            {copiedExpiresAt ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
        {copiedExpiresAt && (
          <p className={styles.copiedMsg}>Copiado para area de transferencia!</p>
        )}
      </div>

      <div className={styles.info}>
        <p>
          <strong>Valor:</strong> R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </p>
        <p>
          <strong>Beneficiario:</strong> {nomeCliente}
        </p>
        <p className={styles.infoHint}>
          Este QR Code expira em 10 minutos. O pagamento sera confirmado automaticamente.
        </p>
      </div>
    </div>
  );
};
