// components/pages/Login.tsx
"use client";

import React, { useState, useEffect } from "react";
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

const Login: React.FC<LoginProps> = ({ redirectTo = '/' }) => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.push(redirectTo);
        return;
      }
      setIsCheckingAuth(false);
    });

    return () => unsubscribe();
  }, [router]);

  const setupRecaptcha = () => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        'size': 'invisible',
        'callback': () => {
          // reCAPTCHA resolvido
        }
      });
    }
  };

  const handlePhoneLogin = async () => {
    if (!phoneNumber.trim()) return;

    setIsLoading(true);
    setError("");

    try {
      setupRecaptcha();
      const appVerifier = window.recaptchaVerifier;

      if (!appVerifier) {
        throw new Error('Erro ao configurar reCAPTCHA');
      }

      const formattedPhone = validatePhone(phoneNumber);
      if (!formattedPhone) {
        setError("Número de telefone inválido. Use o formato (DDD) + número.");
        setIsLoading(false);
        return;
      }

      const result = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);
      setConfirmationResult(result);
      setIsCodeSent(true);
      setIsVerificationModalOpen(true);
      setError("");

    } catch (error: unknown) {
      console.error("Erro ao enviar código:", error);
      setError("Erro ao enviar código de verificação. Verifique o número e tente novamente.");

      if (typeof window !== 'undefined' && window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = undefined;
      }
    } finally {
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
      console.error("Erro na verificação:", error);
      alert("Código de verificação inválido. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: unknown) {
      console.error("Erro no login com Google:", error);
      alert("Erro ao fazer login com Google. Tente novamente.");
      setIsLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    setIsLoading(true);

    try {
      await signInWithPopup(auth, appleProvider);
    } catch (error: unknown) {
      console.error("Erro no login com Apple:", error);
      alert("Erro ao fazer login com Apple. Tente novamente.");
      setIsLoading(false);
    }
  };

  const resetPhoneLogin = () => {
    setIsCodeSent(false);
    setConfirmationResult(null);
    setVerificationCode("");
    setIsVerificationModalOpen(false);

    if (typeof window !== 'undefined' && window.recaptchaVerifier) {
      window.recaptchaVerifier.clear();
      window.recaptchaVerifier = undefined;
    }
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
      <div id="recaptcha-container"></div>

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
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className={styles.phoneInput}
                  disabled={isLoading}
                />
                <button
                  onClick={handlePhoneLogin}
                  className={styles.phoneButton}
                  disabled={!phoneNumber.trim() || isLoading}
                >
                  {isLoading ? "Enviando..." : "Continuar"}
                </button>
              </div>
            </div>

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
                  <Image
                    src="/icons/login/google.png"
                    alt="Google"
                    width={20}
                    height={20}
                  />
                </div>
                {isLoading ? "Carregando..." : "Continuar com Google"}
              </button>

              <button
                onClick={handleAppleLogin}
                className={styles.appleButton}
                disabled={isLoading}
              >
                <div className={styles.appleIcon}>
                  <Image
                    src="/icons/login/apple.png"
                    alt="Apple"
                    width={20}
                    height={20}
                  />
                </div>
                {isLoading ? "Carregando..." : "Continuar com Apple"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Verificação */}
      {isVerificationModalOpen && (
        <div
          className={styles.modalOverlay}
          onClick={closeModal}
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
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
                <div className={styles.modalError}>
                  {error}
                </div>
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
                onClick={() => { resetPhoneLogin(); }}
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
          <a href="#" className={styles.link}>Política de Privacidade</a>
        </p>
      </div>
    </div>
  );
};

export default Login;
