import { NextRequest, NextResponse } from "next/server";
import { SLUGS_AUTORIZADOS } from "./config/dominios";

// Prefixos que nunca devem ser interceptados
const BYPASS = ["/_next", "/api", "/favicon", "/logo", "/prodSemImg"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Ignora assets, API e página raiz
  if (
    pathname === "/" ||
    BYPASS.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

  // Extrai o primeiro segmento da URL: /royal/login → "royal"
  const slug = pathname.split("/")[1];

  if (slug && !SLUGS_AUTORIZADOS.has(slug)) {
    // Redireciona para a raiz com aviso
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("nao_autorizado", "1");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
