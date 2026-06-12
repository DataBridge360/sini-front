"use client";

import { Plus, Search } from "lucide-react";
import type { ReactNode } from "react";
import type { EntityView } from "@/lib/shell-types";
import { ViewToggle } from "@/components/ui/view-toggle";

export function EntityToolbar({
  search,
  setSearch,
  count,
  total,
  view,
  setView,
  placeholder,
  actionLabel,
  onAction,
  children
}: {
  search: string;
  setSearch: (value: string) => void;
  count: number;
  total: number;
  view: EntityView;
  setView: (view: EntityView) => void;
  placeholder: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="sp-entity-toolbar">
      <div className="sp-search">
        <Search size={15} />
        <input placeholder={placeholder} value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {children}
      <span>{count} de {total}</span>
      <ViewToggle
        leftLabel="Grid"
        rightLabel="Lista"
        value={view}
        leftValue="grid"
        rightValue="list"
        onChange={setView}
      />
      {actionLabel && onAction ? (
        <button className="sp-primary-action" type="button" onClick={onAction}>
          <Plus size={14} />
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
