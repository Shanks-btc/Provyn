import { ExploreStrategiesButton } from "../wizard/WizardModal";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative flex flex-col items-center justify-center gap-8 overflow-hidden px-4 py-16 text-center md:px-10 md:py-[100px] xl:px-14"
    >
      {/* Light-wash background. Clipped by the section's overflow-hidden, and scaled down below md
          so the washes stay proportionate instead of flooding a phone screen. */}
      <div aria-hidden="true" className="pointer-events-none absolute -inset-[100px] z-0">
        <div className="absolute left-1/2 top-[40%] h-[120px] w-[520px] -translate-x-1/2 -translate-y-1/2 -rotate-[18deg] bg-[linear-gradient(90deg,transparent_0%,rgba(201,151,58,0.16)_30%,rgba(184,69,46,0.10)_55%,transparent_85%)] blur-[46px] md:h-[200px] md:w-[900px]" />
        <div className="absolute -right-[180px] -top-[160px] size-[360px] rounded-full bg-[radial-gradient(circle,rgba(201,151,58,0.14)_0%,transparent_70%)] blur-[30px] md:size-[640px]" />
        <div className="absolute -bottom-[180px] -left-[160px] size-[300px] rounded-full bg-[radial-gradient(circle,rgba(184,69,46,0.08)_0%,transparent_70%)] blur-[30px] md:size-[520px]" />
      </div>

      <div className="z-[1] flex items-center gap-2 rounded-[20px] border border-line-strong bg-surface px-4 py-[7px]">
        <span className="inline-block size-[7px] rounded-full bg-gold-deep" />
        <span className="font-mono text-xs tracking-[0.02em] text-ink-muted">Live on Solana</span>
      </div>

      <h1
        id="hero-title"
        className="z-[1] m-0 max-w-[980px] font-serif text-[32px] font-bold leading-[1.05] text-ink md:text-5xl lg:text-[64px] xl:text-[76px]"
      >
        Prime brokerage for
        <br />
        <span className="text-gold-text">tokenized stocks</span>
      </h1>

      <p className="relative z-[1] m-0 max-w-[620px] rounded-lg bg-paper/75 px-3.5 py-1 font-serif text-[17px] leading-normal text-ink-soft md:text-[21px]">
        Earn, borrow and trade against your stock portfolio. Provyn checks your real on-chain position and previews the
        transaction before you sign.
      </p>

      <div className="z-[1] mt-2 flex w-full flex-col gap-3.5 sm:w-auto sm:flex-row">
        <ConnectWalletButton size="hero" inert />
        {/* Opens the intent wizard as a modal over this page (no navigation, no scroll to #strategies). */}
        <ExploreStrategiesButton className="w-full cursor-pointer rounded-lg border border-line-strong bg-transparent px-7 py-4 text-center font-mono text-[15px] font-medium text-ink hover:border-gold-deep hover:text-gold-text sm:w-auto" />
      </div>

      <div className="z-[1] mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-[20px] bg-surface/70 px-4 py-1.5 font-mono text-xs tracking-[0.02em] text-ink-muted md:gap-7">
        {/* Below md the dot separators hide (they'd otherwise wrap to the start of a line) and
            "AAPLx / SPYx / TSLAx" stays together as one unit. */}
        <span>Collateral via Kamino</span>
        <span className="hidden text-line-strong md:inline">·</span>
        <span>Previewed before you sign</span>
        <span className="hidden text-line-strong md:inline">·</span>
        <span className="flex items-center gap-3 md:gap-7">
          <span>AAPLx</span>
          <span className="text-line-strong">/</span>
          <span>SPYx</span>
          <span className="text-line-strong">/</span>
          <span>TSLAx</span>
        </span>
      </div>
    </section>
  );
}
