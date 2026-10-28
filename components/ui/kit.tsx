"use client";

import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, type HTMLMotionProps } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Xmark } from "./icons";

/** Apple-feel springs: quick, critically damped for UI; softer with a hint of bounce for reveals. */
export const spring = { type: "spring", stiffness: 420, damping: 36, mass: 0.9 } as const;
export const springSoft = { type: "spring", stiffness: 220, damping: 26, mass: 1 } as const;
export const fadeUp = {
  initial: { opacity: 0, y: 13 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: springSoft,
};

/** Cursor-following spotlight: sets --mx/--my for the `.spotlight` CSS layer. */
export function spotlight(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}

type BtnProps = HTMLMotionProps<"button"> & { variant?: "primary" | "plain" | "danger" | "default"; size?: "small" | "large"; magnetic?: boolean };

/** Button with press feedback; `magnetic` gently leans toward the cursor (≤ 5px). */
export function Button({ variant = "default", size, magnetic, className = "", children, ...p }: BtnProps) {
  const reduce = useReducedMotion();
  const x = useSpring(useMotionValue(0), { stiffness: 300, damping: 20 });
  const y = useSpring(useMotionValue(0), { stiffness: 300, damping: 20 });
  const cls = ["btn", variant !== "default" ? variant : "", size ?? "", className].filter(Boolean).join(" ");
  return (
    <motion.button
      className={cls}
      style={magnetic && !reduce ? { x, y } : undefined}
      whileTap={p.disabled ? undefined : { scale: 0.965 }}
      transition={spring}
      onPointerMove={(e) => {
        if (!magnetic || reduce) return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set(((e.clientX - r.left) / r.width - 0.5) * 10);
        y.set(((e.clientY - r.top) / r.height - 0.5) * 8);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
      {...p}
    >
      {children}
    </motion.button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  const id = useId();
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={`seg-${id}`} className="thumb" transition={spring} />}
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
      style={{ width: 51, height: 31, borderRadius: 99, border: 0, padding: 2, cursor: "pointer", background: on ? "var(--green)" : "var(--fill-strong)", display: "flex", justifyContent: on ? "flex-end" : "flex-start", transition: "background .25s" }}
    >
      <motion.span layout transition={spring} style={{ width: 27, height: 27, borderRadius: 99, background: "#fff", boxShadow: "0 3px 8px rgba(0,0,0,.15), 0 1px 1px rgba(0,0,0,.16)" }} />
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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const pos = align === "end" ? { right: 0 } : align === "center" ? { left: "50%", x: "-50%" } : { left: 0 };
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {trigger(open, () => setOpen((o) => !o))}
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu"
            role="menu"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
            transition={spring}
            style={{ top: "calc(100% + 6px)", transformOrigin: align === "end" ? "top right" : "top left", width, ...pos }}
          >
            {children(close)}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

export function MenuItem({ title, subtitle, checked, onSelect }: { title: ReactNode; subtitle?: ReactNode; checked?: boolean; onSelect: () => void }) {
  return (
    <button className="menu-item" role="menuitemradio" aria-checked={checked} onClick={onSelect}>
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

/** Bottom sheet with a spring and drag-to-dismiss. */
export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
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
            <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
            <motion.div
              className="sheet"
              role="dialog"
              aria-modal="true"
              aria-label={label}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => (info.offset.y > 120 || info.velocity.y > 600) && onClose()}
            >
              <div className="sheet-grabber" />
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
            <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div className="dialog" role="dialog" aria-modal="true" aria-label={label} initial={{ opacity: 0, scale: 0.96, x: "-50%", y: "-48%" }} animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }} exit={{ opacity: 0, scale: 0.98, x: "-50%", y: "-50%" }} transition={spring}>
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

/** Collapsible section with an animated height. */
export function Disclosure({ title, children, defaultOpen = false, right }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="spread">
        <button className="btn plain" onClick={() => setOpen(!open)} aria-expanded={open} style={{ paddingLeft: 0 }}>
          {title}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} style={{ display: "inline-flex" }}>
            <ChevronDown size={14} />
          </motion.span>
        </button>
        {right}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={springSoft} style={{ overflow: "hidden" }}>
            <div style={{ paddingTop: 8 }}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Staggered fade-up for lists that appear. */
export function Reveal({ children, i = 0, as = "div", className }: { children: ReactNode; i?: number; as?: "div" | "li" | "section"; className?: string }) {
  const M = motion[as];
  return (
    <M className={className} initial={{ opacity: 0, y: 13 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springSoft, delay: Math.min(i, 12) * 0.045 }}>
      {children}
    </M>
  );
}
