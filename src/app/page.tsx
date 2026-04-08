"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { ShoppingCart, Globe, ExternalLink, Search } from "lucide-react";
import { DOMAIN_SLUGS } from "@/config/dominios";
import { buscarNomeEstabelecimento, buscarLogoEstabelecimento } from "@/services/firestore";

interface Estabelecimento {
  companyId: string;
  domain: string | null;
  nome: string | null;
  logo: string | null;
  loading: boolean;
}

// Monta lista de estabelecimentos únicos a partir do DOMAIN_SLUGS + teste fixo
function getEstabelecimentos(): Estabelecimento[] {
  const seen = new Set<string>();
  const list: Estabelecimento[] = [];

  for (const [key, companyId] of Object.entries(DOMAIN_SLUGS)) {
    if (seen.has(companyId)) continue;
    seen.add(companyId);

    // Chave com ponto = domínio real; sem ponto = apenas identificador interno
    const domain = key.includes(".") ? key.replace(/^https?:\/\/(www\.)?/, "") : null;

    list.push({ companyId, domain, nome: null, logo: null, loading: true });
  }

  // Estabelecimento de teste fixo
  if (!seen.has("estabelecimento-teste")) {
    list.push({
      companyId: "estabelecimento-teste",
      domain: null,
      nome: "Estabelecimento Teste",
      logo: null,
      loading: false,
    });
  }

  return list;
}

export default function HomePage() {
  const [items, setItems] = useState<Estabelecimento[]>(getEstabelecimentos);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    items.forEach(({ companyId }) => {
      Promise.all([
        buscarNomeEstabelecimento(companyId),
        buscarLogoEstabelecimento(companyId),
      ]).then(([nome, logo]) => {
        setItems(prev =>
          prev.map(e =>
            e.companyId === companyId
              ? { ...e, nome, logo, loading: false }
              : e
          )
        );
      }).catch(() => {
        setItems(prev =>
          prev.map(e =>
            e.companyId === companyId ? { ...e, loading: false } : e
          )
        );
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtrados = items.filter(e => {
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return (
      (e.nome?.toLowerCase().includes(q)) ||
      (e.domain?.toLowerCase().includes(q)) ||
      e.companyId.toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ height: "100dvh", overflowY: "auto", background: "#f0f2ff", fontFamily: "var(--font-inter, 'Segoe UI', sans-serif)" }}>

      {/* ── Hero ── */}
      <div style={{
        background: "linear-gradient(135deg, #1C30C7 0%, #0f1f8a 100%)",
        padding: "48px 24px 64px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Círculos decorativos */}
        <div style={{
          position: "absolute", top: -60, right: -60,
          width: 220, height: 220, borderRadius: "50%",
          background: "rgba(255,255,255,0.05)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: -40, left: -40,
          width: 160, height: 160, borderRadius: "50%",
          background: "rgba(255,255,255,0.05)",
          pointerEvents: "none",
        }} />

        {/* Logo */}
        <div style={{
          width: 72, height: 72, borderRadius: 20,
          background: "rgba(255,255,255,0.15)",
          backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 20px",
          border: "1.5px solid rgba(255,255,255,0.25)",
        }}>
          <Image
            src="/logo.png"
            alt="Agente Móbile"
            width={44}
            height={44}
            style={{ objectFit: "contain" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>

        <h1 style={{ color: "#fff", fontSize: 28, fontWeight: 800, margin: "0 0 8px", letterSpacing: "-0.5px" }}>
          Agente Móbile
        </h1>
        <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 15, margin: "0 0 32px", maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
          Escolha o seu supermercado e comece a fazer suas compras com a ajuda de um assistente inteligente.
        </p>

        {/* Busca */}
        <div style={{
          maxWidth: 380, margin: "0 auto",
          position: "relative",
        }}>
          <Search
            size={16}
            style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }}
          />
          <input
            type="text"
            placeholder="Buscar supermercado..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 16px 12px 40px",
              borderRadius: 12,
              border: "none",
              fontSize: 14,
              background: "rgba(255,255,255,0.95)",
              color: "#1e293b",
              outline: "none",
              boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            }}
          />
        </div>
      </div>

      {/* ── Card wave shape ── */}
      <div style={{ marginTop: -24, height: 24, background: "#f0f2ff", borderRadius: "24px 24px 0 0" }} />

      {/* ── Lista ── */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "8px 20px 60px" }}>

        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20, textAlign: "center" }}>
          {filtrados.length} {filtrados.length === 1 ? "estabelecimento disponível" : "estabelecimentos disponíveis"}
        </p>

        {filtrados.length === 0 && !items.some(e => e.loading) && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8" }}>
            <ShoppingCart size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
            <p style={{ fontSize: 15, fontWeight: 600, color: "#64748b" }}>Nenhum supermercado encontrado</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>Tente um nome diferente na busca.</p>
          </div>
        )}

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 16,
        }}>
          {filtrados.map(e => (
            <EstabelecimentoCard key={e.companyId} item={e} />
          ))}
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{
        textAlign: "center",
        padding: "24px",
        borderTop: "1px solid #e2e8f0",
        fontSize: 12,
        color: "#94a3b8",
        background: "#fff",
      }}>
        Agente Móbile &nbsp;·&nbsp; Compras inteligentes para o seu supermercado
      </div>
    </div>
  );
}

