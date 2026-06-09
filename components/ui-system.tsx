import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger";
type BadgeTone = "slate" | "blue" | "emerald" | "amber" | "red";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "sp-ui-button primary",
  secondary: "sp-ui-button secondary",
  danger: "sp-ui-button danger"
};

const badgeTones: Record<BadgeTone, string> = {
  slate: "sp-ui-badge slate",
  blue: "sp-ui-badge blue",
  emerald: "sp-ui-badge emerald",
  amber: "sp-ui-badge amber",
  red: "sp-ui-badge red"
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={`${buttonVariants[variant]} ${className}`.trim()} {...props} />;
}

export function Input({ label, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const control = <input className={`sp-ui-input ${className}`.trim()} {...props} />;
  if (!label) return control;
  return (
    <label className="sp-ui-field">
      <span>{label}</span>
      {control}
    </label>
  );
}

export function Select({
  label,
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const control = <select className={`sp-ui-input ${className}`.trim()} {...props}>{children}</select>;
  if (!label) return control;
  return (
    <label className="sp-ui-field">
      <span>{label}</span>
      {control}
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`sp-ui-card ${className}`.trim()}>{children}</section>;
}

export function Badge({
  children,
  tone = "slate"
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return <span className={badgeTones[tone]}>{children}</span>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="sp-ui-page-header">
      <div>
        {eyebrow ? <span>{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <table className={`sp-ui-table ${className}`.trim()}>{children}</table>;
}
