"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  signInWithPhoneNumber,
  RecaptchaVerifier,
  ConfirmationResult,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { validatePhone } from "@/lib/validation";
import styles from "./PhoneAuthInline.module.css";

declare global {
  interface Window {
    recaptchaVerifierInline?: RecaptchaVerifier;
  }
}

interface PhoneAuthInlineProps {
  logoUrl?: string;
  storeName?: string;
}

type Step = "phone" | "validating" | "code_modal";

const BOT_MESSAGES = [
  "Olá! 👋 Bem-vindo(a)!",
  "Para continuar, preciso que você faça login. Informe seu número de telefone com DDD:",
];

// logoUrl/storeName aceitos para compatibilidade — Header da loja já fica visível acima
const PhoneAuthInline: React.FC<PhoneAuthInlineProps> = () => {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [codeError, setCodeError] = useState("");
  const [keepLogged, setKeepLogged] = useState(true);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [visibleMessages, setVisibleMessages] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Anima a entrada das mensagens do agente
  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisibleMessages(i);
      if (i >= BOT_MESSAGES.length) clearInterval(interval);
    }, 700);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (visibleMessages >= BOT_MESSAGES.length) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visibleMessages]);

  useEffect(() => {
    return () => {
      if (window.recaptchaVerifierInline) {
        window.recaptchaVerifierInline.clear();
        window.recaptchaVerifierInline = undefined;
      }
    };
  }, []);

  const formatPhone = (value: string) => {
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  const setupRecaptcha = (): RecaptchaVerifier => {
    if (window.recaptchaVerifierInline) return window.recaptchaVerifierInline;
    const verifier = new RecaptchaVerifier(auth, "recaptcha-inline", {
      size: "invisible",
      callback: () => {},
    });
    window.recaptchaVerifierInline = verifier;
    return verifier;
  };

  const smsErrorMessage = (code?: string): string => {
    switch (code) {
      case "auth/too-many-requests":        return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
      case "auth/invalid-phone-number":     return "Número de telefone inválido. Confira o DDD e os dígitos.";
      case "auth/quota-exceeded":           return "Limite de SMS atingido. Tente novamente mais tarde.";
      case "auth/captcha-check-failed":     return "Verificação de segurança falhou. Recarregue a página e tente novamente.";
      case "auth/missing-phone-number":     return "Informe um número de telefone antes de continuar.";
      case "auth/user-disabled":            return "Esta conta foi desativada. Entre em contato com o suporte.";
      case "auth/operation-not-allowed":    return "Login por SMS não está habilitado. Entre em contato com o suporte.";
      default:                              return "Não foi possível enviar o SMS. Verifique sua conexão e tente novamente.";
    }
  };

  const codeErrorMessage = (code?: string): string => {
    switch (code) {
      case "auth/invalid-verification-code": return "Código incorreto. Verifique o SMS e tente novamente.";
      case "auth/code-expired":              return "Código expirado. Clique em \"Reenviar código\" para receber um novo.";
      case "auth/missing-verification-code": return "Digite o código de 6 dígitos recebido por SMS.";
      case "auth/session-expired":           return "Sessão expirada. Solicite um novo código.";
      default:                               return "Não foi possível verificar o código. Tente novamente.";
    }
  };

  const handleSendCode = async () => {
    const formatted = validatePhone(phone);
    if (!formatted) {
      setPhoneError("Número inválido. Use o formato: (11) 99999-9999");
      return;
    }
    setPhoneError("");
    setLoading(true);
    setStep("validating");
    try {
      const persistence = keepLogged ? browserLocalPersistence : browserSessionPersistence;
      await setPersistence(auth, persistence);
      const verifier = setupRecaptcha();
      const result = await signInWithPhoneNumber(auth, formatted, verifier);
      setConfirmation(result);
      setStep("code_modal");
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      console.error("[PhoneAuth] Erro ao enviar SMS:", err.code, err.message, e);
      setPhoneError(smsErrorMessage(err.code));
      setStep("phone");
      if (window.recaptchaVerifierInline) {
        window.recaptchaVerifierInline.clear();
        window.recaptchaVerifierInline = undefined;
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!confirmation || code.length !== 6 || !acceptTerms) return;
    setLoading(true);
    setCodeError("");
    try {
      await confirmation.confirm(code);
      // onAuthStateChanged em page.tsx detecta o login e continua o fluxo
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      console.error("[PhoneAuth] Erro ao verificar código:", err.code, err.message, e);
      setCodeError(codeErrorMessage(err.code));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setCode("");
    setCodeError("");
    setStep("phone");
    setConfirmation(null);
    if (window.recaptchaVerifierInline) {
      window.recaptchaVerifierInline.clear();
      window.recaptchaVerifierInline = undefined;
    }
  };

  return (
    <>
      <div id="recaptcha-inline" style={{ position: 'fixed', bottom: 160, left: 0, zIndex: 9999 }} />
    <div className={styles.wrapper}>

      {/* Área de mensagens — ocupa espaço abaixo do Header da loja */}
      <div className={styles.messagesArea}>
        {BOT_MESSAGES.slice(0, visibleMessages).map((msg, i) => (
          <div key={i} className={styles.agentBubble}>{msg}</div>
        ))}

        {step === "validating" && (
          <div className={styles.agentBubble}>
            <span className={styles.typing}>Enviando SMS para <strong>{phone}</strong>…</span>
          </div>
        )}

        {(step === "phone" || step === "validating") && visibleMessages >= BOT_MESSAGES.length && (
          <div className={styles.userInputArea}>
            {phoneError && <p className={styles.inputError}>{phoneError}</p>}
            <div className={styles.inputRow}>
              <input
                ref={inputRef}
                type="tel"
                placeholder="(11) 99999-9999"
                value={phone}
                onChange={(e) => { setPhone(formatPhone(e.target.value)); setPhoneError(""); }}
                className={styles.phoneInput}
                disabled={loading || step === "validating"}
                onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
              />
              <button
                className={styles.sendBtn}
                onClick={handleSendCode}
                disabled={!phone.trim() || loading || step === "validating"}
              >
                {loading ? "…" : "→"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de verificação SMS */}
      {step === "code_modal" && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalIcon}>🔐</div>
            <h3 className={styles.modalTitle}>Verifique seu número</h3>
            <p className={styles.modalSub}>
              Código enviado para <strong>{phone}</strong>
            </p>

            <input
              type="text"
              inputMode="numeric"
              placeholder="000000"
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setCodeError(""); }}
              className={styles.codeInput}
              disabled={loading}
              onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
              autoFocus
              maxLength={6}
            />

            {codeError && <p className={styles.codeError}>{codeError}</p>}

            <div className={styles.checkboxGroup}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={keepLogged}
                  onChange={(e) => setKeepLogged(e.target.checked)}
                  className={styles.checkbox}
                />
                Continuar logado
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  className={styles.checkbox}
                />
                Li e aceito os{" "}
                <a href="#" className={styles.termsLink} target="_blank" rel="noopener">
                  Termos de Uso
                </a>{" "}
                e a{" "}
                <a href="https://www.mobilemercado.com.br/declaracao-de-privacidade" className={styles.termsLink} target="_blank" rel="noopener noreferrer">
                  Política de Privacidade
                </a>
              </label>
            </div>

            <button
              className={styles.confirmBtn}
              onClick={handleVerifyCode}
              disabled={code.length !== 6 || !acceptTerms || loading}
            >
              {loading ? "Verificando…" : "Confirmar"}
            </button>

            <button className={styles.resendBtn} onClick={handleResend} disabled={loading}>
              Reenviar código
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
};

export default PhoneAuthInline;