function EstabelecimentoCard({ item }: { item: Estabelecimento }) {
  const { companyId, domain, nome, logo, loading } = item;
  const href = `/${companyId}`;
  const displayNome = nome ?? (loading ? "" : companyId);

  if (loading) {
    return (
      <div style={{
        background: "#fff",
        borderRadius: 16,
        padding: "20px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        border: "1.5px solid #e8ecff",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 12, background: "#e8ecff", flexShrink: 0, animation: "pulse 1.4s infinite" }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ height: 14, borderRadius: 6, background: "#e8ecff", width: "70%" }} />
            <div style={{ height: 11, borderRadius: 6, background: "#f1f5f9", width: "50%" }} />
          </div>
        </div>
        <div style={{ height: 38, borderRadius: 10, background: "#e8ecff" }} />
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
      </div>
    );
  }

  return (
    <div style={{
      background: "#fff",
      borderRadius: 16,
      padding: "20px",
      boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
      border: "1.5px solid #e8ecff",
      display: "flex",
      flexDirection: "column",
      gap: 16,
      transition: "box-shadow 0.2s, transform 0.2s",
    }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 28px rgba(28,48,199,0.15)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
      }}
    >
      {/* Topo: logo + nome */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>

        {/* Logo */}
        <div style={{
          width: 52, height: 52, borderRadius: 12, flexShrink: 0,
          overflow: "hidden",
          background: "linear-gradient(135deg, #e8ecff 0%, #c7d0ff 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "1.5px solid #dde3ff",
        }}>
          {logo ? (
            <img
              src={logo}
              alt={displayNome ?? ""}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <ShoppingCart size={22} style={{ color: "#1C30C7", opacity: 0.7 }} />
          )}
        </div>

        {/* Nome + domínio */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 700, color: "#0f172a",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {displayNome || companyId}
          </div>
          {domain ? (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              marginTop: 4,
              background: "#f0f9ff", borderRadius: 6, padding: "2px 8px",
              fontSize: 11, color: "#0284c7", fontWeight: 500,
            }}>
              <Globe size={10} />
              {domain}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
              Acesso direto
            </div>
          )}
        </div>
      </div>

      {/* Botão */}
      <a
        href={href}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          background: "linear-gradient(135deg, #1C30C7 0%, #2e45e0 100%)",
          color: "#fff",
          borderRadius: 10,
          padding: "11px 16px",
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
          letterSpacing: "0.2px",
        }}
      >
        <ShoppingCart size={14} />
        Acessar
        <ExternalLink size={12} style={{ opacity: 0.7 }} />
      </a>
    </div>
  );
}
