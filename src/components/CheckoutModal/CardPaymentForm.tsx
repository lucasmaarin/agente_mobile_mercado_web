import React, { useState, useEffect } from "react";
import { CreditCard, Eye, EyeOff } from "lucide-react";
import styles from "./CardPaymentForm.module.css";

interface CardPaymentFormProps {
  onCardDataChange?: (cardData: CardData) => void;
  loading?: boolean;
  error?: string;
}

export interface CardData {
  cardNumber: string;
  cardholderName: string;
  expirationMonth: number;
  expirationYear: number;
  cvv: string;
  installments: number;
}

export const CardPaymentForm: React.FC<CardPaymentFormProps> = ({
  onCardDataChange,
  loading = false,
  error,
}) => {
  const [cardData, setCardData] = useState<CardData>({
    cardNumber: "",
    cardholderName: "",
    expirationMonth: 1,
    expirationYear: new Date().getFullYear(),
    cvv: "",
    installments: 1,
  });

  const [showCVV, setShowCVV] = useState(false);
  const [expiryInput, setExpiryInput] = useState("");

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 16) value = value.slice(0, 16);

    // Formatar com espaços a cada 4 dígitos
    const formatted = value.replace(/(\d{4})/g, "$1 ").trim();

    const newData = { ...cardData, cardNumber: value };
    setCardData(newData);
    onCardDataChange?.(newData);
  };

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Pega o valor digitado como está
    const inputValue = e.target.value;
    
    // Atualiza o state de input (permite digitação livre)
    setExpiryInput(inputValue);
    
    // Remove tudo que não é número para processar
    let value = inputValue.replace(/\D/g, "");
    
    // Limita a 4 dígitos (MMAA)
    if (value.length > 4) value = value.slice(0, 4);

    let month = cardData.expirationMonth;
    let year = cardData.expirationYear;

    // Se tem apenas 1 dígito, pode ser início do mês
    if (value.length === 1) {
      month = Math.max(1, Math.min(9, parseInt(value, 10)));
    }
    // Se tem 2 dígitos, é o mês completo
    else if (value.length === 2) {
      month = Math.max(1, Math.min(12, parseInt(value.slice(0, 2), 10)));
    }
    // Se tem 3 dígitos, mês + início do ano
    else if (value.length === 3) {
      month = Math.max(1, Math.min(12, parseInt(value.slice(0, 2), 10)));
      year = 2000 + parseInt(value.slice(2, 3), 10);
    }
    // Se tem 4 dígitos, mês + ano completo
    else if (value.length === 4) {
      month = Math.max(1, Math.min(12, parseInt(value.slice(0, 2), 10)));
      year = 2000 + parseInt(value.slice(2, 4), 10);
    }

    const newData = { ...cardData, expirationMonth: month, expirationYear: year };
    setCardData(newData);
    onCardDataChange?.(newData);
  };

  const handleCVVChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 4) value = value.slice(0, 4);

    const newData = { ...cardData, cvv: value };
    setCardData(newData);
    onCardDataChange?.(newData);
  };

  const handleCardholderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().slice(0, 26);

    const newData = { ...cardData, cardholderName: value };
    setCardData(newData);
    onCardDataChange?.(newData);
  };

  const handleInstallmentsChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = parseInt(e.target.value, 10);

    const newData = { ...cardData, installments: value };
    setCardData(newData);
    onCardDataChange?.(newData);
  };

  const handleExpiryBlur = () => {
    // Formata o input quando o usuário sai do campo
    const formatted = `${cardData.expirationMonth
      .toString()
      .padStart(2, "0")}/${cardData.expirationYear.toString().slice(-2)}`;
    setExpiryInput(formatted);
  };

  const isCardValid =
    cardData.cardNumber.length === 16 &&
    cardData.cardholderName.length > 0 &&
    cardData.cvv.length >= 3;

  return (
    <div className={styles.container}>
      {error && (
        <div className={styles.error}>
          <p>{error}</p>
        </div>
      )}

      <div className={styles.cardPreview}>
        <div className={styles.cardFront}>
          <div className={styles.cardChip}>
            <CreditCard size={32} />
          </div>
          <div className={styles.cardNumber}>
            {cardData.cardNumber
              ? cardData.cardNumber
                  .replace(/(\d{4})/g, "$1 ")
                  .trim()
                  .replace(/./g, (c, i) =>
                    i < cardData.cardNumber.length - 4 && c !== " " ? "•" : c
                  )
              : "•••• •••• •••• ••••"}
          </div>
          <div className={styles.cardInfo}>
            <div>
              <p className={styles.label}>Titular</p>
              <p className={styles.value}>
                {cardData.cardholderName || "SEU NOME"}
              </p>
            </div>
            <div>
              <p className={styles.label}>Vencimento</p>
              <p className={styles.value}>
                {cardData.expirationMonth.toString().padStart(2, "0")}/
                {cardData.expirationYear.toString().slice(-2)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.form}>
        <div className={styles.field}>
          <label>Número do Cartão</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="0000 0000 0000 0000"
            value={
              cardData.cardNumber
                ? cardData.cardNumber
                    .replace(/(\d{4})/g, "$1 ")
                    .trim()
                : ""
            }
            onChange={handleCardNumberChange}
            disabled={loading}
            maxLength={19}
          />
        </div>

        <div className={styles.field}>
          <label>Nome do Titular</label>
          <input
            type="text"
            placeholder="NOME COMPLETO"
            value={cardData.cardholderName}
            onChange={handleCardholderChange}
            disabled={loading}
          />
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label>Vencimento</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="MM/AA"
              value={expiryInput}
              onChange={handleExpiryChange}
              onBlur={handleExpiryBlur}
              disabled={loading}
              maxLength={5}
              autoComplete="cc-exp"
            />
          </div>

          <div className={styles.field}>
            <label>CVV</label>
            <div className={styles.cvvContainer}>
              <input
                type={showCVV ? "text" : "password"}
                inputMode="numeric"
                placeholder="000"
                value={cardData.cvv}
                onChange={handleCVVChange}
                disabled={loading}
                maxLength={4}
              />
              <button
                type="button"
                className={styles.cvvToggle}
                onClick={() => setShowCVV(!showCVV)}
                disabled={loading}
              >
                {showCVV ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>

        <div className={styles.field}>
          <label>Parcelamento</label>
          <select
            value={cardData.installments}
            onChange={handleInstallmentsChange}
            disabled={loading}
          >
            {[1, 2, 3, 6, 12].map((num) => (
              <option key={num} value={num}>
                {num}x sem juros
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.security}>
        <p>🔒 Seus dados são protegidos com criptografia de segurança.</p>
      </div>
    </div>
  );
};
