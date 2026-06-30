import { useEffect, useMemo, useRef, useState } from 'react';
import site from '../config/siteConfig';
import Icon from './Icon';

export default function Intro({ onEnter }) {
  const [phase, setPhase] = useState('boot');
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const startY = useRef(null);

  const firstName = useMemo(() => site.name.split(' ')[0].toLowerCase(), []);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('reveal'), 320);
    const t2 = setTimeout(() => setPhase('ready'), 1420);
    const t3 = setTimeout(() => setReady(true), 1650);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const enter = () => {
    if (!ready || leaving) return;
    setLeaving(true);
    setTimeout(onEnter, 900);
  };

  return (
    <div
      onClick={enter}
      onWheel={(e) => e.deltaY < -8 && enter()}
      onTouchStart={(e) => (startY.current = e.touches[0].clientY)}
      onTouchEnd={(e) => {
        if (startY.current != null && startY.current - e.changedTouches[0].clientY > 40) enter();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        overflow: 'hidden',
        background:
          'radial-gradient(circle at 50% 26%, rgba(74,217,255,0.12), transparent 26%), radial-gradient(circle at 50% 68%, rgba(124,108,255,0.18), transparent 36%), #06070a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        transform: leaving ? 'translateY(-100%) scale(1.04)' : 'translateY(0) scale(1)',
        opacity: leaving ? 0 : 1,
        transition: 'transform 0.9s cubic-bezier(.7,0,.2,1), opacity 0.9s ease',
        cursor: ready ? 'pointer' : 'default',
        touchAction: 'none',
      }}
    >
      <style>{`
        @keyframes introPulse {
          0%,100% { transform: scale(1); opacity: .55; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        @keyframes introGridFloat {
          0% { transform: translateY(0px); opacity: .18; }
          50% { transform: translateY(-10px); opacity: .28; }
          100% { transform: translateY(0px); opacity: .18; }
        }
        @keyframes introLineGrow {
          from { transform: scaleX(0); opacity: .1; }
          to { transform: scaleX(1); opacity: 1; }
        }
        @keyframes introBadgeIn {
          from { opacity: 0; transform: translateY(14px) scale(.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes introTitleIn {
          0% { opacity: 0; transform: translateY(26px) scale(.96); letter-spacing: .18em; filter: blur(10px); }
          100% { opacity: 1; transform: translateY(0) scale(1); letter-spacing: 0.02em; filter: blur(0); }
        }
        @keyframes introSubIn {
          from { opacity: 0; transform: translateY(18px); filter: blur(8px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        @keyframes introChevron {
          0%,100% { opacity: .22; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-7px); }
        }
        .intro-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px);
          background-size: 44px 44px;
          mask-image: radial-gradient(circle at 50% 42%, black 34%, transparent 78%);
          animation: introGridFloat 8s ease-in-out infinite;
        }
        .intro-noise {
          position: absolute;
          inset: -20%;
          background:
            radial-gradient(circle at 20% 20%, rgba(255,255,255,0.045), transparent 18%),
            radial-gradient(circle at 80% 30%, rgba(74,217,255,0.055), transparent 20%),
            radial-gradient(circle at 50% 80%, rgba(124,108,255,0.08), transparent 22%);
          filter: blur(30px);
          opacity: .9;
        }
        .intro-ring {
          position: absolute;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.02) inset;
          animation: introPulse 4.5s ease-in-out infinite;
        }
        .intro-chevron i {
          display: block;
          width: 14px;
          height: 14px;
          border-left: 2px solid rgba(74,217,255,0.9);
          border-top: 2px solid rgba(74,217,255,0.9);
          transform: rotate(45deg);
          margin: -4px auto 0;
          animation: introChevron 1.4s ease-in-out infinite;
        }
        .intro-chevron i:nth-child(2) { animation-delay: .16s; }
        .intro-chevron i:nth-child(3) { animation-delay: .32s; }
      `}</style>

      <div className="intro-noise" />
      <div className="intro-grid" />
      <div
        className="intro-ring"
        style={{
          width: 'min(72vw, 640px)',
          height: 'min(72vw, 640px)',
          opacity: phase === 'boot' ? 0.15 : 0.45,
        }}
      />
      <div
        className="intro-ring"
        style={{
          width: 'min(54vw, 460px)',
          height: 'min(54vw, 460px)',
          animationDelay: '.35s',
          opacity: phase === 'boot' ? 0.08 : 0.28,
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 28,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 16px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(15,16,22,0.5)',
            backdropFilter: 'blur(20px) saturate(180%)',
            color: 'var(--muted)',
            fontFamily: 'JetBrains Mono',
            fontSize: 11,
            letterSpacing: 2.6,
            textTransform: 'uppercase',
            opacity: phase === 'boot' ? 0 : 1,
            transform: phase === 'boot' ? 'translateY(-12px)' : 'translateY(0)',
            transition: 'all .65s ease',
            animation: phase !== 'boot' ? 'introBadgeIn .75s cubic-bezier(.2,.8,.2,1)' : 'none',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: 'linear-gradient(135deg, #00f2fe, #4facfe)',
              boxShadow: '0 0 18px rgba(74,217,255,0.75)',
            }}
          />
          digital presence initialized
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: '0 22px',
          width: '100%',
          maxWidth: 920,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--muted)',
            fontFamily: 'JetBrains Mono',
            fontSize: 11,
            letterSpacing: 3,
            textTransform: 'uppercase',
            opacity: phase === 'boot' ? 0 : 1,
            transform: phase === 'boot' ? 'translateY(10px)' : 'translateY(0)',
            transition: 'all .65s ease .08s',
          }}
        >
          <Icon name="deployed_code" size={16} />
          designed by yatin
        </div>

        <div
          style={{
            marginTop: 18,
            fontSize: 'clamp(58px, 14vw, 152px)',
            fontWeight: 900,
            lineHeight: 0.92,
            color: 'var(--ink)',
            textShadow: '0 0 40px rgba(255,255,255,0.04)',
            opacity: phase === 'boot' ? 0 : 1,
            animation: phase !== 'boot' ? 'introTitleIn .9s cubic-bezier(.2,.8,.2,1)' : 'none',
          }}
        >
          {firstName}
          <span style={{ color: 'var(--accent2)' }}>.</span>
        </div>

        <div
          style={{
            width: 'min(240px, 52vw)',
            height: 1,
            marginTop: 22,
            transformOrigin: 'center',
            background: 'linear-gradient(90deg, transparent, rgba(74,217,255,0.95), rgba(124,108,255,0.95), transparent)',
            boxShadow: '0 0 24px rgba(74,217,255,0.25)',
            opacity: phase === 'boot' ? 0 : 1,
            animation: phase !== 'boot' ? 'introLineGrow .95s cubic-bezier(.2,.8,.2,1)' : 'none',
          }}
        />

        <div
          style={{
            marginTop: 18,
            fontSize: 'clamp(13px, 2vw, 15px)',
            lineHeight: 1.8,
            letterSpacing: 0.5,
            color: 'var(--muted)',
            maxWidth: 620,
            opacity: phase === 'ready' ? 1 : 0,
            animation: phase === 'ready' ? 'introSubIn .7s ease' : 'none',
          }}
        >
          Full-stack web developer crafting dense interfaces, interactive widgets, and polished frontend experiences.
        </div>

        {!ready ? (
          <div className="eq playing" style={{ display: 'flex', gap: 5, marginTop: 40, color: 'var(--accent)' }}>
            <span /><span /><span /><span /><span />
          </div>
        ) : (
          <div style={{ marginTop: 42, textAlign: 'center', animation: 'introSubIn .65s ease' }}>
            <div className="intro-chevron"><i /><i /><i /></div>
            <div
              style={{
                marginTop: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.045)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'var(--muted)',
                fontFamily: 'JetBrains Mono',
                fontSize: 11,
                letterSpacing: 2.4,
                textTransform: 'uppercase',
              }}
            >
              <Icon name="touch_app" size={15} />
              swipe up or tap to enter
            </div>
          </div>
        )}
      </div>
    </div>
  );
}