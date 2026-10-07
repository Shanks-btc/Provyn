"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Wizard } from "./Wizard";

/**
 * The intent wizard as a modal overlay: it opens on top of whatever page the visitor is on (no URL change) and closing
 * returns to that page exactly as it was. Mounted once, in the root layout, so any component can open it via
 * `useWizardModal().open()` — the landing page's "Explore Strategies" button is the current trigger.
 *
 * All wizard stages (4 steps, the live agent run, the result) render INSIDE this dialog. The one real navigation — the
 * result's "Open in Borrow / Multiply" button — is a normal page transition, and the modal closes as it happens.
 *
 * Close: the X button always works. Escape and click-outside close it too, EXCEPT while the agent is running (a stray
 * click must not throw away a 1–2 minute paid run) or while a nested dialog (the sign confirmation, the wallet picker)
 * is open — those handle their own dismissal.
 */
export interface WizardOpenOptions {
  /** Element to hand focus back to on close. */
  trigger?: HTMLElement | null;
  /** Reopen at the agent step with the answers saved in sessionStorage (used after buying on Trade). */
  resume?: boolean;
}
interface WizardModalApi {
  open: (arg?: HTMLElement | null | WizardOpenOptions) => void;
  close: () => void;
  isOpen: boolean;
}
const Ctx = createContext<WizardModalApi | null>(null);

export function useWizard(): WizardModalApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWizardModal must be used inside <WizardModalProvider>.");
  return ctx;
}

export const useWizardModal = useWizard;

/** A nested dialog is on top: our own Tx confirmation, or the wallet-adapter picker. */
const nestedDialogOpen = () => !!document.querySelector("[data-tx-step], .wallet-adapter-modal");

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function WizardModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resume, setResume] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  const open = useCallback((arg?: HTMLElement | null | WizardOpenOptions) => {
    const opts: WizardOpenOptions = arg && !(arg instanceof HTMLElement) ? arg : { trigger: arg as HTMLElement | null | undefined };
    const trigger = opts.trigger;
    setResume(!!opts.resume);
    // The element to give focus back to on close: the trigger itself if it says so (Safari doesn't focus a button on
    // click, so document.activeElement can be <body> there), else whatever had focus.
    opener.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setBusy(false);
  }, []);
  const api = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  // Any route CHANGE (the result's hand-off to /borrow, browser back/forward) closes it. Compared against the previous
  // path, so merely mounting never fires a stray close (which could undo a click made right after hydration).
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    close();
  }, [pathname, close]);

  // Scroll lock: the page underneath must not move while the modal is open. The scrollbar's width is added back as
  // padding so the page doesn't jump sideways when the scrollbar disappears.
  useEffect(() => {
    if (!isOpen) return;
    const html = document.documentElement;
    const before = { overflow: html.style.overflow, paddingRight: html.style.paddingRight };
    const scrollbar = window.innerWidth - html.clientWidth;
    html.style.overflow = "hidden";
    if (scrollbar > 0) html.style.paddingRight = `${scrollbar}px`;
    return () => {
      html.style.overflow = before.overflow;
      html.style.paddingRight = before.paddingRight;
    };
  }, [isOpen]);

  // Focus goes into the dialog on open and back to the trigger on close. (Its own effect, keyed on isOpen only —
  // re-running it whenever `busy` flips would yank focus out of the wizard mid-use.)
  useEffect(() => {
    if (!isOpen) return;
    panel.current?.querySelector<HTMLElement>("[data-wizard-close]")?.focus({ preventScroll: true });
    return () => opener.current?.focus?.({ preventScroll: true });
  }, [isOpen]);

  // Escape, and the Tab trap.
  useEffect(() => {
    if (!isOpen) return;
    const el = panel.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (busy || nestedDialogOpen()) return;
        e.preventDefault();
        close();
      } else if (e.key === "Tab" && el && !nestedDialogOpen()) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, busy, close]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {isOpen && (
        <div
          data-testid="wizard-overlay"
          className="fixed inset-0 z-[80] flex items-stretch justify-center bg-ink/55 md:items-center md:p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy && !nestedDialogOpen()) close();
          }}
        >
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wizard-title"
            data-testid="wizard-dialog"
            className="relative flex h-[100dvh] w-full flex-col bg-paper text-ink md:h-auto md:max-h-[92vh] md:max-w-[1040px] md:rounded-2xl md:border md:border-line md:shadow-[0_24px_64px_rgba(0,0,0,0.3)]"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-4 py-4 md:px-8 md:py-5">
              <div className="min-w-0">
                <div className="mb-1 font-mono text-[11px] tracking-[0.04em] text-gold-strong">EXPLORE STRATEGIES</div>
                <h2 id="wizard-title" className="m-0 font-serif text-[22px] font-semibold leading-tight text-ink md:text-[28px]">
                  Find a strategy that fits
                </h2>
                <p className="mb-0 mt-1.5 hidden max-w-[640px] font-serif text-[14px] leading-normal text-ink-muted md:block">
                  Tell Provyn what you want. It checks your real position and the live market before recommending anything, and only proposes; you sign every transaction yourself.
                </p>
              </div>
              <button
                type="button"
                data-wizard-close
                aria-label="Close"
                onClick={close}
                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-ink hover:border-gold-deep hover:text-gold-text"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </header>
            <div data-testid="wizard-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 md:px-8 md:py-8">
              <Wizard onBusyChange={setBusy} onNavigate={close} resume={resume} />
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** The landing page's "Explore Strategies" button — opens the wizard modal instead of navigating anywhere. */
export function ExploreStrategiesButton({ className }: { className?: string }) {
  const { open } = useWizardModal();
  return (
    <button type="button" onClick={(e) => open(e.currentTarget)} aria-haspopup="dialog" className={className}>
      Explore Strategies
    </button>
  );
}
