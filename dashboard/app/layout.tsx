import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { WalletProviders } from "@/components/wallet/WalletProviders";
import { WizardModalProvider } from "@/components/wizard/WizardModal";

// Variable font — the opsz axis is what the mockup's `opsz,wght@9..144,…` request loads.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Used ONLY for the "Provyn" logotype (weight 800) — headings and body stay Fraunces.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: "800",
});

const SITE_URL = "https://provyn.xyz";
const SITE_TITLE = "Provyn, prime brokerage for tokenized stocks";
const SITE_DESCRIPTION =
  "Earn, borrow and trade against your stock portfolio. Provyn checks your real on-chain position and previews the transaction before you sign.";

// Pages that set their own `title` (Borrow, Earn, ...) keep it for the tab; they inherit the Open Graph and Twitter fields below as written.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "Provyn",
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: "Provyn",
    type: "website",
    url: SITE_URL,
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${jetbrainsMono.variable} ${manrope.variable} antialiased`}>
      <body className="font-serif">
        <WalletProviders>
          <WizardModalProvider>{children}</WizardModalProvider>
        </WalletProviders>
      </body>
    </html>
  );
}
