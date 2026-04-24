import type { Metadata } from "next";
import { SLUG_PARA_COMPANY_ID, LOGO_OVERRIDES, NOME_OVERRIDES } from "@/config/dominios";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const companyId = SLUG_PARA_COMPANY_ID[slug.toLowerCase()] ?? slug;

  const nome = NOME_OVERRIDES[companyId] ?? "Agente Móbile";
  const logo = LOGO_OVERRIDES[companyId] ?? "/logo.png";

  return {
    title: nome,
    description: `Assistente de compras — ${nome}`,
    icons: {
      icon: logo,
      apple: logo,
      shortcut: logo,
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: nome,
    },
  };
}

export default function SlugLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
