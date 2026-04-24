import { NextRequest, NextResponse } from "next/server";

const BYPASS = ["/_next", "/api", "/favicon", "/logo", "/prodSemImg"];

// Domínios raiz que NÃO são slugs (adicione todos os seus domínios aqui)
const ROOT_DOMAINS = [
  "agentemobile.com.br",
  "mobilemercado.com.br",
  "agentemercado.com.br",
  "localhost",
];

function extractSlugFromHost(host: string): string | null {
  // Remove porta se houver (ex: localhost:3000)
  const hostname = host.split(":")[0];

  // Verifica se é um subdomínio de algum domínio raiz
  for (const root of ROOT_DOMAINS) {
    if (hostname.endsWith(`.${root}`)) {
      const subdomain = hostname.slice(0, hostname.length - root.length - 1);
      // Ignora www
      if (subdomain && subdomain !== "www") return subdomain;
    }
  }

  return null;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = req.headers.get("host") ?? "";

  const hasExtension = /\.\w{2,5}$/.test(pathname);
  if (hasExtension || BYPASS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const slug = extractSlugFromHost(host);

  // Se não tem subdomínio válido, segue normalmente
  if (!slug) return NextResponse.next();

  // Evita loop: se o path já começa com o slug, não reescreve
  if (pathname.startsWith(`/${slug}`)) return NextResponse.next();

  // Reescreve internamente: /login → /mercadojose/login
  const url = req.nextUrl.clone();
  url.pathname = `/${slug}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
