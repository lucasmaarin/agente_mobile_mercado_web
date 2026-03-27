import { NextRequest, NextResponse } from "next/server";

// Prefixos que nunca devem ser interceptados
const BYPASS = ["/_next", "/api", "/favicon", "/logo", "/prodSemImg"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Ignora assets, API e página raiz
  const hasExtension = /\.\w{2,5}$/.test(pathname);
  if (
    pathname === "/" ||
    hasExtension ||
    BYPASS.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
