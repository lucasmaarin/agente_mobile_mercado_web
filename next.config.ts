import type { NextConfig } from "next";
import { DOMAIN_SLUGS } from "./src/config/dominios";

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
