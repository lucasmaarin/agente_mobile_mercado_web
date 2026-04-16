import React from "react";
import styles from "./WelcomeCard.module.css";

const LARGE_LOGO_IDS = new Set(['XAXMOP6aweRbBAb0gUvU', 'jQQjHTCc2zW1tuZMQzGF']);

interface WelcomeCardProps {
  logoUrl: string | null;
  nomeEstabelecimento: string;
  companyId?: string;
}

const WelcomeCard: React.FC<WelcomeCardProps> = ({ logoUrl, nomeEstabelecimento, companyId }) => {
  const largeLogo = companyId ? LARGE_LOGO_IDS.has(companyId) : false;
  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <div className={largeLogo ? styles.logoWrapperLarge : styles.logoWrapper}>
          <img
            src={logoUrl ?? "/logo.png"}
            alt={nomeEstabelecimento}
            className={styles.logo}
            onError={(e) => { (e.target as HTMLImageElement).src = "/logo.png"; }}
          />
        </div>
        <span className={styles.subtitle}>
          Agente<br />
          inteligente{nomeEstabelecimento ? <><br />do {nomeEstabelecimento}</> : ""}
        </span>
      </div>
      <div>
        <p className={styles.greeting}>Olá, 👋 Bem vindo(a)</p>
        <p className={styles.heading}>
          Seu pedido pronto<br />em minutos.
        </p>
      </div>
    </div>
  );
};

export default WelcomeCard;
