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
  cartCount?: number;
  onAbrirCarrinho?: () => void;
  info?: InfoEstabelecimento;
  corPrimaria?: string;
  onTotalHeightChange?: (h: number) => void;
}

const Header: React.FC<HeaderProps> = ({
  logoUrl,
  cartTotal = 0,
  cartCount = 0,
  onAbrirCarrinho,
  info,
  corPrimaria = "#1C30C7",
  onTotalHeightChange,
}) => {
  const [menuAberto, setMenuAberto] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const infoStripRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(102);
  const [infoStripHeight, setInfoStripHeight] = useState(28);

  useEffect(() => {
    const update = () => {
      const hh = headerRef.current?.offsetHeight ?? 102;
      const ih = infoStripRef.current?.offsetHeight ?? 28;
      setHeaderHeight(hh);
      setInfoStripHeight(ih);
      onTotalHeightChange?.(hh + 2 + ih);
    };
    const obs = new ResizeObserver(update);
    if (headerRef.current) obs.observe(headerRef.current);
    if (infoStripRef.current) obs.observe(infoStripRef.current);
    update();
    return () => obs.disconnect();
  }, [onTotalHeightChange]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setMenuAberto(false);
    } catch (error) {
      console.error("Erro ao sair:", error);
    }
  };

  const corStrip = corPrimaria === "#1C30C7" ? "#314DD9" : corPrimaria;

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
                src={logoUrl || "/logo_vidal.png"}
                alt="Logo"
                fill
                className={styles.logoImg}
                sizes="72px"
                onError={(e) => { (e.target as HTMLImageElement).src = "/logo_vidal.png"; }}
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
            <img
              src="/ofertas.svg"
              alt="ofertas"
              className={styles.ofertasImg}
              width={34}
              height={34}
            />
            <button
              className={styles.menuButton}
              onClick={() => setMenuAberto((v) => !v)}
              aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
            >
              <img
                src="/hamburguer.svg"
                alt="menu"
                className={styles.menuIconImg}
                width={26}
                height={19}
              />
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
            <span>SUAS COMPRAS (<span className={styles.cartCountNum}>{cartCount > 99 ? "+99" : cartCount}</span>)</span>
          </button>
        </div>
      </header>

      {/* Faixa info colada abaixo do header */}
      <div
        ref={infoStripRef}
        className={styles.infoStripOuter}
        style={{ top: headerHeight + 2 }}
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
            <Clock size={14} />
            {infoFinal.tempoMin} a {infoFinal.tempoMax} min
          </span>
          <span className={styles.infoDivider} />
          <span className={styles.infoItem}>
            <Truck size={14} />
            {infoFinal.taxaEntrega === 0
              ? "Grátis"
              : `R$ ${infoFinal.taxaEntrega!.toFixed(2).replace(".", ",")}`}
          </span>
          {infoFinal.avaliacao !== undefined && (
            <>
              <span className={styles.infoDivider} />
              <span className={styles.infoItem}>
                <span className={styles.ratingText}>{infoFinal.avaliacao.toFixed(1)}</span>
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
