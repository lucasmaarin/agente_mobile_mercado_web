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

const LOGO_OVERRIDES: Record<string, string> = {
  jQQjHTCc2zW1tuZMQzGF:    '/logos/zerograu_logo.png',
  q0IPIusmpEq3pHbMyfWY:    '/logos/vidal_logo.png',
};

const NOME_OVERRIDES: Record<string, string> = {
  q0IPIusmpEq3pHbMyfWY: 'Vidal',
};

export function useEstabelecimento(companyId: string): UseEstabelecimentoResult {
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

    buscarFormasPagamento(companyId)
      .then((formas) => { if (formas.length > 0) setFormasPagamento(formas); })
      .catch(() => {});

    buscarConfigLoja(companyId)
      .then((cfg) => setLojaConfig(cfg))
      .catch(() => {});

    buscarInfoEstabelecimento(companyId)
      .then((info) => setInfoEstabelecimento(info))
      .catch(() => {});
  }, [companyId]);

  return {
    logoEstabelecimento,
    nomeEstabelecimento,
    nomeEstabelecimentoCarregado,
    infoEstabelecimento,
    formasPagamento,
    lojaConfig,
  };
}
