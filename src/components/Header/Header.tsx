"use client";
import React, { useState, useRef, useEffect } from "react";
import styles from "./Header.module.css";
import { ShoppingCart } from "lucide-react";
import type { EnderecoSalvo } from "@/lib/buildSystemPrompt";
import SettingsPanel from "./SettingsPanel";

interface HeaderProps {
  nomeEstabelecimento?: string;
  cartTotal?: number;
  cartCount?: number;
  onAbrirCarrinho?: () => void;
  onTotalHeightChange?: (h: number) => void;
  nomeCliente?: string;
  userPhone?: string;
  userCpf?: string;
  enderecoSalvo?: EnderecoSalvo | null;
  onSalvarPerfil?: (dados: { nome: string; cpf: string; telefone: string }) => Promise<void>;
  onSalvarEndereco?: (end: EnderecoSalvo) => Promise<void>;
  onLogout?: () => void;
  isGuestMode?: boolean;
  precisaLogin?: boolean;
  carouselEnabled?: boolean;
  onCarouselChange?: (val: boolean) => void;
  wordKeysEnabled?: boolean;
  onWordKeysChange?: (val: boolean) => void;
}

const Header: React.FC<HeaderProps> = ({
  nomeEstabelecimento = "",
  cartTotal = 0,
  cartCount = 0,
  onAbrirCarrinho,
  onTotalHeightChange,
  nomeCliente = "",
  userPhone = "",
  userCpf = "",
  enderecoSalvo = null,
  onSalvarPerfil,
  onSalvarEndereco,
  isGuestMode = false,
  precisaLogin = false,
  carouselEnabled = true,
  onCarouselChange,
  wordKeysEnabled = false,
  onWordKeysChange,
  onLogout,
}) => {
  const [menuAberto, setMenuAberto] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const update = () => {
      const hh = headerRef.current?.offsetHeight ?? 60;
      onTotalHeightChange?.(hh);
    };
    const obs = new ResizeObserver(update);
    if (headerRef.current) obs.observe(headerRef.current);
    update();
    return () => obs.disconnect();
  }, [onTotalHeightChange]);

  return (
    <>
      <header ref={headerRef} className={styles.header}>
        <div className={styles.topRow}>
          {/* Esquerda: hamburguer + nome do estabelecimento */}
          <button
            className={styles.menuButton}
            onClick={() => setMenuAberto((v) => !v)}
            aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
          >
            <span className={styles.menuBar} />
            <span className={styles.menuBar} />
            <span className={styles.menuBar} />
          </button>
          <span className={styles.nomeEstab}>{nomeEstabelecimento}</span>

          {/* Direita: carrinho */}
          <button className={styles.cartArea} onClick={onAbrirCarrinho} aria-label="Abrir carrinho">
            <div className={styles.cartTop}>
              <ShoppingCart size={16} className={styles.cartIcon} />
              <span className={styles.priceText}>
                {cartTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <span className={styles.cartLabel}>Carrinho ({cartCount > 99 ? "99+" : cartCount})</span>
          </button>
        </div>
      </header>

      <SettingsPanel
        isOpen={menuAberto}
        onClose={() => setMenuAberto(false)}
        precisaLogin={precisaLogin}
        isGuestMode={isGuestMode}
        nomeCliente={nomeCliente}
        userCpf={userCpf}
        userPhone={userPhone}
        enderecoSalvo={enderecoSalvo}
        onSalvarPerfil={onSalvarPerfil ?? (async () => {})}
        onSalvarEndereco={onSalvarEndereco ?? (async () => {})}
        onLogout={onLogout ?? (() => {})}
        carouselEnabled={carouselEnabled}
        onCarouselChange={onCarouselChange ?? (() => {})}
        wordKeysEnabled={wordKeysEnabled}
        onWordKeysChange={onWordKeysChange ?? (() => {})}
      />
    </>
  );
};

export default Header;
