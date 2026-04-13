import React from "react";
import styles from "./WelcomeCard.module.css";

interface WelcomeCardProps {
  logoUrl: string | null;
  nomeEstabelecimento: string;
}

const WelcomeCard: React.FC<WelcomeCardProps> = ({ logoUrl, nomeEstabelecimento }) => {
  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <img
          src={logoUrl ?? "/logo.png"}
          alt={nomeEstabelecimento}
          className={styles.logo}
          onError={(e) => { (e.target as HTMLImageElement).src = "/logo.png"; }}
        />
        <span className={styles.subtitle}>
          Agente<br />
          inteligente{nomeEstabelecimento ? <><br />do {nomeEstabelecimento}</> : ""}
        </span>
      </div>
      <p className={styles.greeting}>Olá, 👋 Bem vindo(a)</p>
      <p className={styles.heading}>
        Seu pedido pronto<br />em minutos.
      </p>
    </div>
  );
};

export default WelcomeCard;
