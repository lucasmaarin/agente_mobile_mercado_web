"use client";
import React, { useState, useRef, useEffect } from "react";
import styles from "./Header.module.css";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Image from "next/image";
import { LogOut, ShoppingCart, Clock, Truck, Star } from "lucide-react";

export interface InfoEstabelecimento {
  aberto?: boolean;
  horarioFechamento?: string;
  tempoMin?: number;
  tempoMax?: number;
  taxaEntrega?: number;
  avaliacao?: number;
}

interface HeaderProps {
  logoUrl?: string;
  cartTotal?: number;
  onAbrirCarrinho?: () => void;
  info?: InfoEstabelecimento;
  corPrimaria?: string;
}

const Header: React.FC<HeaderProps> = ({
  logoUrl,
  cartTotal = 0,
  onAbrirCarrinho,
  info,
  corPrimaria = "#1a56c4",
}) => {
  const [menuAberto, setMenuAberto] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(102);

  useEffect(() => {
    if (!headerRef.current) return;
    const obs = new ResizeObserver(() => {
      setHeaderHeight(headerRef.current!.offsetHeight);
    });
    obs.observe(headerRef.current);
    setHeaderHeight(headerRef.current.offsetHeight);
    return () => obs.disconnect();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setMenuAberto(false);
    } catch (error) {
      console.error("Erro ao sair:", error);
    }
  };

  const corStrip = `color-mix(in srgb, ${corPrimaria} 75%, white)`;

  const infoFinal: InfoEstabelecimento = {
    aberto: true,
    horarioFechamento: "20:00",
    tempoMin: 20,
    tempoMax: 60,
    taxaEntrega: 5.0,
    avaliacao: 4.9,
    ...info,
  };

  return (
    <>
      <header ref={headerRef} className={styles.header} style={{ background: corPrimaria }}>
        {/* Linha principal */}
        <div className={styles.topRow}>
          {/* Logo */}
          <div className={styles.logoArea}>
            <div className={styles.logoWrapper}>
              <Image
                src={logoUrl || "/logo.png"}
                alt="Logo"
                fill
                className={styles.logoImg}
                sizes="72px"
                onError={(e) => { (e.target as HTMLImageElement).src = "/logo.png"; }}
              />
            </div>
          </div>

          {/* Preço + botão carrinho */}
          <div className={styles.priceArea}>
            <div className={styles.priceRow}>
              <span className={styles.priceSymbol}>R$</span>
              <span className={styles.priceValue}>
                {cartTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Menu */}
          <div className={styles.menuArea}>
            <button
              className={styles.menuButton}
              onClick={() => setMenuAberto((v) => !v)}
              aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
            >
              <span className={styles.menuLabel}>MENU</span>
              <span className={`${styles.menuIcon} ${menuAberto ? styles.menuIconOpen : ""}`}>
                <span className={styles.bar} />
                <span className={styles.bar} />
                <span className={styles.bar} />
              </span>
            </button>
          </div>
        </div>

        {/* Botão carrinho — pill curto colado na base */}
        <div className={styles.cartStripWrapper}>
          <button
            className={styles.cartStrip}
            style={{ background: corStrip }}
            onClick={onAbrirCarrinho}
          >
            <ShoppingCart size={12} />
            <span>CARRINHO DE COMPRAS</span>
          </button>
        </div>
      </header>

      {/* Faixa info colada abaixo do header */}
      <div
        className={styles.infoStripOuter}
        style={{ top: headerHeight }}
      >
        <div className={styles.infoStrip}>
          {infoFinal.aberto === false ? (
            <span className={styles.infoFechado}>Fechado</span>
          ) : (
            <span className={styles.infoGroup}>
              <span className={styles.infoAberto}>Aberto</span>
              {infoFinal.horarioFechamento && (
                <span className={styles.infoAbertoSuffix}>até {infoFinal.horarioFechamento}</span>
              )}
            </span>
          )}
          <span className={styles.infoDivider} />
          <span className={styles.infoItem}>
            <Clock size={12} />
            {infoFinal.tempoMin} a {infoFinal.tempoMax} min
          </span>
          <span className={styles.infoDivider} />
          <span className={styles.infoItem}>
            <Truck size={12} />
            {infoFinal.taxaEntrega === 0
              ? "Grátis"
              : `R$ ${infoFinal.taxaEntrega!.toFixed(2).replace(".", ",")}`}
          </span>
          {infoFinal.avaliacao !== undefined && (
            <>
              <span className={styles.infoDivider} />
              <span className={styles.infoItem}>
                {infoFinal.avaliacao.toFixed(1)}
                <Star size={12} className={styles.starIcon} />
              </span>
            </>
          )}
        </div>
      </div>

      {/* Dropdown */}
      {menuAberto && (
        <>
          <div className={styles.menuBackdrop} onClick={() => setMenuAberto(false)} />
          <div className={styles.menuDropdown} style={{ top: headerHeight + 8 }}>
            <button className={styles.menuItem} onClick={handleLogout}>
              <LogOut size={16} />
              <span>Sair</span>
            </button>
          </div>
        </>
      )}
    </>
  );
};

export default Header;
