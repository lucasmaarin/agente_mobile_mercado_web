import React from "react";
import styles from "./WelcomeCard.module.css";

interface WelcomeCardProps {
  logoUrl: string | null;
  nomeEstabelecimento: string;
  companyId?: string;
}

const WelcomeCard: React.FC<WelcomeCardProps> = ({ logoUrl, nomeEstabelecimento }) => {
  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <div className={styles.logoWrapper}>
          <img
            src={logoUrl ?? "/logo.png"}
            alt={nomeEstabelecimento}
            className={styles.logo}
            onError={(e) => { (e.target as HTMLImageElement).src = "/logo.png"; }}
          />
        </div>
        <span className={styles.subtitle}>
          Agente<br />
          inteligente{nomeEstabelecimento ? <> do<br />{nomeEstabelecimento}</> : ""}
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
