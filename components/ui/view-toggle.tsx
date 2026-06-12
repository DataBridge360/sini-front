"use client";

import { LayoutGrid, List } from "lucide-react";

export function ViewToggle<T extends string>({
  leftLabel,
  rightLabel,
  value,
  leftValue,
  rightValue,
  onChange
}: {
  leftLabel: string;
  rightLabel: string;
  value: T;
  leftValue: T;
  rightValue: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="sp-view-toggle">
      <button className={value === leftValue ? "active" : ""} type="button" onClick={() => onChange(leftValue)}>
        <LayoutGrid size={13} />
        {leftLabel}
      </button>
      <button className={value === rightValue ? "active" : ""} type="button" onClick={() => onChange(rightValue)}>
        <List size={13} />
        {rightLabel}
      </button>
    </div>
  );
}
