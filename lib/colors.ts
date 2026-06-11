// Theming por organización: colores de marca y derivados (CSS vars).

import type { CSSProperties } from "react";

export function organizationThemeStyle({
  primaryColor,
  secondaryColor
}: {
  primaryColor: string | null;
  secondaryColor: string | null;
}) {
  const primary = normalizeHexColor(primaryColor) ?? "#176e64";
  const secondary = normalizeHexColor(secondaryColor) ?? "#64748b";
  return {
    "--org-primary": primary,
    "--org-primary-soft": hexToRgba(primary, 0.1),
    "--org-primary-muted": hexToRgba(primary, 0.18),
    "--org-secondary": secondary,
    "--org-secondary-soft": hexToRgba(secondary, 0.18),
    "--org-on-primary": contrastColor(primary),
    "--sp-accent": primary,
    "--sp-accent-soft": hexToRgba(primary, 0.1),
    "--sp-sidebar-bg": `color-mix(in srgb, ${primary} 68%, #111827)`,
    "--sp-sidebar-active": hexToRgba(secondary, 0.12),
    "--sp-sidebar-accent": secondary
  } as CSSProperties;
}

export function normalizeHexColor(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : null;
}

export function isHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

export function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function contrastColor(hex: string) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? "#10201f" : "#ffffff";
}

