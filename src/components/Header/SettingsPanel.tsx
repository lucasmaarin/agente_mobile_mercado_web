"use client";
import React, { useState, useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { LogOut, User, MapPin, Save, SlidersHorizontal, X } from "lucide-react";
import type { EnderecoSalvo } from "@/lib/buildSystemPrompt";
import styles from "./SettingsPanel.module.css";

const EMPTY_ENDERECO: EnderecoSalvo = {
  street: "", number: "", neighborhood: "", city: "", state: "", zipCode: "",
};

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  precisaLogin: boolean;
  isGuestMode: boolean;
  nomeCliente: string;
  userCpf: string;
  userPhone: string;
  enderecoSalvo: EnderecoSalvo | null;
  onSalvarPerfil: (dados: { nome: string; cpf: string; telefone: string }) => Promise<void>;
  onSalvarEndereco: (end: EnderecoSalvo) => Promise<void>;
  onLogout: () => void;
  carouselEnabled: boolean;
  onCarouselChange: (val: boolean) => void;
  wordKeysEnabled: boolean;
  onWordKeysChange: (val: boolean) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  precisaLogin,
  isGuestMode,
  nomeCliente,
  userCpf,
  userPhone,
  enderecoSalvo,
  onSalvarPerfil,
  onSalvarEndereco,
  onLogout,
  carouselEnabled,
  onCarouselChange,
  wordKeysEnabled,
  onWordKeysChange,
}) => {
  const [editNome, setEditNome]   = useState("");
  const [editCpf, setEditCpf]     = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEnd, setEditEnd]     = useState<EnderecoSalvo>(EMPTY_ENDERECO);
  const [salvandoPerfil, setSalvandoPerfil]   = useState(false);
  const [salvandoEnd, setSalvandoEnd]         = useState(false);
  const [feedbackPerfil, setFeedbackPerfil]   = useState("");
  const [feedbackEnd, setFeedbackEnd]         = useState("");

  useEffect(() => {
    if (isOpen) {
      setEditNome(nomeCliente);
      setEditCpf(userCpf);
      setEditPhone(userPhone);
      setEditEnd(enderecoSalvo ?? EMPTY_ENDERECO);
      setFeedbackPerfil("");
      setFeedbackEnd("");
    }
  }, [isOpen, nomeCliente, userCpf, userPhone, enderecoSalvo]);

  const handleSalvarPerfil = async () => {
    setSalvandoPerfil(true);
    setFeedbackPerfil("");
    try {
      await onSalvarPerfil({ nome: editNome.trim(), cpf: editCpf.trim(), telefone: editPhone.trim() });
      setFeedbackPerfil("Salvo!");
      setTimeout(() => setFeedbackPerfil(""), 2000);
    } catch {
      setFeedbackPerfil("Erro ao salvar.");
    } finally {
      setSalvandoPerfil(false);
    }
  };

  const handleSalvarEndereco = async () => {
    setSalvandoEnd(true);
    setFeedbackEnd("");
    try {
      await onSalvarEndereco(editEnd);
      setFeedbackEnd("Salvo!");
      setTimeout(() => setFeedbackEnd(""), 2000);
    } catch {
      setFeedbackEnd("Erro ao salvar.");
    } finally {
      setSalvandoEnd(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      onClose();
      onLogout();
    } catch (error) {
      console.error("Erro ao sair:", error);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={`${styles.panel} ${styles.panelOpen}`}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Configurações</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <div className={styles.body}>
          {!precisaLogin && (
            <>
              {/* Dados pessoais */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  <User size={15} />
                  <span>Dados Pessoais</span>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Nome</label>
                  <input className={styles.input} type="text" value={editNome}
                    onChange={(e) => setEditNome(e.target.value)}
                    placeholder="Como você gostaria de ser chamado?" />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>CPF</label>
                  <input className={styles.input} type="text" value={editCpf}
                    onChange={(e) => setEditCpf(e.target.value)}
                    placeholder="000.000.000-00" inputMode="numeric" />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Telefone</label>
                  <input className={styles.input} type="tel" value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="+55 (00) 00000-0000" inputMode="tel" />
                </div>
                <div className={styles.saveRow}>
                  {feedbackPerfil && <span className={styles.feedback}>{feedbackPerfil}</span>}
                  <button className={styles.saveBtn} onClick={handleSalvarPerfil} disabled={salvandoPerfil}>
                    <Save size={14} />
                    {salvandoPerfil ? "Salvando..." : "Salvar dados"}
                  </button>
                </div>
              </div>

              <div className={styles.divider} />

              {/* Endereço */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  <MapPin size={15} />
                  <span>Endereço de Entrega</span>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Rua / Avenida</label>
                  <input className={styles.input} type="text" value={editEnd.street}
                    onChange={(e) => setEditEnd((p) => ({ ...p, street: e.target.value }))}
                    placeholder="Ex: Rua das Flores" />
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.field} style={{ flex: 2 }}>
                    <label className={styles.label}>Bairro</label>
                    <input className={styles.input} type="text" value={editEnd.neighborhood}
                      onChange={(e) => setEditEnd((p) => ({ ...p, neighborhood: e.target.value }))}
                      placeholder="Bairro" />
                  </div>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label className={styles.label}>Número</label>
                    <input className={styles.input} type="text" value={editEnd.number}
                      onChange={(e) => setEditEnd((p) => ({ ...p, number: e.target.value }))}
                      placeholder="Nº" />
                  </div>
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.field} style={{ flex: 2 }}>
                    <label className={styles.label}>Cidade</label>
                    <input className={styles.input} type="text" value={editEnd.city}
                      onChange={(e) => setEditEnd((p) => ({ ...p, city: e.target.value }))}
                      placeholder="Cidade" />
                  </div>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label className={styles.label}>Estado</label>
                    <input className={styles.input} type="text" value={editEnd.state}
                      onChange={(e) => setEditEnd((p) => ({ ...p, state: e.target.value }))}
                      placeholder="UF" maxLength={2} />
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>CEP</label>
                  <input className={styles.input} type="text" value={editEnd.zipCode}
                    onChange={(e) => setEditEnd((p) => ({ ...p, zipCode: e.target.value }))}
                    placeholder="00000-000" inputMode="numeric" />
                </div>
                <div className={styles.saveRow}>
                  {feedbackEnd && <span className={styles.feedback}>{feedbackEnd}</span>}
                  <button className={styles.saveBtn} onClick={handleSalvarEndereco} disabled={salvandoEnd}>
                    <Save size={14} />
                    {salvandoEnd ? "Salvando..." : "Salvar endereço"}
                  </button>
                </div>
              </div>

              <div className={styles.divider} />

              {/* Configurações de teste — só modo convidado */}
              {isGuestMode && (
                <>
                  <div className={styles.section}>
                    <div className={styles.sectionTitle}>
                      <SlidersHorizontal size={15} />
                      <span>Configurações de Teste</span>
                    </div>
                    <label className={styles.toggleRow}>
                      <span className={styles.toggleLabel}>Carrossel horizontal de produtos</span>
                      <input type="checkbox" className={styles.checkbox}
                        checked={carouselEnabled}
                        onChange={(e) => onCarouselChange(e.target.checked)} />
                    </label>
                    <label className={styles.toggleRow}>
                      <span className={styles.toggleLabel}>Busca por wordKeys/searchIndex</span>
                      <input type="checkbox" className={styles.checkbox}
                        checked={wordKeysEnabled}
                        onChange={(e) => onWordKeysChange(e.target.checked)} />
                    </label>
                  </div>
                  <div className={styles.divider} />
                </>
              )}


              {/* Logout */}
              <button className={styles.logoutBtn} onClick={handleLogout}>
                <LogOut size={16} />
                <span>Sair da conta</span>
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default SettingsPanel;
