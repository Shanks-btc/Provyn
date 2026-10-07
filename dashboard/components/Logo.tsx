import { HomeLink } from "./HomeLink";

/**
 * Provyn's logo: the "Provyn" logotype only, in Manrope 800 with letter-spacing −1px — no icon (the earlier
 * checkmark + text lockup was retired; the browser-tab favicon is a separate file and is unaffected). The logotype is
 * deliberately NOT Fraunces: it is a separate treatment from the page's headings. In the header it is the largest
 * text in the bar (30px vs. 13px links) so the brand leads the hierarchy.
 *
 * Header size follows defined steps, like the hero headline, rather than shrinking fluidly:
 *   < 390px: 24px · ≥ 390px: 26px · ≥ 640px: 28px · ≥ 768px (md): 30px.
 * The footer ("sm") stays at 19px. From md up the header logo keeps the 37px-tall box the old icon lockup had, so the
 * Trade header stays exactly 94px (that page's row height was set by the logo, not by its wallet chip).
 */
export function Logo({
  tone = "light",
  size = "md",
  href,
}: {
  tone?: "light" | "dark";
  size?: "sm" | "md";
  href?: string;
}) {
  const className = `flex items-center font-logo font-extrabold leading-none tracking-[-1px] ${
    size === "sm" ? "text-[19px]" : "text-[24px] min-[390px]:text-[26px] sm:text-[28px] md:min-h-[37px] md:text-[30px]"
  } ${tone === "dark" ? "text-term-text" : "text-ink"}`;

  return href ? (
    <HomeLink className={`${className} rounded-md`}>Provyn</HomeLink>
  ) : (
    <span className={className}>Provyn</span>
  );
}
