const SplashScreen = () => {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--app-page-background)', color: '#FFFFFF', padding: 24 }}>
      <style>
        {`
          @keyframes medicoinsGlow {
            0%, 100% { transform: scale(1); box-shadow: 0 0 0 rgba(212,175,55,0.22), 0 18px 42px rgba(0,0,0,0.25); }
            50% { transform: scale(1.035); box-shadow: 0 0 44px rgba(212,175,55,0.42), 0 22px 48px rgba(0,0,0,0.30); }
          }
          @keyframes medicoinsDots {
            0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
            40% { opacity: 1; transform: translateY(-4px); }
          }
        `}
      </style>
      <div style={{ textAlign: 'center', width: '100%', maxWidth: 360 }}>
        <div style={{ width: 132, height: 132, margin: '0 auto 22px', borderRadius: 34, background: 'rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center', animation: 'medicoinsGlow 1.45s ease-in-out infinite' }}>
          <img src="/icons/icon-512.png" alt="COINS" style={{ width: 112, height: 112, borderRadius: 28, objectFit: 'cover' }} />
        </div>
        <div style={{ color: '#F6C343', fontSize: 13, fontWeight: 900, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>Partner Coin Rewards</div>
        <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.08 }}>COINS</div>
        <div style={{ color: '#DDE6F2', marginTop: 10, fontSize: 15, fontWeight: 700 }}>Earn coins. Unlock rewards.</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 7, marginTop: 24 }}>
          {[0, 1, 2].map((dot) => (
            <span key={dot} style={{ width: 8, height: 8, borderRadius: '50%', background: '#F6C343', animation: `medicoinsDots 1.2s ease-in-out ${dot * 0.16}s infinite` }} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;
