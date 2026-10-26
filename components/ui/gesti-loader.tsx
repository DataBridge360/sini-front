// Gesti "pensando": la nube gira alrededor de la cara, que se queda quieta,
// parpadea y flota apenas. Es vector para que se vea nítido desde 20px.
// Las animaciones viven en globals.css (bloque "Gesti loader") y respetan
// prefers-reduced-motion por la regla global.

const BUMPS = Array.from({ length: 10 }, (_, index) => {
  const angle = (index / 10) * Math.PI * 2;
  return { cx: 50 + Math.cos(angle) * 33, cy: 50 + Math.sin(angle) * 33 };
});

export function GestiLoader({ size = 28, label = "Gesti está pensando" }: { size?: number; label?: string }) {
  return (
    <span className="gesti-loader" role="status" aria-label={label} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="gesti-loader-cloud" cx="38%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#7cc4ff" />
            <stop offset="55%" stopColor="#2f9bf5" />
            <stop offset="100%" stopColor="#1677e0" />
          </radialGradient>
        </defs>
        <g className="gesti-loader-cloud">
          <circle cx="50" cy="50" r="36" fill="url(#gesti-loader-cloud)" />
          {BUMPS.map((bump, index) => (
            <circle key={index} cx={bump.cx} cy={bump.cy} r="14" fill="url(#gesti-loader-cloud)" />
          ))}
        </g>
        <g className="gesti-loader-face">
          <rect x="25" y="31" width="50" height="39" rx="16" fill="#ffffff" />
          <g className="gesti-loader-eyes">
            <ellipse cx="39.5" cy="47" rx="5" ry="6" fill="#0d2a5c" />
            <ellipse cx="60.5" cy="47" rx="5" ry="6" fill="#0d2a5c" />
            <circle cx="41" cy="45" r="1.8" fill="#ffffff" />
            <circle cx="62" cy="45" r="1.8" fill="#ffffff" />
          </g>
          <path d="M44 57.5h12a6 6 0 0 1-12 0Z" fill="#0d2a5c" />
          <path d="M46.4 61.6a4 2.4 0 0 1 7.2 0 6 6 0 0 1-7.2 0Z" fill="#2f9bf5" />
        </g>
      </svg>
    </span>
  );
}
