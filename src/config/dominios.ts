// Mapeamento: domínio do cliente → slug do estabelecimento
// Adicione uma linha por cliente e redeploy no Render
export const DOMAIN_SLUGS: Record<string, string> = {
  'uaumart':  'q0IPIusmpEq3pHbMyfWY',  // uaumart.agentemobile.com.br
  'vidal':    'XAXMOP6aweRbBAb0gUvU',  // vidal.agentemobile.com.br
  'zerograu': 'jQQjHTCc2zW1tuZMQzGF',  // zerograu.agentemobile.com.br
  'gs':       'GkFYWdOBKD1vbzYoem9K',  // gs.agentemobile.com.br
};

// Mapa de slug em minúsculo → ID real do Firestore (com casing correto)
// Usado para resolver URLs que chegam em lowercase
export const SLUG_PARA_COMPANY_ID: Record<string, string> = Object.fromEntries(
  Object.entries(DOMAIN_SLUGS).map(([slug, id]) => [slug.toLowerCase(), id])
);

// Redirecionamento temporário de dados: companyId → ID real usado nas queries
// Use quando o estabelecimento ainda não tem dados próprios no Firestore
export const COMPANY_DATA_SOURCE: Record<string, string> = {
  XAXMOP6aweRbBAb0gUvU: 'q0IPIusmpEq3pHbMyfWY',
};

// Logos locais por companyId (sobrescrevem o Firestore)
export const LOGO_OVERRIDES: Record<string, string> = {
  jQQjHTCc2zW1tuZMQzGF: '/logos/logo_zero.svg',
  XAXMOP6aweRbBAb0gUvU: '/logos/logo_vidal.webp',
  q0IPIusmpEq3pHbMyfWY: '/logos/logouaumart.svg',
  GkFYWdOBKD1vbzYoem9K: '/logos/logogs.svg',
};

// Nomes sobrescritos por companyId
export const NOME_OVERRIDES: Record<string, string> = {
  XAXMOP6aweRbBAb0gUvU: 'Vidal Supermercados',
};
