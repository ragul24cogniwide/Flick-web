/**
 * The Flick for lovers logo: a white heart that is also a chat bubble, with a little spark.
 * Same drawing as the phone app's icon (Apptesting/assets/branding/logo-source.cjs).
 */
const HEART = 'M12 21s-7.5-4.7-9.6-9.4C.9 8.2 3 4.5 6.6 4.5c2.2 0 3.8 1.2 5.4 3.1 1.6-1.9 3.2-3.1 5.4-3.1 3.6 0 5.7 3.7 4.2 7.1C19.5 16.3 12 21 12 21z';
const TAIL = 'M5.6 15.0 L3.7 19.4 Q3.45 20.05 4.1 19.85 L8.9 17.75 Z';
const spark = (cx, cy, r) =>
  `M${cx} ${cy - r}Q${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy}Q${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r}Q${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy}Q${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r}Z`;

function Mark({ color = '#fff' }) {
  return (
    <g transform="translate(506 536) scale(30) translate(-12 -12.8)" fill={color}>
      <path d={HEART} />
      <path d={TAIL} />
      <path d={spark(21.2, 2.6, 1.9)} />
      <path d={spark(23.6, 6.2, 0.95)} opacity="0.85" />
    </g>
  );
}

/** The app icon: rose rounded square with the white heart. */
export function LogoTile({ size = 40, className = '' }) {
  return (
    <svg className={`logo-tile ${className}`} width={size} height={size} viewBox="0 0 1024 1024" role="img" aria-label="Flick">
      <defs>
        <linearGradient id="flick-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FB6F8E" />
          <stop offset="0.55" stopColor="#E11D48" />
          <stop offset="1" stopColor="#B0103A" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="230" fill="url(#flick-logo-g)" />
      <Mark />
    </svg>
  );
}

/** Just the heart (e.g. white on the rose band). */
export function HeartMark({ size = 40, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true">
      <Mark color={color} />
    </svg>
  );
}
