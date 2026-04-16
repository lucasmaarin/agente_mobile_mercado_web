import { useState, useEffect } from "react";
import {
  buscarLogoEstabelecimento,
  buscarNomeEstabelecimento,
  buscarFormasPagamento,
  buscarConfigLoja,
  buscarInfoEstabelecimento,
  type ConfigLoja,
  type InfoEstabelecimento,
} from "@/services/firestore";

interface UseEstabelecimentoResult {
  logoEstabelecimento: string | null;
  nomeEstabelecimento: string;
  nomeEstabelecimentoCarregado: boolean;
  infoEstabelecimento: InfoEstabelecimento;
  formasPagamento: string[];
  lojaConfig: ConfigLoja | null;
}

// Overrides keyed pelo ID ORIGINAL do slug (não pelo ID de dados)
const LOGO_OVERRIDES: Record<string, string> = {
  jQQjHTCc2zW1tuZMQzGF: '/logos/zerograu_logo.png',
  XAXMOP6aweRbBAb0gUvU: '/logos/vidal_logo.png',
};

const NOME_OVERRIDES: Record<string, string> = {
  XAXMOP6aweRbBAb0gUvU: 'Vidal',
};

/**
 * companyId   — ID do slug atual (usado para nome/logo: overrides ou Firestore próprio)
 * dataCompanyId — ID de onde vêm os dados (config, formas de pagamento, info de entrega)
 *                 Pode ser diferente quando o estabelecimento usa dados de outro (ex: Vidal → UAU Mart)
 */
export function useEstabelecimento(companyId: string, dataCompanyId?: string): UseEstabelecimentoResult {
  const srcId = dataCompanyId ?? companyId;

  const [logoEstabelecimento, setLogoEstabelecimento] = useState<string | null>(
    LOGO_OVERRIDES[companyId] ?? null
  );
  const [nomeEstabelecimento, setNomeEstabelecimento] = useState<string>(
    NOME_OVERRIDES[companyId] ?? ""
  );
  const [nomeEstabelecimentoCarregado, setNomeEstabelecimentoCarregado] = useState(false);
  const [infoEstabelecimento, setInfoEstabelecimento] = useState<InfoEstabelecimento>({});
  const [formasPagamento, setFormasPagamento] = useState<string[]>([]);
  const [lojaConfig, setLojaConfig] = useState<ConfigLoja | null>(null);

  useEffect(() => {
    if (!companyId) return;

    // Nome e logo: sempre do slug atual (com override ou Firestore próprio)
    if (!LOGO_OVERRIDES[companyId]) {
      buscarLogoEstabelecimento(companyId)
        .then((url) => { if (url) setLogoEstabelecimento(url); })
        .catch(() => {});
    }

    if (!NOME_OVERRIDES[companyId]) {
      buscarNomeEstabelecimento(companyId)
        .then((nome) => { if (nome) setNomeEstabelecimento(nome); })
        .catch(() => {})
        .finally(() => setNomeEstabelecimentoCarregado(true));
    } else {
      setNomeEstabelecimentoCarregado(true);
    }

    // Dados operacionais: do srcId (pode ser outro estabelecimento)
    buscarFormasPagamento(srcId)
      .then((formas) => { if (formas.length > 0) setFormasPagamento(formas); })
      .catch(() => {});

    buscarConfigLoja(srcId)
      .then((cfg) => setLojaConfig(cfg))
      .catch(() => {});

    buscarInfoEstabelecimento(srcId)
      .then((info) => setInfoEstabelecimento(info))
      .catch(() => {});
  }, [companyId, srcId]);

  return {
    logoEstabelecimento,
    nomeEstabelecimento,
    nomeEstabelecimentoCarregado,
    infoEstabelecimento,
    formasPagamento,
    lojaConfig,
  };
}
