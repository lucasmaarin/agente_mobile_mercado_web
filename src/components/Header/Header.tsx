"use client";
import React, { useState, useRef, useEffect } from "react";
import styles from "./Header.module.css";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Image from "next/image";
import { LogOut, ShoppingCart, Clock, Truck, Star, X, User, MapPin, Save, SlidersHorizontal } from "lucide-react";
import type { EnderecoSalvo } from "@/lib/buildSystemPrompt";

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
  nomeCliente?: string;
  userPhone?: string;
  userCpf?: string;
  enderecoSalvo?: EnderecoSalvo | null;
  onSalvarPerfil?: (dados: { nome: string; cpf: string; telefone: string }) => Promise<void>;
  onSalvarEndereco?: (end: EnderecoSalvo) => Promise<void>;
  onLogout?: () => void;
  isGuestMode?: boolean;
  carouselEnabled?: boolean;
  onCarouselChange?: (val: boolean) => void;
  wordKeysEnabled?: boolean;
  onWordKeysChange?: (val: boolean) => void;
}

const EMPTY_ENDERECO: EnderecoSalvo = { street: '', number: '', neighborhood: '', city: '', state: '', zipCode: '' };

const Header: React.FC<HeaderProps> = ({
  logoUrl,
  cartTotal = 0,
  cartCount = 0,
  onAbrirCarrinho,
  info,
  corPrimaria = "#1C30C7",
  onTotalHeightChange,
  nomeCliente = '',
  userPhone = '',
  userCpf = '',
  enderecoSalvo = null,
  onSalvarPerfil,
  onSalvarEndereco,
  isGuestMode = false,
  carouselEnabled = true,
  onCarouselChange,
  wordKeysEnabled = false,
  onWordKeysChange,
  onLogout,
}) => {
  const [menuAberto, setMenuAberto] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const infoStripRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(102);

  // Settings form state
  const [editNome, setEditNome]       = useState('');
  const [editCpf, setEditCpf]         = useState('');
  const [editPhone, setEditPhone]     = useState('');
  const [editEnd, setEditEnd]         = useState<EnderecoSalvo>(EMPTY_ENDERECO);
  const [salvandoPerfil, setSalvandoPerfil]   = useState(false);
  const [salvandoEnd, setSalvandoEnd]         = useState(false);
  const [feedbackPerfil, setFeedbackPerfil]   = useState('');
  const [feedbackEnd, setFeedbackEnd]         = useState('');

  // Sync props → form when modal opens
  useEffect(() => {
    if (menuAberto) {
      setEditNome(nomeCliente);
      setEditCpf(userCpf);
      setEditPhone(userPhone);
      setEditEnd(enderecoSalvo ?? EMPTY_ENDERECO);
      setFeedbackPerfil('');
      setFeedbackEnd('');
    }
  }, [menuAberto, nomeCliente, userCpf, userPhone, enderecoSalvo]);

  useEffect(() => {
    const update = () => {
      const hh = headerRef.current?.offsetHeight ?? 102;
      const ih = infoStripRef.current?.offsetHeight ?? 28;
      setHeaderHeight(hh);
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
      onLogout?.();
    } catch (error) {
      console.error("Erro ao sair:", error);
    }
  };

  const handleSalvarPerfil = async () => {
    if (!onSalvarPerfil) return;
    setSalvandoPerfil(true);
    setFeedbackPerfil('');
    try {
      await onSalvarPerfil({ nome: editNome.trim(), cpf: editCpf.trim(), telefone: editPhone.trim() });
      setFeedbackPerfil('Salvo!');
      setTimeout(() => setFeedbackPerfil(''), 2000);
    } catch {
      setFeedbackPerfil('Erro ao salvar.');
    } finally {
      setSalvandoPerfil(false);
    }
  };

  const handleSalvarEndereco = async () => {
    if (!onSalvarEndereco) return;
    setSalvandoEnd(true);
    setFeedbackEnd('');
    try {
      await onSalvarEndereco(editEnd);
      setFeedbackEnd('Salvo!');
      setTimeout(() => setFeedbackEnd(''), 2000);
    } catch {
      setFeedbackEnd('Erro ao salvar.');
    } finally {
      setSalvandoEnd(false);
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

      {/* Settings modal */}
      {menuAberto && (
        <>
          <div className={styles.settingsBackdrop} onClick={() => setMenuAberto(false)} />
          <div className={`${styles.settingsPanel} ${menuAberto ? styles.settingsPanelOpen : ''}`}>
            {/* Header do painel */}
            <div className={styles.settingsHeader}>
              <span className={styles.settingsTitle}>Configurações</span>
              <button className={styles.settingsClose} onClick={() => setMenuAberto(false)} aria-label="Fechar">
                <X size={20} />
              </button>
            </div>

            <div className={styles.settingsBody}>
              {/* Seção: Dados pessoais */}
              <div className={styles.settingsSection}>
                <div className={styles.settingsSectionTitle}>
                  <User size={15} />
                  <span>Dados Pessoais</span>
                </div>
                <div className={styles.settingsField}>
                  <label className={styles.settingsLabel}>Nome</label>
                  <input
                    className={styles.settingsInput}
                    type="text"
                    value={editNome}
                    onChange={(e) => setEditNome(e.target.value)}
                    placeholder="Como você gostaria de ser chamado?"
                  />
                </div>
                <div className={styles.settingsField}>
                  <label className={styles.settingsLabel}>CPF</label>
                  <input
                    className={styles.settingsInput}
                    type="text"
                    value={editCpf}
                    onChange={(e) => setEditCpf(e.target.value)}
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                  />
                </div>
                <div className={styles.settingsField}>
                  <label className={styles.settingsLabel}>Telefone</label>
                  <input
                    className={styles.settingsInput}
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="+55 (00) 00000-0000"
                    inputMode="tel"
                  />
                </div>
                <div className={styles.settingsSaveRow}>
                  {feedbackPerfil && (
                    <span className={styles.settingsFeedback}>{feedbackPerfil}</span>
                  )}
                  <button
                    className={styles.settingsSaveBtn}
                    onClick={handleSalvarPerfil}
                    disabled={salvandoPerfil}
                  >
                    <Save size={14} />
                    {salvandoPerfil ? 'Salvando...' : 'Salvar dados'}
                  </button>
                </div>
              </div>

              <div className={styles.settingsDivider} />

              {/* Seção: Endereço */}
              <div className={styles.settingsSection}>
                <div className={styles.settingsSectionTitle}>
                  <MapPin size={15} />
                  <span>Endereço de Entrega</span>
                </div>
                <div className={styles.settingsField}>
                  <label className={styles.settingsLabel}>Rua / Avenida</label>
                  <input className={styles.settingsInput} type="text" value={editEnd.street}
                    onChange={(e) => setEditEnd(p => ({ ...p, street: e.target.value }))} placeholder="Ex: Rua das Flores" />
                </div>
                <div className={styles.settingsFieldRow}>
                  <div className={styles.settingsField} style={{ flex: 2 }}>
                    <label className={styles.settingsLabel}>Bairro</label>
                    <input className={styles.settingsInput} type="text" value={editEnd.neighborhood}
                      onChange={(e) => setEditEnd(p => ({ ...p, neighborhood: e.target.value }))} placeholder="Bairro" />
                  </div>
                  <div className={styles.settingsField} style={{ flex: 1 }}>
                    <label className={styles.settingsLabel}>Número</label>
                    <input className={styles.settingsInput} type="text" value={editEnd.number}
                      onChange={(e) => setEditEnd(p => ({ ...p, number: e.target.value }))} placeholder="Nº" />
                  </div>
                </div>
                <div className={styles.settingsFieldRow}>
                  <div className={styles.settingsField} style={{ flex: 2 }}>
                    <label className={styles.settingsLabel}>Cidade</label>
                    <input className={styles.settingsInput} type="text" value={editEnd.city}
                      onChange={(e) => setEditEnd(p => ({ ...p, city: e.target.value }))} placeholder="Cidade" />
                  </div>
                  <div className={styles.settingsField} style={{ flex: 1 }}>
                    <label className={styles.settingsLabel}>Estado</label>
                    <input className={styles.settingsInput} type="text" value={editEnd.state}
                      onChange={(e) => setEditEnd(p => ({ ...p, state: e.target.value }))} placeholder="UF" maxLength={2} />
                  </div>
                </div>
                <div className={styles.settingsField}>
                  <label className={styles.settingsLabel}>CEP</label>
                  <input className={styles.settingsInput} type="text" value={editEnd.zipCode}
                    onChange={(e) => setEditEnd(p => ({ ...p, zipCode: e.target.value }))} placeholder="00000-000" inputMode="numeric" />
                </div>
                <div className={styles.settingsSaveRow}>
                  {feedbackEnd && (
                    <span className={styles.settingsFeedback}>{feedbackEnd}</span>
                  )}
                  <button
                    className={styles.settingsSaveBtn}
                    onClick={handleSalvarEndereco}
                    disabled={salvandoEnd}
                  >
                    <Save size={14} />
                    {salvandoEnd ? 'Salvando...' : 'Salvar endereço'}
                  </button>
                </div>
              </div>

              <div className={styles.settingsDivider} />

              {/* Seção: Configurações de Teste — apenas modo convidado */}
              {isGuestMode && (
                <>
                  <div className={styles.settingsSection}>
                    <div className={styles.settingsSectionTitle}>
                      <SlidersHorizontal size={15} />
                      <span>Configurações de Teste</span>
                    </div>
                    <label className={styles.settingsToggleRow}>
                      <span className={styles.settingsToggleLabel}>Carrossel horizontal de produtos</span>
                      <input
                        type="checkbox"
                        className={styles.settingsCheckbox}
                        checked={carouselEnabled}
                        onChange={(e) => onCarouselChange?.(e.target.checked)}
                      />
                    </label>
                    <label className={styles.settingsToggleRow}>
                      <span className={styles.settingsToggleLabel}>Busca por wordKeys/searchIndex</span>
                      <input
                        type="checkbox"
                        className={styles.settingsCheckbox}
                        checked={wordKeysEnabled}
                        onChange={(e) => onWordKeysChange?.(e.target.checked)}
                      />
                    </label>
                  </div>
                  <div className={styles.settingsDivider} />
                </>
              )}

              {/* Logout */}
              <button className={styles.settingsLogoutBtn} onClick={handleLogout}>
                <LogOut size={16} />
                <span>Sair da conta</span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default Header;
