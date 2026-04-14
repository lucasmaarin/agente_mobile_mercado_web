import React from "react";
import { Clock, Truck, Star } from "lucide-react";
import type { InfoEstabelecimento } from "@/services/firestore";
import styles from "./InfoBar.module.css";

interface InfoBarProps {
  info: InfoEstabelecimento;
}

const InfoBar: React.FC<InfoBarProps> = ({ info }) => {
  return (
    <div className={styles.bar}>
      {info.aberto === false ? (
        <span className={styles.item}>
          <span className={styles.fechado}>Fechado</span>
        </span>
      ) : (
        <span className={styles.item}>
          <span className={styles.aberto}>Aberto</span>
          {info.horarioFechamento ? ` até ${info.horarioFechamento}` : ""}
        </span>
      )}

      <span className={styles.item}>
        <Clock size={12} />
        {info.tempoMin ?? 20} a {info.tempoMax ?? 60} min
      </span>

      <span className={styles.item}>
        <Truck size={12} />
        {!info.taxaEntrega ? "Grátis" : `R$ ${info.taxaEntrega.toFixed(2).replace(".", ",")}`}
      </span>

      {info.avaliacao !== undefined && (
        <span className={styles.item}>
          {info.avaliacao.toFixed(1)}
          <Star size={11} className={styles.star} />
        </span>
      )}
    </div>
  );
};

export default InfoBar;
