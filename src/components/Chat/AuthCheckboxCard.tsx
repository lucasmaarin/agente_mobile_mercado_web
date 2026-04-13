import React from "react";

interface AuthCheckboxCardProps {
  authKeepLogged: boolean;
  onChangeKeepLogged: (val: boolean) => void;
  authAcceptTerms: boolean;
  onChangeAcceptTerms: (val: boolean) => void;
  authSending: boolean;
  onResend: () => void;
}

const AuthCheckboxCard: React.FC<AuthCheckboxCardProps> = ({
  authKeepLogged,
  onChangeKeepLogged,
  authAcceptTerms,
  onChangeAcceptTerms,
  authSending,
  onResend,
}) => {
  return (
    <div style={{
      background: "#fff",
      borderRadius: 14,
      padding: "14px 16px",
      boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      maxWidth: 300,
    }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.88rem", color: "#374151", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={authKeepLogged}
          onChange={(e) => onChangeKeepLogged(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: "#193281", flexShrink: 0 }}
        />
        Continuar logado
      </label>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: "0.88rem", color: "#374151", cursor: "pointer", lineHeight: 1.4 }}>
        <input
          type="checkbox"
          checked={authAcceptTerms}
          onChange={(e) => onChangeAcceptTerms(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: "#193281", marginTop: 1, flexShrink: 0 }}
        />
        <span>
          Li e aceito os{" "}
          <a href="#" style={{ color: "#193281" }}>Termos de Uso</a>
          {" "}e a{" "}
          <a href="#" style={{ color: "#193281" }}>Política de Privacidade</a>
        </span>
      </label>

      <button
        onClick={onResend}
        disabled={authSending}
        style={{
          background: "none",
          border: "none",
          color: "#6b7280",
          fontSize: "0.82rem",
          cursor: "pointer",
          textDecoration: "underline",
          padding: 0,
          textAlign: "left",
        }}
      >
        Reenviar código
      </button>
    </div>
  );
};

export default AuthCheckboxCard;
