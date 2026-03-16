"use client";
import React, { useState, useEffect } from "react";
import styles from "./CheckoutModal.module.css";
import { MapPin, CreditCard, Banknote, QrCode, X, ChevronLeft, Check, Loader2 } from "lucide-react";
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc,
  doc, Timestamp, GeoPoint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createOrder } from "@/services/firestore";
import type { CartItem, CustomerData } from "@/lib/buildSystemPrompt";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Address {
  id: string;
  tipo: string;
  nome: string;
  endereco: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  zipCode: string;
  referencia?: string;
  isDefault: boolean;
  latitude?: number;
  longitude?: number;
}

interface CheckoutModalProps {
  carrinho: CartItem[];
  userDocId: string;
  companyId: string;
  nomeCliente: string;
  formasPagamento: string[];
  subtotal: number;
  taxaEntrega: number;
  onClose: () => void;
  onSuccess: (orderNumber: string, total: number) => void;
}

type Step = "pagamento" | "enderecos" | "confirmacao" | "sucesso";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatarPreco(v: number) {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function getPaymentIcon(id: string) {
  const lower = id.toLowerCase();
  if (lower.includes("pix"))     return <QrCode size={22} />;
  if (lower.includes("dinheiro") || lower.includes("cash")) return <Banknote size={22} />;
  return <CreditCard size={22} />;
}

function normalizePaymentId(nome: string): string {
  const n = nome.toLowerCase();
  if (n.includes("pix"))                return "pix";
  if (n.includes("dinheiro"))           return "dinheiro";
  if (n.includes("cr") && n.includes("dito")) return "credito";
  if (n.includes("d") && n.includes("bito"))  return "debito";
  return nome;
}

const BANDEIRAS = ["Visa", "Mastercard", "Elo", "Hipercard", "American Express"];

// ─── Sub-modais inline ────────────────────────────────────────────────────────

const TrocoModal: React.FC<{
  valorTotal: number;
  onClose: () => void;
  onConfirm: (v: number) => void;
}> = ({ valorTotal, onClose, onConfirm }) => {
  const [val, setVal] = useState("");
  const numeric = parseFloat(val) || 0;
  const valid = numeric >= valorTotal;

  return (
    <div className={styles.subModalOverlay} onClick={onClose}>
      <div className={styles.subModalBox} onClick={(e) => e.stopPropagation()}>
        <h3>Troco para quanto?</h3>
        <p>Total: <b>R$ {formatarPreco(valorTotal)}</b></p>
        <input
          type="number"
          min={valorTotal}
          step="0.01"
          placeholder="R$ 0,00"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className={styles.subModalInput}
        />
        {val && !valid && <p className={styles.subModalError}>Valor deve ser ≥ ao total</p>}
        <div className={styles.subModalActions}>
          <button onClick={onClose} className={styles.btnSecondary}>Cancelar</button>
          <button onClick={() => valid && onConfirm(numeric)} disabled={!valid} className={styles.btnPrimary}>
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
};

const BandeiraModal: React.FC<{
  tipo: string;
  onClose: () => void;
  onConfirm: (b: string) => void;
}> = ({ tipo, onClose, onConfirm }) => {
  const [escolhida, setEscolhida] = useState("");
  return (
    <div className={styles.subModalOverlay} onClick={onClose}>
      <div className={styles.subModalBox} onClick={(e) => e.stopPropagation()}>
        <h3>Bandeira do cartão</h3>
        <p>Cartão de {tipo === "credito" ? "crédito" : "débito"}</p>
        <div className={styles.bandeirasGrid}>
          {BANDEIRAS.map((b) => (
            <button
              key={b}
              className={`${styles.bandeiraBtn} ${escolhida === b ? styles.bandeiraBtnSel : ""}`}
              onClick={() => setEscolhida(b)}
            >
              {b}
            </button>
          ))}
        </div>
        <div className={styles.subModalActions}>
          <button onClick={onClose} className={styles.btnSecondary}>Cancelar</button>
          <button onClick={() => escolhida && onConfirm(escolhida)} disabled={!escolhida} className={styles.btnPrimary}>
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Componente principal ─────────────────────────────────────────────────────

const CheckoutModal: React.FC<CheckoutModalProps> = ({
  carrinho, userDocId, companyId, nomeCliente, formasPagamento,
  subtotal, taxaEntrega, onClose, onSuccess,
}) => {
  const total = subtotal + taxaEntrega;

  // Navegação
  const [step, setStep] = useState<Step>("pagamento");

  // Pagamento
  const [metodoPagamento, setMetodoPagamento] = useState<string | null>(null);
  const [bandeiraCartao, setBandeiraCartao]   = useState<string | undefined>();
  const [trocoValor, setTrocoValor]           = useState<number | undefined>();
  const [cpfNaNota, setCpfNaNota]             = useState(false);
  const [cpf, setCpf]                         = useState("");
  const [showTroco, setShowTroco]             = useState(false);
  const [showBandeira, setShowBandeira]       = useState(false);

  // Endereços
  const [addresses, setAddresses]               = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [loadingAddr, setLoadingAddr]           = useState(true);
  const [menuAbertoId, setMenuAbertoId]         = useState<string | null>(null);
  const [showForm, setShowForm]                 = useState(false);
  const [editingAddress, setEditingAddress]     = useState<Address | null>(null);
  const [newAddress, setNewAddress]             = useState<Partial<Address>>({ tipo: "Casa" });

  // Pedido
  const [processando, setProcessando] = useState(false);
  const [orderResult, setOrderResult] = useState<{ orderNumber: string; total: number } | null>(null);

  // ── Carregar endereços ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoadingAddr(true);
      try {
        const snap = await getDocs(collection(db, "Users", userDocId, "Addresses"));
        const loaded: Address[] = snap.docs
          .map((d) => {
            const data = d.data();
            const pos  = data.position;
            return {
              id:          d.id,
              tipo:        data.tipo || "Casa",
              nome:        data.name || data.nome || "Casa",
              endereco:    data.street || data.endereco || "",
              numero:      data.number || data.numero || "",
              complemento: data.complement || data.complemento || "",
              bairro:      data.neighborhood || data.bairro || "",
              cidade:      data.city || data.cidade || "",
              uf:          data.uf || data.state || "",
              zipCode:     data.zipCode || "",
              referencia:  data.reference || data.referencia || "",
              isDefault:   data.isDefault || false,
              latitude:    typeof data.latitude === "number" ? data.latitude : pos?.latitude,
              longitude:   typeof data.longitude === "number" ? data.longitude : pos?.longitude,
            } as Address;
          })
          .filter((a) => a.endereco && a.numero && a.cidade);
        setAddresses(loaded);
        const padrao = loaded.find((a) => a.isDefault);
        if (padrao) setSelectedAddressId(padrao.id);
      } finally {
        setLoadingAddr(false);
      }
    })();
  }, [userDocId]);

  // ── Geolocalização ───────────────────────────────────────────────────────────
  const handleUseLocation = () => {
    if (!navigator.geolocation) { alert("Geolocalização não suportada."); return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
      const data = await res.json();
      const addr = data.address || {};
      setNewAddress((prev) => ({
        ...prev,
        endereco: addr.road || "",
        bairro:   addr.suburb || addr.neighbourhood || "",
        cidade:   addr.city || addr.town || addr.village || "",
        uf:       addr.state || "",
        zipCode:  addr.postcode || "",
        latitude, longitude,
      }));
    }, () => alert("Não foi possível acessar sua localização."));
  };

  // ── Salvar endereço ──────────────────────────────────────────────────────────
  const handleSalvarEndereco = async () => {
    if (!newAddress.endereco?.trim() || !newAddress.numero?.trim()) {
      alert("Preencha pelo menos a rua e o número.");
      return;
    }
    const data = {
      tipo:         newAddress.tipo || "Casa",
      name:         newAddress.tipo || "Casa",
      street:       newAddress.endereco!.trim(),
      number:       newAddress.numero!.trim(),
      complement:   newAddress.complemento?.trim() || "",
      neighborhood: newAddress.bairro?.trim() || "",
      city:         newAddress.cidade?.trim() || "",
      state:        newAddress.uf?.trim() || "",
      uf:           newAddress.uf?.trim() || "",
      zipCode:      newAddress.zipCode?.trim() || "",
      reference:    newAddress.referencia?.trim() || "",
      isDefault:    newAddress.isDefault || false,
      latitude:     newAddress.latitude || null,
      longitude:    newAddress.longitude || null,
      createdAt:    Timestamp.now(),
      updatedAt:    Timestamp.now(),
    };
    if (editingAddress) {
      await updateDoc(doc(db, "Users", userDocId, "Addresses", editingAddress.id), { ...data, updatedAt: Timestamp.now() });
      setAddresses((prev) => prev.map((a) => a.id === editingAddress.id ? { ...a, ...data, id: a.id, nome: data.name, latitude: data.latitude ?? undefined, longitude: data.longitude ?? undefined } : a));
    } else {
      const ref = await addDoc(collection(db, "Users", userDocId, "Addresses"), data);
      setAddresses((prev) => [...prev, { id: ref.id, ...data, nome: data.name, endereco: data.street, numero: data.number, bairro: data.neighborhood, cidade: data.city } as Address]);
    }
    setShowForm(false);
    setEditingAddress(null);
    setNewAddress({ tipo: "Casa" });
  };

  const handleExcluirEndereco = async (id: string) => {
    await deleteDoc(doc(db, "Users", userDocId, "Addresses", id));
    setAddresses((prev) => prev.filter((a) => a.id !== id));
    if (selectedAddressId === id) setSelectedAddressId(null);
  };

  // ── Confirmar pagamento ──────────────────────────────────────────────────────
  const pagamentoValido = () => {
    if (!metodoPagamento) return false;
    const id = normalizePaymentId(metodoPagamento);
    if (id === "dinheiro" && !trocoValor) return false;
    if ((id === "credito" || id === "debito") && !bandeiraCartao) return false;
    if (cpfNaNota && cpf.replace(/\D/g, "").length !== 11) return false;
    return true;
  };

  // ── Finalizar pedido ─────────────────────────────────────────────────────────
  const handleFinalizarCompra = async () => {
    const addr = addresses.find((a) => a.id === selectedAddressId);
    if (!addr) { alert("Selecione um endereço."); return; }

    const payId = normalizePaymentId(metodoPagamento!);

    const customerData: CustomerData = {
      name:         nomeCliente,
      street:       addr.endereco,
      number:       addr.numero,
      neighborhood: addr.bairro,
      city:         addr.cidade,
      state:        addr.uf,
      uf:           addr.uf,
      zipCode:      addr.zipCode,
      paymentType:  payId === "credito" ? "Cartão Crédito"
                  : payId === "debito"  ? "Cartão Débito"
                  : payId === "pix"     ? "Pix"
                  : "Dinheiro",
      cardBrand:    bandeiraCartao,
      changeAmount: trocoValor ? `R$${trocoValor}` : undefined,
      cpf:          cpfNaNota ? cpf.replace(/\D/g, "") : undefined,
    };

    setProcessando(true);
    try {
      const result = await createOrder(companyId, customerData, carrinho, userDocId, nomeCliente);
      setOrderResult({ orderNumber: result.orderNumber, total: result.total });
      setStep("sucesso");
    } catch (e) {
      console.error(e);
      alert("Erro ao finalizar pedido. Tente novamente.");
    } finally {
      setProcessando(false);
    }
  };

  // ── Formatadores ─────────────────────────────────────────────────────────────
  const formatCpf = (v: string) =>
    v.replace(/\D/g, "")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})/, "$1-$2")
      .replace(/(-\d{2})\d+?$/, "$1");

  const descPagamento = () => {
    if (!metodoPagamento) return "";
    const id = normalizePaymentId(metodoPagamento);
    if (id === "dinheiro" && trocoValor) return `Dinheiro — troco para R$ ${formatarPreco(trocoValor)}`;
    if ((id === "credito" || id === "debito") && bandeiraCartao)
      return `Cartão de ${id === "credito" ? "crédito" : "débito"} — ${bandeiraCartao}`;
    return metodoPagamento;
  };

  const addrSelecionado = addresses.find((a) => a.id === selectedAddressId);

  // ─────────────────────────────────────────────────────────────────────────────
  // TELA DE SUCESSO
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === "sucesso" && orderResult) {
    return (
      <div className={styles.overlay}>
        <div className={styles.successBox}>
          <div className={styles.successCircle}>
            <Check size={48} color="#fff" strokeWidth={3} />
          </div>
          <h2>Pedido realizado!</h2>
          <p className={styles.successOrder}>Nº {orderResult.orderNumber}</p>
          <p className={styles.successTotal}>Total: <b>R$ {formatarPreco(orderResult.total)}</b></p>
          <button
            className={styles.successBtn}
            onClick={() => onSuccess(orderResult.orderNumber, orderResult.total)}
          >
            Voltar ao chat
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODAL PRINCIPAL
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>

        {/* HEADER */}
        <div className={styles.modalHeader}>
          {step !== "pagamento" && (
            <button className={styles.backBtn} onClick={() => {
              if (step === "enderecos")   setStep("pagamento");
              if (step === "confirmacao") setStep("enderecos");
            }}>
              <ChevronLeft size={22} color="#fff" />
            </button>
          )}
          <h2 className={styles.modalTitle}>
            {step === "pagamento"   && "Forma de pagamento"}
            {step === "enderecos"   && "Endereço de entrega"}
            {step === "confirmacao" && "Confirme seu pedido"}
          </h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={20} color="#fff" />
          </button>
        </div>

        {/* BODY */}
        <div className={styles.modalBody}>

          {/* ════════════ PAGAMENTO ════════════ */}
          {step === "pagamento" && (
            <>
              <div className={styles.methodList}>
                {formasPagamento.map((nome) => {
                  const id = normalizePaymentId(nome);
                  const sel = metodoPagamento === nome;
                  return (
                    <button
                      key={nome}
                      className={`${styles.methodBtn} ${sel ? styles.methodBtnSel : ""}`}
                      onClick={() => {
                        setMetodoPagamento(nome);
                        setBandeiraCartao(undefined);
                        setTrocoValor(undefined);
                        if (id === "dinheiro")              setShowTroco(true);
                        if (id === "credito" || id === "debito") setShowBandeira(true);
                      }}
                    >
                      <span className={styles.methodIcon}>{getPaymentIcon(nome)}</span>
                      <span className={styles.methodNome}>{nome}</span>
                      {sel && bandeiraCartao && <span className={styles.methodDetail}>{bandeiraCartao}</span>}
                      {sel && trocoValor && <span className={styles.methodDetail}>Troco p/ R$ {formatarPreco(trocoValor)}</span>}
                      {sel && <Check size={16} className={styles.methodCheck} />}
                    </button>
                  );
                })}
              </div>

              <div className={styles.cpfRow}>
                <label className={styles.cpfLabel}>
                  <input type="checkbox" checked={cpfNaNota} onChange={(e) => { setCpfNaNota(e.target.checked); if (!e.target.checked) setCpf(""); }} />
                  CPF na nota
                </label>
                {cpfNaNota && (
                  <input
                    className={styles.cpfInput}
                    placeholder="000.000.000-00"
                    maxLength={14}
                    value={cpf}
                    onChange={(e) => setCpf(formatCpf(e.target.value))}
                  />
                )}
              </div>

              <div className={styles.totalRow}>
                <span>Total</span>
                <span className={styles.totalVal}>R$ {formatarPreco(total)}</span>
              </div>
            </>
          )}

          {/* ════════════ ENDEREÇOS ════════════ */}
          {step === "enderecos" && (
            <>
              <div className={styles.addressList}>
                {loadingAddr ? (
                  <div className={styles.loadingRow}><Loader2 size={20} className={styles.spin} /> Carregando...</div>
                ) : addresses.length === 0 ? (
                  <p className={styles.emptyAddr}>Nenhum endereço salvo. Adicione um abaixo.</p>
                ) : (
                  addresses.map((addr) => (
                    <div
                      key={addr.id}
                      className={`${styles.addrCard} ${addr.id === selectedAddressId ? styles.addrCardSel : ""}`}
                      onClick={() => setSelectedAddressId(addr.id)}
                    >
                      <div className={styles.addrLeft}>
                        <MapPin size={20} className={styles.addrIcon} />
                        <div>
                          <p className={styles.addrStreet}>{addr.endereco}, {addr.numero}</p>
                          <p className={styles.addrFull}>{addr.bairro}, {addr.cidade} — {addr.uf} · CEP {addr.zipCode}</p>
                        </div>
                      </div>
                      <div className={styles.addrRight}>
                        {addr.id === selectedAddressId && (
                          <span className={styles.addrCheck}><Check size={14} color="#fff" /></span>
                        )}
                        <div className={styles.addrMenuWrap}>
                          <button className={styles.addrMenuBtn} onClick={(e) => { e.stopPropagation(); setMenuAbertoId(menuAbertoId === addr.id ? null : addr.id); }}>
                            ···
                          </button>
                          {menuAbertoId === addr.id && (
                            <div className={styles.addrDropdown}>
                              <button onClick={() => { setEditingAddress(addr); setNewAddress(addr); setShowForm(true); setMenuAbertoId(null); }}>Editar</button>
                              <button onClick={() => { handleExcluirEndereco(addr.id); setMenuAbertoId(null); }}>Excluir</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {!showForm && !loadingAddr && (
                <button className={styles.addAddrBtn} onClick={() => { setEditingAddress(null); setNewAddress({ tipo: "Casa" }); setShowForm(true); }}>
                  + Adicionar novo endereço
                </button>
              )}

              {showForm && (
                <div className={styles.addrForm}>
                  <button className={styles.locationBtn} onClick={handleUseLocation}>
                    <MapPin size={16} /> Usar minha localização
                  </button>
                  {newAddress.latitude && newAddress.longitude && (
                    <iframe
                      width="100%" height="140"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${newAddress.longitude - 0.005},${newAddress.latitude - 0.005},${newAddress.longitude + 0.005},${newAddress.latitude + 0.005}&layer=mapnik&marker=${newAddress.latitude},${newAddress.longitude}`}
                      style={{ border: 0, borderRadius: 8 }}
                    />
                  )}
                  {(["endereco", "numero", "bairro", "cidade", "uf", "zipCode"] as const).map((field) => (
                    <input
                      key={field}
                      className={styles.formInput}
                      placeholder={field === "endereco" ? "Rua" : field === "numero" ? "Número" : field === "bairro" ? "Bairro" : field === "cidade" ? "Cidade" : field === "uf" ? "Estado (UF)" : "CEP"}
                      value={(newAddress as Record<string, string>)[field] || ""}
                      onChange={(e) => setNewAddress((p) => ({ ...p, [field]: e.target.value }))}
                    />
                  ))}
                  <div className={styles.formActions}>
                    <button className={styles.btnSecondary} onClick={() => { setShowForm(false); setEditingAddress(null); }}>Cancelar</button>
                    <button className={styles.btnPrimary} onClick={handleSalvarEndereco}>{editingAddress ? "Atualizar" : "Salvar"}</button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ════════════ CONFIRMAÇÃO ════════════ */}
          {step === "confirmacao" && addrSelecionado && (
            <div className={styles.confirmList}>
              <div className={styles.confirmCard}>
                <MapPin size={32} className={styles.confirmIcon} />
                <div>
                  <p className={styles.confirmLabel}>Endereço</p>
                  <p>{addrSelecionado.endereco}, {addrSelecionado.numero}</p>
                  <p>{addrSelecionado.bairro}, {addrSelecionado.cidade} — {addrSelecionado.uf}</p>
                  <p>CEP {addrSelecionado.zipCode}</p>
                </div>
              </div>

              <div className={styles.confirmCard}>
                {getPaymentIcon(metodoPagamento!)}
                <div>
                  <p className={styles.confirmLabel}>Pagamento</p>
                  <p>{descPagamento()}</p>
                </div>
              </div>

              <div className={styles.confirmCard}>
                <div className={styles.confirmValues}>
                  <div className={styles.confirmRow}><span>Subtotal</span><span>R$ {formatarPreco(subtotal)}</span></div>
                  <div className={styles.confirmRow}><span>Taxa de entrega</span><span>R$ {formatarPreco(taxaEntrega)}</span></div>
                  <div className={`${styles.confirmRow} ${styles.confirmTotal}`}><span>Total</span><span>R$ {formatarPreco(total)}</span></div>
                </div>
              </div>

              <div className={styles.confirmCard}>
                <div>
                  <p className={styles.confirmLabel}>Itens ({carrinho.length})</p>
                  {carrinho.map((item) => (
                    <p key={item.id} className={styles.confirmItem}>
                      {item.quantity}x {item.name} — R$ {formatarPreco(item.price * item.quantity)}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className={styles.modalFooter}>
          {step === "pagamento" && (
            <button
              className={styles.btnFooter}
              disabled={!pagamentoValido()}
              onClick={() => setStep("enderecos")}
            >
              Continuar
            </button>
          )}
          {step === "enderecos" && (
            <button
              className={styles.btnFooter}
              disabled={!selectedAddressId || loadingAddr}
              onClick={() => setStep("confirmacao")}
            >
              Continuar
            </button>
          )}
          {step === "confirmacao" && (
            <button
              className={`${styles.btnFooter} ${styles.btnFooterGreen}`}
              disabled={processando}
              onClick={handleFinalizarCompra}
            >
              {processando ? <><Loader2 size={16} className={styles.spin} /> Processando...</> : "Confirmar pedido"}
            </button>
          )}
        </div>
      </div>

      {/* Sub-modais */}
      {showTroco && (
        <TrocoModal
          valorTotal={total}
          onClose={() => { setShowTroco(false); setMetodoPagamento(null); }}
          onConfirm={(v) => { setTrocoValor(v); setShowTroco(false); }}
        />
      )}
      {showBandeira && (
        <BandeiraModal
          tipo={normalizePaymentId(metodoPagamento || "")}
          onClose={() => { setShowBandeira(false); setMetodoPagamento(null); }}
          onConfirm={(b) => { setBandeiraCartao(b); setShowBandeira(false); }}
        />
      )}
    </div>
  );
};

export default CheckoutModal;
