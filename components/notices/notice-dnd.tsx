"use client";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode
} from "react";
import type { Notice } from "@/lib/api";
import { resolveNoticeDrop, type NoticeStatus } from "@/lib/notices";
import { useDeferRealtime } from "@/lib/realtime";

type ActiveDrag = { notices: Notice[]; from: NoticeStatus };

type NoticeDragState = {
  active: ActiveDrag | null;
  // True from the start of a drag until just after it ends: swallows the click
  // the browser may still fire on the card or on a button inside it.
  suppressClickRef: MutableRefObject<boolean>;
};

const NoticeDragContext = createContext<NoticeDragState | null>(null);

// Board drag and drop. Same library and visual language as the task board
// (dnd-kit, drop ring on the column, floating card while dragging), with one
// difference: the task board only has a mouse path (PointerSensor, tasks use
// tabs on mobile), so here touch gets its own sensor. A touch drag starts after
// a short press without moving; moving earlier is a normal scroll.
export function NoticeBoardDnd({
  children,
  renderOverlay,
  onDrop
}: {
  children: ReactNode;
  renderOverlay: (notices: Notice[]) => ReactNode;
  onDrop: (notices: Notice[], from: NoticeStatus, to: NoticeStatus) => void;
}) {
  const [active, setActive] = useState<ActiveDrag | null>(null);
  const suppressClickRef = useRef(false);
  const reducedMotion = usePrefersReducedMotion();

  // Hold realtime patches only while the card is in the pointer's hand, so it
  // cannot jump under it. Dialogs opened by the drop stay live.
  useDeferRealtime(active !== null);

  const sensors = useSensors(
    // 6px: a click still opens the detail and presses buttons, moving drags.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // 250ms press, 8px of tolerance: a swipe that starts moving scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const releaseClickGuard = () => {
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 50);
  };

  const handleDragStart = (event: DragStartEvent) => {
    suppressClickRef.current = true;
    const data = event.active.data.current as ActiveDrag | undefined;
    setActive(data ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dragged = active;
    setActive(null);
    releaseClickGuard();
    const to = event.over?.id as NoticeStatus | undefined;
    if (!dragged || !to) return;
    // Second key: invalid columns do not accept drops, but never trust only that.
    if (!resolveNoticeDrop(dragged.from, to, dragged.notices.length).valid) return;
    onDrop(dragged.notices, dragged.from, to);
  };

  return (
    <NoticeDragContext.Provider value={{ active, suppressClickRef }}>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActive(null);
          releaseClickGuard();
        }}
      >
        {children}
        <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
          {active ? <div className="sp-notice-drag-overlay">{renderOverlay(active.notices)}</div> : null}
        </DragOverlay>
      </DndContext>
    </NoticeDragContext.Provider>
  );
}

export function NoticeDropColumn({
  status,
  className,
  style,
  children
}: {
  status: NoticeStatus;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const state = useContext(NoticeDragContext);
  const active = state?.active ?? null;
  const isValidTarget = active ? resolveNoticeDrop(active.from, status, active.notices.length).valid : false;
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !isValidTarget });
  const dropState = !active || !isValidTarget ? undefined : isOver ? "on" : "ready";
  const isOwnColumn = active?.from === status;

  return (
    <section
      ref={setNodeRef}
      data-drop={dropState}
      className={`${className ?? ""} sp-task-column ${active && !isValidTarget && !isOwnColumn ? "opacity-45" : ""}`}
      style={style}
    >
      {children}
    </section>
  );
}

export function DraggableNotice({
  notices,
  from,
  disabled,
  children
}: {
  notices: Notice[];
  from: NoticeStatus;
  disabled: boolean;
  children: ReactNode;
}) {
  const state = useContext(NoticeDragContext);
  const data: ActiveDrag = { notices, from };
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: notices.map((notice) => notice.id).join("|"),
    data,
    disabled
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className={`sp-notice-draggable ${isDragging ? "opacity-40" : ""}`}
      // Capture phase: a drag must not fire the card's click or one of its buttons.
      onClickCapture={(event) => {
        if (!state?.suppressClickRef.current) return;
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      {children}
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}
