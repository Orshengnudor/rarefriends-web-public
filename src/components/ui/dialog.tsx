"use client";


import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import { IconButton } from "./icon-button";

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");
/* Open dialogs, oldest first. Only the topmost one answers Escape and holds focus. */
const dialogStack: RefObject<HTMLDivElement | null>[] = [];
/* The page's own overflow, read once when the stack opens. Reading it per dialog left the page
   unscrollable: a dialog opened over another one captures "hidden", and restoring that value
   when it closes last locks the page. */
let pageOverflow = "";

/* A dialog opened over another one paints above it, whatever the DOM order of the two hosts.
   Re-run on every open and close: an offset measured once outlives the dialogs it was measured
   against, so a dialog left alone after the one below it closes keeps painting at depth. */
function restack() {
  dialogStack.forEach((host, depth) => {
    if (host.current) host.current.style.zIndex = `calc(var(--z-overlay) + ${depth})`;
  });
}

type DialogProps = {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  width?: number | string;
  closeOnBackdrop?: boolean;
};

export function Dialog({
  open,
  title,
  children,
  actions,
  onClose,
  width = 480,
  closeOnBackdrop = true,
}: DialogProps) {
  const titleId = useId();
  const back = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    dialogStack.push(back);
    restack();
    const topmost = () => dialogStack[dialogStack.length - 1] === back;
    const opener = document.activeElement as HTMLElement | null;
    if (dialogStack.length === 1) {
      pageOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    box.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!topmost() || !box.current) return;
      if (event.key === "Escape") {
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const stops = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const at = document.activeElement;
      /* the dialog box itself counts as "before the first stop", so shift+tab wraps to the last */
      const edge = event.shiftKey ? at === stops[0] || at === box.current : at === stops[stops.length - 1];
      if (!stops.length || edge || !box.current.contains(at)) {
        event.preventDefault();
        ((event.shiftKey ? stops[stops.length - 1] : stops[0]) ?? box.current).focus();
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      if (topmost() && box.current && !box.current.contains(event.target as Node)) box.current.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      const at = dialogStack.indexOf(back);
      if (at > -1) dialogStack.splice(at, 1);
      restack();
      if (!dialogStack.length) document.body.style.overflow = pageOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  function handleBackdropMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (closeOnBackdrop && event.target === event.currentTarget) onClose();
  }

  if (!open) return null;

  return (
    <div ref={back} className="rf-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className="rf-dialog"
        style={{ width }}
      >
        <div className="rf-dialog-title">
          <span id={titleId}>{title}</span>
          <span data-theme="invert">
            <IconButton icon="close" label="close" variant="ghost" size="sm" onClick={onClose} />
          </span>
        </div>
        <div className="rf-dialog-body">{children}</div>
        {actions ? <div className="rf-dialog-foot">{actions}</div> : null}
      </div>
    </div>
  );
}
