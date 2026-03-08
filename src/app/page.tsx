export default function HomePage() {
  return (
    <main style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      fontFamily: 'sans-serif',
      background: '#f9fafb',
      padding: '24px',
      textAlign: 'center',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '16px',
        padding: '40px 32px',
        maxWidth: '420px',
        width: '100%',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        <img src="/logo.png" alt="Agente Móbile" style={{ width: '64px', height: '64px', objectFit: 'contain', marginBottom: '16px' }} />
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
          Agente Móbile
        </h1>
        <p style={{ color: '#64748b', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>
          Para acessar o agente, adicione o endereço do seu estabelecimento na URL.
        </p>

        <div style={{
          background: '#f1f5f9',
          borderRadius: '8px',
          padding: '12px 16px',
          fontSize: '13px',
          color: '#475569',
          marginBottom: '24px',
          textAlign: 'left',
        }}>
          <strong style={{ display: 'block', marginBottom: '4px', color: '#0f172a' }}>Exemplo:</strong>
          <code style={{ color: '#3632f8' }}>seudominio.com/<strong>nome-do-estabelecimento</strong></code>
        </div>

        <div style={{
          borderTop: '1px solid #e5e7eb',
          paddingTop: '20px',
        }}>
          <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>
            🧪 <strong>Está testando?</strong> Acesse diretamente:
          </p>
          <a
            href="/estabelecimento-teste"
            style={{
              display: 'inline-block',
              background: '#3632f8',
              color: '#fff',
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            /estabelecimento-teste
          </a>
        </div>
      </div>
    </main>
  );
}
