import type { NextConfig } from "next";

// Mapeamento: domínio do cliente → slug do estabelecimento
// Adicione uma linha por cliente e redeploy no Render
const DOMAIN_SLUGS: Record<string, string> = {
  // 'royal.com.br':            'royal',
  // 'zerograu.com.br':         'zerograu',
  // 'padaria-center.com.br':   'padaria-center',
  'https://royal.dev.br/': 'jqqjhtcc2zw1tuzmqzgf', // Zero Grau
};

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  rewrites: async () => ({
    afterFiles: Object.entries(DOMAIN_SLUGS).flatMap(([domain, slug]) => [
      { source: '/',       has: [{ type: 'host', value: domain }], destination: `/${slug}`         },
      { source: '/:path*', has: [{ type: 'host', value: domain }], destination: `/${slug}/:path*`  },
    ]),
  }),
};

export default nextConfig;
