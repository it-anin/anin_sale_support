import { useState, useRef, useMemo } from 'react';
import { PROFILES, type Profile } from './auth';
import { AnimatedLogoText } from './AnimatedLogo';

interface Props {
  onLogin: (profile: Profile) => void;
}

export function LoginPage({ onLogin }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const pwRef = useRef<HTMLInputElement>(null);

  // ฟองฟ้าลอยขึ้นพื้นหลัง (Bubble Rise) — สุ่มตำแหน่ง/ขนาด/ความเร็วครั้งเดียว
  const bubbles = useMemo(
    () => Array.from({ length: 14 }, () => ({
      size: 10 + Math.random() * 30,
      left: Math.random() * 100,
      duration: 6 + Math.random() * 6,
      delay: -Math.random() * 9,
    })),
    [],
  );

  const submit = () => {
    const profile = PROFILES.find(p => p.password === password);
    if (profile) {
      onLogin(profile);
    } else {
      setError('รหัสผ่านไม่ถูกต้อง');
      setPassword('');
      pwRef.current?.focus();
    }
  };

  return (
    <div className="login-page">
      <div className="login-bubbles" aria-hidden="true">
        {bubbles.map((b, i) => (
          <span
            key={i}
            className="login-bubble"
            style={{
              width: `${b.size}px`,
              height: `${b.size}px`,
              left: `${b.left}%`,
              animationDuration: `${b.duration}s`,
              animationDelay: `${b.delay}s`,
            }}
          />
        ))}
      </div>
      <div className="login-card">
        <img src="/anincolor.png" alt="ANIN" className="login-brand-logo" />
        <h1 className="logo-premium login-logo"><AnimatedLogoText text="SALE SUPPORT" /></h1>
        <p className="login-sub">ใส่รหัสผ่านเพื่อเข้าใช้งาน</p>

        <div className="login-pw-row">
          <input
            ref={pwRef}
            type="password"
            className="login-pw-input"
            placeholder="รหัสผ่าน"
            value={password}
            autoFocus
            onChange={e => { setPassword(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          />
          <button className="login-btn" onClick={submit}>
            เข้าสู่ระบบ
          </button>
        </div>
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}
