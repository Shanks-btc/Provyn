import Image from "next/image";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";

/*
 * Photo: "Golden sunlight illuminates rugged mountain peaks at dawn", Zion National Park, by
 * Florian Schindler on Unsplash (Unsplash License). Self-hosted from public/images — never
 * hotlinked. Decorative, so alt="". Below the fold: default lazy loading, no preload (Next 16
 * deprecated `priority`; its `preload` defaults to false).
 */
export function ClosingCTA() {
  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden text-center">
      <Image
        src="/images/hero-closing.jpg"
        alt=""
        fill
        sizes="100vw"
        className="object-cover object-center"
      />
      {/* Overlay is stronger than the mockup's 0.45→0.72 linear gradient. Measured against the
          rendered photo at all 7 widths (worst pixel under each text box), the mockup's version
          left the 16px paragraph at 3.7:1 on phones and the gold eyebrow at ~2.2–2.7:1. This
          0.55→0.75 gradient plus a soft center scrim keeps the paragraph ≥ 4.5:1 everywhere. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_50%,rgba(20,15,5,0.40)_0%,rgba(20,15,5,0)_100%),linear-gradient(180deg,rgba(20,15,5,0.55)_0%,rgba(20,15,5,0.75)_100%)]"
      />

      <div className="relative z-[1] mx-auto max-w-[1440px] px-4 py-24 md:px-10 md:py-[140px] xl:px-14">
        {/* Gold on golden cliffs can't reach 4.5:1 from the overlay alone without blacking out the
            photo, so the eyebrow gets its own small dark pill. */}
        <div className="mb-5 inline-block rounded-full bg-[rgba(20,15,5,0.72)] px-3 py-1 font-mono text-xs tracking-[0.08em] text-gold">
          CONNECT
        </div>
        <h2 id="cta-title" className="mx-auto mb-4 mt-0 max-w-[640px] font-serif text-[30px] font-semibold leading-tight text-white md:text-[42px]">
          See what your Stock portfolio actually supports.
        </h2>
        <p className="mx-auto mb-9 mt-0 max-w-[480px] font-serif text-base text-photo-muted">
          No commitment, no form to fill out, Provyn reads your real Portfolio and tells you what&apos;s true today.
        </p>
        <div className="flex flex-col justify-center gap-3.5 sm:flex-row">
          <ConnectWalletButton size="cta" inert />
          <a
            href="#proof"
            className="inline-block w-full rounded-[30px] border border-white/40 bg-transparent px-[30px] py-4 font-mono text-[15px] font-medium text-white hover:border-white sm:w-auto"
          >
            View the proof ↗
          </a>
        </div>
      </div>
    </section>
  );
}
