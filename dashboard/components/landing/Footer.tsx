import Link from "next/link";
import { DEVNET_PROOF_URL } from "@/lib/proof";
import { Logo } from "../Logo";

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "PRODUCT",
    links: [
      { label: "Portfolio", href: "/portfolio" },
      { label: "Earn", href: "/earn" },
      { label: "Borrow", href: "/borrow" },
      { label: "Trade (concept)", href: "/trade" },
    ],
  },
  {
    title: "ONCHAIN",
    links: [
      { label: "Kamino xStocks market", href: "https://app.kamino.finance", external: true },
      { label: "Pyth price feeds", href: "https://pyth.network", external: true },
      { label: "Devnet proof ↗", href: DEVNET_PROOF_URL, external: true },
    ],
  },
  {
    title: "BUILT ON",
    links: [
      { label: "Solana", href: "https://solana.com", external: true },
      { label: "Kamino Lend", href: "https://kamino.finance", external: true },
      { label: "Pyth Network", href: "https://www.pyth.network", external: true },
    ],
  },
];

function FooterLinkItem({ link }: { link: FooterLink }) {
  const className = "font-serif text-sm text-line-strong hover:text-gold";
  if (link.href.startsWith("/")) {
    return (
      <Link href={link.href} className={className}>
        {link.label}
      </Link>
    );
  }
  return link.external ? (
    <a href={link.href} target="_blank" rel="noreferrer" className={className}>
      {link.label}
    </a>
  ) : (
    <a href={link.href} className={className}>
      {link.label}
    </a>
  );
}

/**
 * Dark three-column footer. Below md everything stacks in one centered column (logo/tagline
 * first); md–lg keeps the logo block above a row of three columns; lg+ puts them side by side.
 */
export function Footer({ emDash = false }: { emDash?: boolean } = {}) {
  return (
    <footer className="bg-charcoal">
      <div className="mx-auto max-w-[1440px] px-4 pb-10 pt-16 md:px-10 xl:px-14">
        <div className="mb-12 flex flex-col items-center gap-10 text-center md:items-start md:text-left lg:flex-row lg:justify-between lg:gap-[60px]">
          <div className="flex max-w-[300px] flex-col items-center md:items-start">
            <div className="mb-3.5">
              <Logo tone="dark" size="sm" href="/" />
            </div>
            <p className="m-0 font-serif text-sm leading-[1.6] text-ink-faint">
              {emDash
                ? "Earn yield, borrow against your stock portfolio, every proposal checked against your real Kamino position and previewed before you sign."
                : "Earn yield, borrow against your stock portfolio, every proposal checked against your real Kamino position and previewed before you sign."}
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-col gap-8 md:flex-row md:gap-[60px] lg:gap-10 xl:gap-[60px]">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <div className="mb-4 font-mono text-[11px] tracking-[0.04em] text-term-faint">{col.title}</div>
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <FooterLinkItem link={l} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="border-t border-term-line pt-6 text-center font-mono text-xs text-term-faint md:text-left">
          © 2026 Provyn. Built for Stocklana.
        </div>
      </div>
    </footer>
  );
}
