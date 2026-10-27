// Isotipo de la marca: el cubo isométrico del logo, redibujado en vector con
// grosores y ángulos parejos. Es el mismo dibujo que app/icon.svg (favicon).

export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="-420 -420 840 840"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M-332.6-192 0-384l200 115.5-88 50.8L0-282.4l-200.6 115.8L0-50.8l288.6-166.6 44 25.4v384L132.5 307.5V205.9l112.1-64.7V-90.4L0 50.8l-332.6-192Z" />
      <path d="m-332.6-32 88 50.8v122.4L88 333.2 0 384l-332.6-192Z" />
    </svg>
  );
}
