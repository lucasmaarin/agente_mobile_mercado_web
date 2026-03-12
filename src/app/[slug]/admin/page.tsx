"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { buscarPedidosPorEstabelecimento, atualizarStatusPedido, type Pedido } from "@/services/firestore";

const STATUS_LABELS: Record<string, { label: string; cor: string }> = {
  "PurchaseStatus.pending":    { label: "Pendente",    cor: "#f59e0b" },
  "PurchaseStatus.accepted":   { label: "Aceito",      cor: "#3b82f6" },
  "PurchaseStatus.inDelivery": { label: "Em entrega",  cor: "#8b5cf6" },
  "PurchaseStatus.delivered":  { label: "Entregue",    cor: "#22c55e" },
  "PurchaseStatus.canceled":   { label: "Cancelado",   cor: "#ef4444" },
};

function statusInfo(s: string) {
  return STATUS_LABELS[s] ?? { label: s, cor: "#9ca3af" };
}

export default function AdminPage() {
  const params = useParams();
  const router = useRouter();
  const companyId = params?.slug as string;

  const [userId, setUserId] = useState<string | null>(null);
  const [autenticando, setAutenticando] = useState(true);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  // Modal de notificação
  const [pedidoSelecionado, setPedidoSelecionado] = useState<Pedido | null>(null);
  const [tipoNotif, setTipoNotif] = useState<"entregador_saiu" | "entregador_chegando">("entregador_saiu");
  const [etaInput, setEtaInput] = useState("30");
  const [enviando, setEnviando] = useState(false);
  const [msgSucesso, setMsgSucesso] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.push(`/${companyId}/login`);
        return;
      }
      setUserId(user.uid);
      setAutenticando(false);
    });
    return () => unsub();
  }, [companyId, router]);

  const carregar = useCallback(async () => {
    if (!companyId) return;
    setCarregando(true);
    setErro("");
    try {
      const lista = await buscarPedidosPorEstabelecimento(companyId);
      setPedidos(lista);
    } catch (e) {
      setErro("Erro ao carregar pedidos.");
      console.error(e);
    } finally {
      setCarregando(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!autenticando && userId) carregar();
  }, [autenticando, userId, carregar]);

  async function enviarNotificacao() {
    if (!pedidoSelecionado) return;
    setEnviando(true);
    setMsgSucesso("");
    try {
      const res = await fetch("/api/push/notificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: pedidoSelecionado.clientId,
          tipo: tipoNotif,
          etaMinutos: tipoNotif === "entregador_saiu" ? parseInt(etaInput) : undefined,
          slug: companyId,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);

      // Atualiza status no Firestore
      const novoStatus =
        tipoNotif === "entregador_saiu"
          ? "PurchaseStatus.inDelivery"
          : "PurchaseStatus.delivered";
      await atualizarStatusPedido(pedidoSelecionado.id, novoStatus);

      setMsgSucesso("Notificação enviada!");
      await carregar();
      setTimeout(() => {
        setPedidoSelecionado(null);
        setMsgSucesso("");
      }, 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao enviar notificação.";
      setMsgSucesso(`Erro: ${msg}`);
    } finally {
      setEnviando(false);
    }
  }

  if (autenticando) {
    return (
      <div style={s.centro}>
        <div style={s.spinner} />
      </div>
    );
  }

  return (
    <main style={s.main}>
      <div style={s.container}>
        <header style={s.header}>
          <div>
            <h1 style={s.titulo}>Painel Admin</h1>
            <p style={s.subtitulo}>{companyId}</p>
          </div>
          <div style={s.headerAcoes}>
            <button onClick={carregar} style={s.btnRefresh} title="Recarregar">
              ↻
            </button>
            <button onClick={() => auth.signOut()} style={s.btnSair}>
              Sair
            </button>
          </div>
        </header>

        {erro && <div style={s.erroBox}>{erro}</div>}

        {carregando && <p style={s.centro}>Carregando pedidos...</p>}

        {!carregando && pedidos.length === 0 && (
          <div style={s.vazio}>Nenhum pedido encontrado.</div>
        )}

        {!carregando && pedidos.length > 0 && (
          <div style={s.lista}>
            {pedidos.map((p) => {
              const st = statusInfo(p.currentPurchaseStatus);
              const data = p.createdAt?.toDate?.()?.toLocaleString("pt-BR") ?? "";
              return (
                <div key={p.id} style={s.card}>
                  <div style={s.cardTopo}>
                    <div>
                      <span style={s.pedidoNum}>#{p.orderNumber}</span>
                      <span style={{ ...s.badge, background: st.cor }}>{st.label}</span>
                    </div>
                    <span style={s.data}>{data}</span>
                  </div>

                  <div style={s.cardInfo}>
                    <p style={s.infoLinha}>
                      <strong>Cliente:</strong> {p.clientName}
                    </p>
                    <p style={s.infoLinha}>
                      <strong>Endereço:</strong> {p.address?.fullAddress ?? "—"}
                    </p>
                    <p style={s.infoLinha}>
                      <strong>Itens:</strong>{" "}
                      {p.productsCart
                        ?.map((i) => `${i.quantity}x ${i.product?.name}`)
                        .join(", ") ?? "—"}
                    </p>
                    <p style={s.infoLinha}>
                      <strong>Total:</strong> R$ {p.total?.toFixed(2).replace(".", ",")}
                    </p>
                  </div>

                  <div style={s.cardAcoes}>
                    <button
                      style={s.btnEntregou}
                      onClick={() => {
                        setPedidoSelecionado(p);
                        setTipoNotif("entregador_saiu");
                        setEtaInput(
                          String(p.estimatedTimeDelivery?.intervalMinutes ?? 30)
                        );
                        setMsgSucesso("");
                      }}
                    >
                      🛵 Entregador saiu
                    </button>
                    <button
                      style={s.btnChegando}
                      onClick={() => {
                        setPedidoSelecionado(p);
                        setTipoNotif("entregador_chegando");
                        setMsgSucesso("");
                      }}
                    >
                      📦 Entregador chegando
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de notificação */}
      {pedidoSelecionado && (
        <div style={s.overlay} onClick={() => setPedidoSelecionado(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.modalTitulo}>
              {tipoNotif === "entregador_saiu" ? "🛵 Entregador saiu" : "📦 Entregador chegando"}
            </h3>
            <p style={s.modalSub}>
              Pedido <strong>#{pedidoSelecionado.orderNumber}</strong> —{" "}
              {pedidoSelecionado.clientName}
            </p>

            {tipoNotif === "entregador_saiu" && (
              <div style={s.mField}>
                <label style={s.mLabel}>Tempo estimado (minutos)</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={etaInput}
                  onChange={(e) => setEtaInput(e.target.value)}
                  style={s.mInput}
                />
                <p style={s.mDica}>
                  O cliente receberá: &quot;Seu entregador saiu. Previsão de chegada: {etaInput} min.&quot;
                </p>
              </div>
            )}

            {tipoNotif === "entregador_chegando" && (
              <p style={s.mDica}>
                O cliente receberá: &quot;Seu entregador está chegando. Prepare-se para receber!&quot;
              </p>
            )}

            {msgSucesso && (
              <p
                style={{
                  ...s.mDica,
                  color: msgSucesso.startsWith("Erro") ? "#ef4444" : "#22c55e",
                  fontWeight: 600,
                }}
              >
                {msgSucesso}
              </p>
            )}

            <div style={s.mAcoes}>
              <button style={s.btnCancelar} onClick={() => setPedidoSelecionado(null)}>
                Cancelar
              </button>
              <button
                style={enviando ? { ...s.btnEnviar, opacity: 0.65 } : s.btnEnviar}
                onClick={enviarNotificacao}
                disabled={enviando}
              >
                {enviando ? "Enviando..." : "Enviar notificação"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  main: { minHeight: "100vh", background: "#f9fafb", padding: "24px 16px" },
  container: { maxWidth: "720px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" },
  titulo: { fontSize: "20px", fontWeight: 700, color: "#111827", margin: 0 },
  subtitulo: { fontSize: "13px", color: "#9ca3af", margin: 0, fontFamily: "monospace" },
  headerAcoes: { display: "flex", gap: "10px", alignItems: "center" },
  btnRefresh: { background: "none", border: "1.5px solid #e5e7eb", borderRadius: "8px", fontSize: "18px", padding: "6px 10px", cursor: "pointer", color: "#6b7280" },
  btnSair: { background: "none", border: "1.5px solid #e5e7eb", borderRadius: "8px", fontSize: "13px", padding: "7px 14px", cursor: "pointer", color: "#374151" },
  erroBox: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "12px 16px", fontSize: "14px", color: "#dc2626" },
  vazio: { textAlign: "center", padding: "48px 0", color: "#9ca3af", fontSize: "14px" },
  lista: { display: "flex", flexDirection: "column", gap: "14px" },
  card: { background: "#fff", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px" },
  cardTopo: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" },
  pedidoNum: { fontSize: "15px", fontWeight: 700, color: "#111827", marginRight: "8px" },
  badge: { display: "inline-block", borderRadius: "20px", padding: "2px 10px", fontSize: "12px", fontWeight: 600, color: "#fff" },
  data: { fontSize: "12px", color: "#9ca3af" },
  cardInfo: { display: "flex", flexDirection: "column", gap: "4px" },
  infoLinha: { fontSize: "13px", color: "#374151", margin: 0 },
  cardAcoes: { display: "flex", gap: "10px", flexWrap: "wrap" },
  btnEntregou: { padding: "8px 16px", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" },
  btnChegando: { padding: "8px 16px", background: "#22c55e", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" },
  centro: { display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" },
  spinner: { width: "32px", height: "32px", border: "3px solid #e5e7eb", borderTop: "3px solid #3632f8", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  // Modal
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "16px" },
  modal: { background: "#fff", borderRadius: "12px", padding: "28px", width: "100%", maxWidth: "400px", display: "flex", flexDirection: "column", gap: "16px", boxShadow: "0 8px 32px rgba(0,0,0,0.16)" },
  modalTitulo: { fontSize: "17px", fontWeight: 700, color: "#111827", margin: 0 },
  modalSub: { fontSize: "14px", color: "#6b7280", margin: 0 },
  mField: { display: "flex", flexDirection: "column", gap: "6px" },
  mLabel: { fontSize: "13px", fontWeight: 600, color: "#374151" },
  mInput: { padding: "10px 12px", borderRadius: "8px", border: "1.5px solid #e5e7eb", fontSize: "15px", color: "#111827", outline: "none", width: "120px" },
  mDica: { fontSize: "12px", color: "#9ca3af", margin: 0, lineHeight: 1.5 },
  mAcoes: { display: "flex", gap: "10px", justifyContent: "flex-end" },
  btnCancelar: { padding: "9px 16px", border: "1.5px solid #e5e7eb", borderRadius: "8px", background: "#fff", fontSize: "14px", color: "#374151", cursor: "pointer" },
  btnEnviar: { padding: "9px 16px", border: "none", borderRadius: "8px", background: "#3632f8", fontSize: "14px", fontWeight: 600, color: "#fff", cursor: "pointer" },
};
