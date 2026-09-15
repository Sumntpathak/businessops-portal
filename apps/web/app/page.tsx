import Link from "next/link";
import { CalendarDays, Languages, PhoneCall } from "lucide-react";
import { WaitlistForm } from "@/components/marketing/waitlist-form";

const FEATURES = [
  {
    icon: PhoneCall,
    title: "Answers every call, 24/7",
    detail: "No hold music, no missed leads — a warm human-sounding voice picks up instantly."
  },
  {
    icon: Languages,
    title: "English · हिंदी · ਪੰਜਾਬੀ",
    detail: "Switches languages mid-call the moment your caller does, without being asked."
  },
  {
    icon: CalendarDays,
    title: "Books real appointments",
    detail: "Checks live availability and writes straight into your Google Calendar."
  }
] as const;

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Atmosphere: layered glows + faint grid, all compositor-cheap */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-[140px]" />
        <div className="absolute -bottom-52 -right-32 h-[420px] w-[560px] rounded-full bg-sky-500/10 blur-[130px]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "56px 56px"
          }}
        />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6">
        <header className="flex items-center justify-between py-8">
          <span className="text-sm font-semibold tracking-[0.35em] text-foreground">
            RECEPTO
          </span>
          <Link
            href="/login"
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-muted-foreground transition hover:border-white/25 hover:text-foreground"
          >
            Sign in
          </Link>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center pb-16 pt-8 text-center">
          <p className="flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-1.5 text-xs font-medium tracking-wide text-emerald-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Private beta — launching soon
          </p>

          <h1 className="mt-8 max-w-3xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
            Your business{" "}
            <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-sky-400 bg-clip-text text-transparent">
              always answers.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-8 text-muted-foreground">
            Recepto is an AI receptionist that picks up your phone line, speaks
            your caller&apos;s language, remembers returning customers, and books
            appointments while you work.
          </p>

          <div className="mt-10 w-full max-w-lg">
            <WaitlistForm />
          </div>

          <div className="mt-16 grid w-full gap-4 text-left sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, detail }) => (
              <article
                key={title}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm transition hover:border-white/20 hover:bg-white/[0.05]"
              >
                <Icon className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                <h2 className="mt-4 text-sm font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {detail}
                </p>
              </article>
            ))}
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 py-6 text-xs text-muted-foreground">
          <span>© 2026 Recepto</span>
          <span>Built for clinics, consultancies &amp; service businesses</span>
        </footer>
      </div>
    </main>
  );
}
