import Link from "next/link";
import { SpendApp } from "@/components/spend/SpendApp";
import { Logo } from "@/components/ui";

const STEPS = [
  { n: "01", rule: "border-ink", title: "Track", body: "Record what you spend energy both Gen and NEPA." },
  { n: "02", rule: "border-fuel", title: "Review", body: "View your spending history and insights." },
  { n: "03", rule: "border-light", title: "Estimate", body: "Simulate usage and spending." },
];

const DETAILS = [
  { fig: "₦2xx.x/kWh", color: "text-light", title: "Your real tariff, not the band on paper", body: "Add the units from your token receipt and Calgy works out what you actually pay per kWh." },
  { fig: "₦1,xxx/L", color: "text-fuel-ink", title: "Your pump price, every top-up", body: "Log litres and see your average price per litre — station or roadside." },
  // { fig: "₦112k–₦137k", color: "", title: "Honest ranges, not fake precision", body: "Mid-month, Calgy shows where you're headed as a range, from what you've actually spent." },
];

export default function Landing() {
  return (
    <div className="overflow-x-hidden bg-paper font-sans text-ink [scroll-behavior:smooth]">
      <nav className="mx-auto flex max-w-[1160px] items-center justify-between gap-4 px-6 py-[18px]">
        <Logo size={26} />
        <div className="flex items-center gap-5">
          <a href="#estimate" className="hidden text-[15px] font-medium whitespace-nowrap no-underline sm:inline">
            Ballpark
          </a>
          <a href="#how" className="hidden text-[15px] font-medium whitespace-nowrap no-underline sm:inline">
            How it works
          </a>
          <Link
            href="/app"
            className="inline-flex h-11 items-center rounded-xl bg-ink px-[18px] text-[15px] font-bold whitespace-nowrap text-card no-underline"
          >
            Open Calgy
          </Link>
        </div>
      </nav>

      <section className="mx-auto grid max-w-[1160px] grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-center gap-10 px-6 pt-4 pb-16">
        <div className="flex flex-col">
          <span className="font-mono text-[13px] tracking-[0.08em] text-muted uppercase">
            Your home energy tracker
          </span>
          <h1 className="mt-3.5 mb-4 text-[clamp(40px,5vw,64px)] leading-[0.96] font-extrabold tracking-[-0.045em] text-balance">
            Your energy costs, finally adds up.
          </h1>
          <p className="max-w-[480px] text-[clamp(16px,1.3vw,18px)] leading-normal text-pretty text-body-2">
            Calgy helps you log every litre of fuel and every meter token in two taps. See what your home really spends
            on energy each month, get estimates and simulate your usage and spending.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3.5">
            <Link
              href="/app"
              className="inline-flex h-[52px] items-center rounded-2xl bg-ink px-[22px] text-base font-bold whitespace-nowrap text-card no-underline"
            >
              Start tracking
            </Link>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3">
          {/* zoom shrinks the phone while keeping the demo laid out at its native 360px width */}
          <div style={{ zoom: 0.72 }} className="h-[740px] w-[360px] max-w-full rounded-[48px] bg-ink p-2.5 shadow-[0_30px_60px_-20px_rgba(25,23,18,0.35)]">
            {/* translateZ makes this the containing block for the demo's fixed bars, sheet and toast */}
            <div className="relative h-full w-full overflow-hidden rounded-[38px] bg-paper" style={{ transform: "translateZ(0)" }}>
              <div className="no-scrollbar h-full w-full overflow-x-hidden overflow-y-auto" aria-label="Live demo of the Calgy app">
                <SpendApp demo />
              </div>
            </div>
          </div>
          <span className="font-mono text-xs text-muted">Demo data</span>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-[1160px] scroll-mt-4 px-6 pt-[104px] pb-[72px]">
        <h2 className="mb-12 max-w-[720px] text-[clamp(34px,4.2vw,54px)] leading-none font-extrabold tracking-[-0.04em] text-balance">
          Track . Review . Estimate
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-8">
          {STEPS.map((s) => (
            <div key={s.n} className={`flex flex-col gap-3 border-t-2 pt-5 ${s.rule}`}>
              <span className="font-mono text-sm text-muted">{s.n}</span>
              <span className="text-2xl font-bold tracking-[-0.02em]">{s.title}</span>
              <span className="text-base leading-normal text-pretty text-body-2">{s.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1160px] px-6 pt-10 pb-24">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))] gap-5">
          {DETAILS.map((d) => (
            <div key={d.title} className="flex flex-col gap-3.5 rounded-3xl border border-line bg-card p-7">
              <span className={`font-mono text-[clamp(30px,3.4vw,40px)] font-semibold tracking-[-0.03em] ${d.color}`}>
                {d.fig}
              </span>
              <span className="text-[21px] font-bold tracking-[-0.015em]">{d.title}</span>
              <span className="text-base leading-normal text-pretty text-body-2">{d.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1160px] px-6 pb-24">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-center gap-7 rounded-[28px] border-[1.5px] border-dashed border-line-strong p-[clamp(28px,5vw,56px)]">
          <div className="flex flex-col gap-3.5">
            <span className="font-mono text-[13px] tracking-[0.08em] text-muted uppercase">Coming next</span>
            <h2 className="text-[clamp(32px,3.8vw,48px)] leading-none font-extrabold tracking-[-0.04em] text-balance">
              Should you go solar? Your logs will answer.
            </h2>
          </div>
          <p className="text-[17px] leading-[1.55] text-pretty text-body-2">
            After a few months of real spend, Calgy will estimate how long an inverter and panels would take to pay for
            themselves — from your numbers, not a salesman&apos;s.
          </p>
        </div>
      </section>

      <section className="bg-ink text-card">
        <div className="mx-auto flex max-w-[1160px] flex-col items-start gap-7 px-6 pt-24 pb-10">
          <h2 className="max-w-[900px] text-[clamp(44px,7vw,96px)] leading-[0.95] font-extrabold tracking-[-0.05em] text-balance">
            Start with this month&apos;s next top-up.
          </h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/app"
              className="inline-flex h-16 items-center rounded-[18px] bg-fuel px-7 text-lg font-extrabold whitespace-nowrap text-ink no-underline"
            >
              + Fuel
            </Link>
            <Link
              href="/app"
              className="inline-flex h-16 items-center rounded-[18px] bg-light-bright px-7 text-lg font-extrabold whitespace-nowrap text-white no-underline"
            >
              + Token
            </Link>
          </div>
          <div className="mt-[72px] flex w-full flex-wrap justify-between gap-3 border-t border-ink-line pt-6 font-mono text-[13px] text-ink-muted">
            <span>Calgy · home energy spend tracker</span>
            <span>Prices come from you, never hardcoded · © 2026</span>
          </div>
        </div>
      </section>
    </div>
  );
}
