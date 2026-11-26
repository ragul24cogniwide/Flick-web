/**
 * Love signals over the page (lib/love.js), same as the phone app: hearts rise for "Thinking of
 * you", 💋 for a kiss, flowers for good morning, stars fall for good night, a hug squeezes and bursts
 * hearts outwards. Also floating hearts for a love reaction to my message. Clicks pass through.
 */
import { useEffect, useState } from 'react';
import { LOVE_SIGNALS, onLoveBurst } from '../lib/love';

const COUNT = 16;

function makeParticles(motion, emojis) {
  return Array.from({ length: COUNT }, (_, i) => {
    const base = { key: i, emoji: emojis[i % emojis.length], size: 22 + Math.random() * 20 };
    if (motion === 'hug') {
      const angle = (i / COUNT) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 120 + Math.random() * 140;
      return { ...base, delay: 0.45 + Math.random() * 0.2, duration: 1.5 + Math.random() * 0.7, dx: Math.round(Math.cos(angle) * dist), dy: Math.round(Math.sin(angle) * dist) };
    }
    return {
      ...base,
      left: `${2 + Math.random() * 92}%`,
      delay: Math.random() * (motion === 'down' ? 0.9 : 0.6),
      duration: (motion === 'down' ? 2.6 : 2) + Math.random() * 1.2,
      dx: Math.round((Math.random() - 0.5) * 70),
      rise: Math.round(55 + Math.random() * 35),
    };
  });
}

export default function LoveBurst() {
  const [burst, setBurst] = useState(null);

  useEffect(() => {
    let timer;
    const off = onLoveBurst(({ kind, name, signal, particles, at }) => {
      const def = LOVE_SIGNALS[signal] || LOVE_SIGNALS.thinking;
      const motion = kind === 'reaction' ? 'up' : def.motion;
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      setBurst({ id: at, kind, name, def, motion, particles: calm ? [] : makeParticles(motion, particles || def.particles) });
      clearTimeout(timer);
      timer = setTimeout(() => setBurst(null), motion === 'down' ? 4600 : 3800);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  if (!burst) return null;
  const { def, motion } = burst;
  return (
    <div className={`love-burst motion-${motion}`} key={burst.id} aria-live="polite">
      {burst.particles.map((p) => (
        <span
          key={p.key}
          className="love-heart"
          style={{
            ...(p.left ? { left: p.left } : {}),
            fontSize: `${p.size}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--drift': `${p.dx}px`,
            '--dx': `${p.dx}px`,
            '--dy': `${p.dy || 0}px`,
            '--rise': `${p.rise || 0}vh`,
          }}
        >
          {p.emoji}
        </span>
      ))}
      {burst.kind === 'received' && (
        <div className={`love-card${motion === 'down' ? ' night' : ''}${motion === 'hug' ? ' hug' : ''}`} role="status">
          <span className="love-card-emoji">{def.emoji}</span>
          <span>{burst.name ? def.from(burst.name) : def.title}</span>
        </div>
      )}
    </div>
  );
}
