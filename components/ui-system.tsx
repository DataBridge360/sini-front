import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`sp-ui-card ${className}`.trim()}>{children}</section>;
}

export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <table className={`sp-ui-table ${className}`.trim()}>{children}</table>;
}
