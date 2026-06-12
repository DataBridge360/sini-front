"use client";

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  SPANISH_MONTHS,
  SPANISH_WEEK_DAYS,
  buildCalendarDays,
  formatDateInput,
  parseIsoDate,
  toIsoDate
} from "@/lib/format";

export function DatePicker({
  name,
  value,
  onChange,
  placeholder = "dd/mm/yyyy",
  ariaLabel,
  required = false
}: {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  required?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const selectedDate = parseIsoDate(value);
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState<Date>(() => selectedDate ?? new Date());
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    primary: string;
    onPrimary: string;
  } | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    const margin = 12;
    const popoverHeight = popoverRef.current?.offsetHeight ?? 360;
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < popoverHeight + 12 && rect.top > spaceBelow;
    const top = openUp ? Math.max(margin, rect.top - popoverHeight - 8) : rect.bottom + 8;
    const styles = window.getComputedStyle(trigger);
    const primary = styles.getPropertyValue("--org-primary").trim() || "#176e64";
    const onPrimary = styles.getPropertyValue("--org-on-primary").trim() || "#ffffff";
    setCoords({ top, left, width, primary, onPrimary });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const handle = () => updatePosition();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const years = Array.from({ length: 31 }, (_, index) => year - 15 + index);
  const calendarDays = buildCalendarDays(viewDate);

  const selectDate = (date: Date) => {
    onChange(toIsoDate(date));
    setOpen(false);
  };

  return (
    <div className="sp-date-picker">
      {name ? <input type="hidden" name={name} value={value} aria-hidden="true" /> : null}
      <button
        ref={triggerRef}
        type="button"
        className={`sp-date-picker-trigger ${value ? "has-value" : ""}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        data-required={required ? "true" : undefined}
        onClick={() => {
          setViewDate(selectedDate ?? new Date());
          setOpen((current) => !current);
        }}
      >
        <CalendarDays size={15} />
        <span>{value ? formatDateInput(value) : placeholder}</span>
        <ChevronDown size={15} />
      </button>
      {open && coords
        ? createPortal(
            <div
              ref={popoverRef}
              className="sp-date-picker-popover is-floating"
              style={
                {
                  position: "fixed",
                  top: coords.top,
                  left: coords.left,
                  bottom: "auto",
                  width: coords.width,
                  "--org-primary": coords.primary,
                  "--org-on-primary": coords.onPrimary
                } as CSSProperties
              }
            >
              <div className="sp-date-picker-header">
                <button type="button" aria-label="Mes anterior" onClick={() => setViewDate(new Date(year, month - 1, 1))}>
                  <ChevronLeft size={16} />
                </button>
                <div className="sp-date-picker-selects">
                  <select
                    aria-label="Mes"
                    value={month}
                    onChange={(event) => setViewDate(new Date(year, Number(event.target.value), 1))}
                  >
                    {SPANISH_MONTHS.map((monthName, index) => (
                      <option key={monthName} value={index}>
                        {monthName}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Año"
                    value={year}
                    onChange={(event) => setViewDate(new Date(Number(event.target.value), month, 1))}
                  >
                    {years.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" aria-label="Mes siguiente" onClick={() => setViewDate(new Date(year, month + 1, 1))}>
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="sp-date-picker-weekdays">
                {SPANISH_WEEK_DAYS.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="sp-date-picker-grid">
                {calendarDays.map((date) => {
                  const isoDate = toIsoDate(date);
                  const isSelected = isoDate === value;
                  const isToday = isoDate === toIsoDate(new Date());
                  const isOutsideMonth = date.getMonth() !== month;

                  return (
                    <button
                      key={isoDate}
                      type="button"
                      className={`${isSelected ? "is-selected" : ""} ${isToday ? "is-today" : ""} ${isOutsideMonth ? "is-muted" : ""}`}
                      onClick={() => selectDate(date)}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

