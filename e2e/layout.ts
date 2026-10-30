import type { Page } from "@playwright/test";

/**
 * What's wrong with the screen as it is: the page scrolling sideways, a control running off the
 * screen or hidden under another, text cut off without an ellipsis, a fixed page (the player)
 * that doesn't fit, and on touch screens targets too small for a finger and fields Safari would
 * zoom into. Controls under an open sheet or menu are skipped: they're meant to be covered.
 */
export async function layoutIssues(page: Page, touch: boolean): Promise<string[]> {
  return page.evaluate((touch) => {
    const W = innerWidth;
    const H = innerHeight;
    const out: string[] = [];
    const name = (el: Element) => {
      const h = el as HTMLElement;
      const t = (h.getAttribute("aria-label") || h.innerText || (h as HTMLInputElement).placeholder || "").trim().replace(/\s+/g, " ").slice(0, 32);
      return `${el.tagName.toLowerCase()}${h.className && typeof h.className === "string" ? "." + h.className.split(" ")[0] : ""} "${t}"`;
    };
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
    };
    /** The nearest ancestor that clips or scrolls, if any. */
    const clipper = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/hidden|auto|scroll|clip/.test(s.overflowX + s.overflowY)) return p;
      }
      return null;
    };

    if (document.documentElement.scrollWidth > W + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);

    // The topmost layer: an open menu, else an open sheet, else the page.
    // A sheet still fading in already owns the screen.
    const layers = [...document.querySelectorAll(".menu, [role=dialog]")].filter((el) => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0);
    const top = layers.at(-1) ?? document.body;
    const controls = [...top.querySelectorAll("button, a[href], input, select, textarea, [role=slider], [role=switch]")].filter(shown);

    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const box = clipper(el);
      const b = box?.getBoundingClientRect();
      // Inside a scroller, only what is scrolled into view counts.
      const view = b ? { left: Math.max(0, b.left), right: Math.min(W, b.right), top: Math.max(0, b.top), bottom: Math.min(H, b.bottom) } : { left: 0, right: W, top: 0, bottom: H };
      if (!box && (r.right > W + 1 || r.left < -1)) out.push(`off screen: ${name(el)} at x ${Math.round(r.left)}–${Math.round(r.right)}`);
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const inView = cx > view.left && cx < view.right && cy > view.top && cy < view.bottom;
      // Fixed chrome (the header, the mini player) passes over a page as it scrolls by design; a page's
      // own padding lets its last control scroll clear of it, checked below. Visually hidden inputs don't count.
      const fixedChrome = (h: Element) => Boolean((h as HTMLElement).closest?.(".bar, .mini"));
      if (inView && (el as HTMLButtonElement).disabled !== true && r.width > 2 && r.height > 2) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit && !el.contains(hit) && !hit.contains(el) && !fixedChrome(hit) && !(hit as HTMLElement).closest?.("label")?.contains(el)) out.push(`covered: ${name(el)} by ${name(hit)}`);
      }
      if (touch && inView && el.tagName !== "INPUT" && !(el as HTMLElement).closest("p, li .caption, .t-window, .kv") && Math.min(r.width, r.height) < 28) out.push(`small target: ${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (touch && /INPUT|TEXTAREA|SELECT/.test(el.tagName) && parseFloat(getComputedStyle(el).fontSize) < 16) out.push(`Safari zooms into: ${name(el)} (${getComputedStyle(el).fontSize})`);
    }

    // Text cut off without an ellipsis.
    for (const el of top.querySelectorAll<HTMLElement>("h1, h2, h3, p, span, button, dd, dt, li, .caption, .headline")) {
      if (!shown(el) || !el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
      const s = getComputedStyle(el);
      if (s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none" && s.webkitLineClamp !== "") continue;
      if (/hidden|clip/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 2) out.push(`text cut: ${name(el)}`);
    }

    // A fixed page must fit: the player's transport stays on screen.
    for (const el of top.querySelectorAll(".np-foot, .np-head")) {
      const r = el.getBoundingClientRect();
      if (r.bottom > H + 1 || r.top < -1) out.push(`player part off screen: ${el.className} ${Math.round(r.top)}–${Math.round(r.bottom)} of ${H}`);
    }
    return [...new Set(out)];
  }, touch);
}

/** Scrolled to the end of a page, its last control sits clear of the mini player. */
export async function bottomClear(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const mini = document.querySelector(".mini");
    if (!mini) return [];
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 250));
    const m = mini.getBoundingClientRect();
    const last = [...document.querySelectorAll("main button, main a[href], main input, main [role=switch]")].filter((el) => el.getBoundingClientRect().height > 0).at(-1) as HTMLElement | undefined;
    const r = last?.getBoundingClientRect();
    window.scrollTo(0, 0);
    return r && r.bottom > m.top + 1 ? [`last control under the mini player: "${(last!.innerText || last!.getAttribute("aria-label") || "").slice(0, 30)}"`] : [];
  });
}
