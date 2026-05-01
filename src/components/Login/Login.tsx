// components/pages/Login.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import styles from "./Login.module.css";
import Image from "next/image";
import { useRouter } from "next/navigation";
import '@/app/globals.css';
import { validatePhone } from '@/lib/validation';
import {
  signInWithPopup,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  ConfirmationResult,
  onAuthStateChanged
} from 'firebase/auth';
import { auth, googleProvider, appleProvider } from '@/lib/firebase';
import { X } from "lucide-react";

declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier;
  }
}

interface LoginProps {
  redirectTo?: string;
}

const isMobileDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
};

const Login: React.FC<LoginProps> = ({ redirectTo = '/' }) => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [error, setError] = useState("");
  const [showRecaptcha, setShowRecaptcha] = useState(false);
  const router = useRouter();
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const pendingPhoneRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.push(redirectTo);
        return;
      }
      setIsCheckingAuth(false);
    });

    return () => {
      unsubscribe();
      // Limpa o verifier ao desmontar
      if (typeof window !== 'undefined' && window.recaptchaVerifier) {
        try { window.recaptchaVerifier.clear(); } catch (_) {}
        window.recaptchaVerifier = undefined;
      }
    };
  }, [router]);

  const formatPhoneInput = (value: string): string => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const clearRecaptcha = () => {
    if (typeof window !== 'undefined' && window.recaptchaVerifier) {
      try { window.recaptchaVerifier.clear(); } catch (_) {}
      window.recaptchaVerifier = undefined;
    }
  };

  const setupRecaptcha = async (): Promise<RecaptchaVerifier> => {
    clearRecaptcha();

    const mobile = isMobileDevice();

    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: mobile ? 'normal' : 'normal',
      callback: async () => {
        // No mobile, o callback é disparado após o usuário resolver o reCAPTCHA
        // Aí enviamos o SMS com o número que estava pendente
        if (mobile && pendingPhoneRef.current) {
          await sendSms(pendingPhoneRef.current, verifier);
        }
      },
      'expired-callback': () => {
        clearRecaptcha();
        setShowRecaptcha(false);
        setIsLoading(false);
        setError("reCAPTCHA expirou. Tente novamente.");
      },
    });

    await verifier.render();
    window.recaptchaVerifier = verifier;
    return verifier;
  };

  const sendSms = async (formattedPhone: string, verifier: RecaptchaVerifier) => {
    try {
      const result = await signInWithPhoneNumber(auth, formattedPhone, verifier);
      setConfirmationResult(result);
      setIsCodeSent(true);
      setIsVerificationModalOpen(true);
      setShowRecaptcha(false);
      setError("");
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'auth/too-many-requests') {
        setError("Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.");
      } else if (code === 'auth/invalid-phone-number') {
        setError("Número de telefone inválido. Confira o DDD e os dígitos.");
      } else if (code === 'auth/quota-exceeded') {
        setError("Limite de SMS atingido. Tente novamente mais tarde.");
      } else {
        setError("Não foi possível enviar o SMS. Verifique sua conexão e tente novamente.");
      }
      clearRecaptcha();
      setShowRecaptcha(false);
    } finally {
      setIsLoading(false);
      pendingPhoneRef.current = null;
    }
  };

  const handlePhoneLogin = async () => {
    if (!phoneNumber.trim()) return;

    setIsLoading(true);
    setError("");

    const formattedPhone = validatePhone(phoneNumber);
    if (!formattedPhone) {
      setError("Número inválido. Digite o DDD + número, ex: (11) 99999-9999.");
      setIsLoading(false);
      return;
    }

    try {
      const mobile = isMobileDevice();
      const verifier = await setupRecaptcha();

      if (mobile) {
        // No mobile: guarda o número e mostra o reCAPTCHA para o usuário resolver
        // O envio do SMS acontece no callback do reCAPTCHA
        pendingPhoneRef.current = formattedPhone;
        setShowRecaptcha(true);
        // isLoading continua true até o callback resolver
      } else {
        // No desktop: fluxo invisível normal
        await sendSms(formattedPhone, verifier);
      }
    } catch (error: unknown) {
      setError("Não foi possível enviar o SMS. Verifique sua conexão e tente novamente.");
      clearRecaptcha();
      setShowRecaptcha(false);
      setIsLoading(false);
    }
  };

  const verifyPhoneCode = async () => {
    if (!confirmationResult || !verificationCode.trim()) return;

    setIsLoading(true);
    setError("");

    try {
      await confirmationResult.confirm(verificationCode);
      setIsVerificationModalOpen(false);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'auth/invalid-verification-code') {
        setError("Código incorreto. Verifique o SMS e tente novamente.");
      } else if (code === 'auth/code-expired') {
        setError("Código expirado. Solicite um novo código.");
      } else {
        setError("Não foi possível verificar o código. Tente novamente.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code !== 'auth/popup-closed-by-user') {
        setError("Não foi possível entrar com o Google. Tente novamente.");
      }
      setIsLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    setIsLoading(true);
    try {
      await signInWithPopup(auth, appleProvider);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code !== 'auth/popup-closed-by-user') {
        setError("Não foi possível entrar com a Apple. Tente novamente.");
      }
      setIsLoading(false);
    }
  };

  const resetPhoneLogin = () => {
    setIsCodeSent(false);
    setConfirmationResult(null);
    setVerificationCode("");
    setIsVerificationModalOpen(false);
    setShowRecaptcha(false);
    pendingPhoneRef.current = null;
    clearRecaptcha();
  };

  const closeModal = () => {
    if (!isLoading) {
      resetPhoneLogin();
    }
  };

  const handleModalKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && verificationCode.trim() && !isLoading) {
      verifyPhoneCode();
    }
  };

  if (isCheckingAuth) {
    return (
      <div className={styles.login}>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          flexDirection: 'column',
          gap: '20px'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '4px solid #f3f3f3',
            borderTop: '4px solid #3498db',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
        </div>
        <style jsx>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className={styles.login}>

      {/* Header simples com logo */}
      <div className={styles.loginHeader}>
        <Image src="/logo.png" alt="Agente Móbile" width={48} height={48} />
        <span className={styles.loginHeaderTitle}>Agente Móbile</span>
      </div>

      <div className={styles.contentWrapper}>
        <div className={styles.loginOptions}>
          <h1>Use o seu e-mail ou telefone para iniciar sessão</h1>

          {error && !isVerificationModalOpen && (
            <div className={styles.errorMessage}>
              {error}
            </div>
          )}

          <div className={styles.loginCard}>
            <div className={styles.phoneSection}>
              <label htmlFor="phone" className={styles.label}>
                Número de telefone
              </label>
              <div className={styles.phoneInputContainer}>
                <input
                  id="phone"
                  type="tel"
                  placeholder="(11) 99999-9999"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(formatPhoneInput(e.target.value))}
                  className={styles.phoneInput}
                  disabled={isLoading}
                />
                <button
                  onClick={handlePhoneLogin}
                  className={styles.phoneButton}
                  disabled={!phoneNumber.trim() || isLoading || showRecaptcha}
                >
                  {isLoading && !showRecaptcha ? "Enviando..." : "Continuar"}
                </button>
              </div>
            </div>

            {/* reCAPTCHA — invisível no desktop, checkbox no mobile */}
            <div
              id="recaptcha-container"
              style={{
                display: showRecaptcha ? 'flex' : 'none',
                justifyContent: 'center',
                margin: '12px 0',
              }}
            />

            {showRecaptcha && (
              <p style={{ textAlign: 'center', fontSize: '13px', color: '#666', marginTop: '8px' }}>
                Complete a verificação acima para receber o SMS
              </p>
            )}

            <div className={styles.divider}>
              <span className={styles.dividerText}>ou</span>
            </div>

            <div className={styles.socialButtons}>
              <button
                onClick={handleGoogleLogin}
                className={styles.googleButton}
                disabled={isLoading}
              >
                <div className={styles.googleIcon}>
                  <Image src="/google.png" alt="Google" width={20} height={20} />
                </div>
                {isLoading ? "Carregando..." : "Continuar com Google"}
              </button>

              <button
                onClick={handleAppleLogin}
                className={styles.appleButton}
                disabled={isLoading}
              >
                <div className={styles.appleIcon}>
                  <Image src="/apple.png" alt="Apple" width={20} height={20} />
                </div>
                {isLoading ? "Carregando..." : "Continuar com Apple"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Verificação */}
      {isVerificationModalOpen && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Verificação de Telefone</h2>
              <button
                className={styles.closeButton}
                onClick={closeModal}
                disabled={isLoading}
                aria-label="Fechar modal"
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <p className={styles.modalDescription}>
                Digite o código de verificação de 6 dígitos enviado para:
              </p>
              <p className={styles.phoneDisplay}>{phoneNumber}</p>

              {error && (
                <div className={styles.modalError}>{error}</div>
              )}

              <input
                type="text"
                placeholder="123456"
                value={verificationCode}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setVerificationCode(value);
                }}
                onKeyPress={handleModalKeyPress}
                maxLength={6}
                disabled={isLoading}
                className={styles.verificationInput}
                autoFocus
              />
            </div>

            <div className={styles.modalActions}>
              <button
                onClick={verifyPhoneCode}
                disabled={verificationCode.length !== 6 || isLoading}
                className={styles.confirmButton}
              >
                {isLoading ? "Verificando..." : "Confirmar"}
              </button>
              <button
                onClick={closeModal}
                className={styles.cancelButton}
                disabled={isLoading}
              >
                Cancelar
              </button>
            </div>

            <div className={styles.modalFooter}>
              <button
                onClick={resetPhoneLogin}
                className={styles.resendButton}
                disabled={isLoading}
              >
                Reenviar código
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.footer}>
        <p className={styles.footerText}>
          Ao continuar, você aceita nossos{" "}
          <a href="#" className={styles.link}>Termos de Uso</a> e{" "}
          <a href="https://www.mobilemercado.com.br/declaracao-de-privacidade" className={styles.link} target="_blank" rel="noopener noreferrer">Política de Privacidade</a>
        </p>
      </div>
    </div>
  );
};

export default Login;