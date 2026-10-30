"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Xmark } from "./icons";

/**
 * Calm by design: nothing moves. Things that appear fade in once, briefly; MotionConfig
 * (Shell) turns off movement everywhere, so springs, slides and scales never run.
 */
export const fade = { duration: 0.15, ease: "easeOut" } as const;

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "plain" | "danger" | "default"; size?: "small" | "large" };

export function Button({ variant = "default", size, className = "", children, ...p }: BtnProps) {
  const cls = ["btn", variant !== "default" ? variant : "", size ?? "", className].filter(Boolean).join(" ");
  return (
    <button className={cls} {...p}>
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.value === value && <span className="thumb" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{ width: 51, height: 31, borderRadius: 99, border: 0, padding: 2, cursor: "pointer", background: on ? "var(--green)" : "var(--fill-strong)", display: "flex", justifyContent: on ? "flex-end" : "flex-start" }}
    >
      <span style={{ width: 27, height: 27, borderRadius: 99, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
    </button>
  );
}

/** Anchored popover menu (closes on outside click / Escape). */
export function Popover({ trigger, children, align = "start", width }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "start" | "end" | "center"; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    // Escape closes the menu only, not the sheet or dialog it sits in: catch it first and stop it there.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const pos = align === "end" ? { right: 0 } : align === "center" ? { left: "50%", translate: "-50% 0" } : { left: 0 };
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {trigger(open, () => setOpen((o) => !o))}
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu"
            role="menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
            style={{ top: "calc(100% + 6px)", width, ...pos }}
          >
            {children(close)}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

export function MenuItem({ title, subtitle, checked, disabled, onSelect }: { title: ReactNode; subtitle?: ReactNode; checked?: boolean; disabled?: boolean; onSelect: () => void }) {
  return (
    <button className="menu-item" role="menuitemradio" aria-checked={checked} disabled={disabled} onClick={onSelect}>
      <span className="check">{checked ? <Check size={14} /> : null}</span>
      <span>
        {title}
        {subtitle && <span className="menu-sub">{subtitle}</span>}
      </span>
    </button>
  );
}

function Portal({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.body), []);
  return el ? createPortal(children, el) : null;
}

/** Bottom sheet; closes with its own button, Escape or the scrim. */
export function Sheet({ open, onClose, children, label, className }: { open: boolean; onClose: () => void; children: ReactNode; label: string; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} />
            <motion.div className={`sheet${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-label={label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
              {children}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </Portal>
  );
}

export function Dialog({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} />
            <motion.div className="dialog" role="dialog" aria-modal="true" aria-label={label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} style={{ translate: "-50% -50%" }}>
              <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ position: "absolute", right: 10, top: 10 }}>
                <Xmark size={16} />
              </button>
              {children}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </Portal>
  );
}

/** Collapsible section. */
export function Disclosure({ title, children, defaultOpen = false, right }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="spread">
        <button className="btn plain" onClick={() => setOpen(!open)} aria-expanded={open} style={{ paddingLeft: 0 }}>
          {title}
          <span style={{ display: "inline-flex", rotate: open ? "180deg" : "0deg" }}>
            <ChevronDown size={14} />
          </span>
        </button>
        {right}
      </div>
      {open && <div style={{ paddingTop: 8 }}>{children}</div>}
    </div>
  );
}

/** A list item that simply appears (kept as a seam; lists no longer stagger in). */
export function Reveal({ children, as: Tag = "div", className }: { children: ReactNode; i?: number; as?: "div" | "li" | "section"; className?: string }) {
  return <Tag className={className}>{children}</Tag>;
}
