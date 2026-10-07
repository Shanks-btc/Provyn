"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Link to "/" for the logo lockup. From any other page it's a normal client-side navigation.
 * ON the landing page itself it scrolls to the top explicitly: Next.js's own same-URL scroll
 * handling stopped partway (verified: clicking from 1500px down landed at ~1050px), so a
 * logo click there would otherwise do nothing useful. Honours prefers-reduced-motion.
 */
export function HomeLink({ children, className }: { children: ReactNode; className?: string }) {
  const pathname = usePathname();
  return (
    <Link
      href="/"
      aria-label="Provyn, home"
      className={className}
      onClick={(e) => {
        if (pathname !== "/") return;
        e.preventDefault();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
        if (window.location.hash) history.replaceState(null, "", "/");
      }}
    >
      {children}
    </Link>
  );
}
