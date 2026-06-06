"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, CardBody, Input } from "@/shared/ui";
import { APP_NAME } from "@/shared/constants";
import { loginSchema, type LoginInput } from "@/features/auth/auth.schema";
import { DEMO_ACCOUNTS } from "@/features/auth/demo-accounts";

type FieldErrors = Partial<Record<keyof LoginInput, string>>;

const showDemoAccounts = process.env.NODE_ENV !== "production";
const darkInputWrapper = "[&>span:first-child]:text-slate-300 [&>span:last-child]:text-red-300";
const darkInput =
  "!border-white/10 !bg-slate-950/80 !text-white !shadow-[inset_0_1px_8px_rgba(0,0,0,0.35)] placeholder:!text-slate-600 focus:!border-blue-400 focus:!ring-blue-500/25";
const demoButton =
  "!border-white/10 !bg-slate-950/60 !text-slate-300 hover:!border-blue-400/60 hover:!bg-blue-500/10";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState<LoginInput>({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function fillDemoAccount(account: (typeof DEMO_ACCOUNTS)[number]) {
    setForm({ email: account.email, password: account.password });
    setError("");
    setFieldErrors({});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const parsed = loginSchema.safeParse(form);
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        email: errors.email?.[0],
        password: errors.password?.[0],
      });
      return;
    }

    setFieldErrors({});
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "We could not sign you in.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b0f19] px-4 py-10 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_68%_45%,rgba(37,99,235,0.24),transparent_30%),radial-gradient(circle_at_16%_18%,rgba(14,165,233,0.12),transparent_26%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(rgba(148,163,184,0.35)_1px,transparent_1px)] [background-size:22px_22px]" />
      <div className="relative mx-auto grid min-h-[calc(100vh-5rem)] w-full max-w-6xl items-center gap-12 lg:grid-cols-[1fr_420px]">
        <section className="hidden lg:block">
          <Link href="/login" className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg border border-blue-300/30 bg-blue-500 text-sm font-semibold text-white shadow-[0_0_32px_rgba(37,99,235,0.45)]">
              B
            </span>
            <span className="text-base font-semibold tracking-tight text-white">{APP_NAME}</span>
          </Link>
          <h1 className="mt-10 max-w-2xl text-5xl font-semibold leading-[1.05] tracking-tight text-white">
            A clean workspace for leads, follow-ups, invoices, and payments.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-400">
            Keep daily sales operations moving with clear ownership, role-based access, and billing visibility in one focused product.
          </p>
          <div className="mt-10 grid max-w-xl gap-4">
            {[
              ["Know what needs attention", "Follow-ups due today stay visible without digging through spreadsheets."],
              ["Move from lead to invoice", "Customer details, status, and billing context stay connected."],
              ["Keep accountability simple", "Managers can see user activity and handoffs without noisy reports."],
            ].map(([title, description]) => (
              <div key={title} className="border-l border-blue-400/25 pl-4">
                <p className="text-sm font-semibold text-slate-100">{title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <Card className="relative overflow-hidden !border-white/10 !bg-slate-900/70 !shadow-[0_24px_80px_rgba(0,0,0,0.45),0_0_80px_rgba(37,99,235,0.12)] backdrop-blur-xl before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-blue-300/50 before:to-transparent">
          <CardBody className="p-7 sm:p-8">
            <div className="mb-7">
              <div className="mb-6 flex items-center gap-3 lg:hidden">
                <span className="grid size-9 place-items-center rounded-lg border border-blue-300/30 bg-blue-500 text-sm font-semibold text-white shadow-[0_0_28px_rgba(37,99,235,0.45)]">
                  B
                </span>
                <span className="text-base font-semibold tracking-tight text-white">{APP_NAME}</span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-white">Sign in</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Access your team workspace and continue where the operation left off.
              </p>
            </div>

            {error && <Alert className="mb-4 !border-red-400/30 !bg-red-500/10 !text-red-200">{error}</Alert>}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@company.com"
                error={fieldErrors.email}
                wrapperClassName={darkInputWrapper}
                className={darkInput}
              />
              <Input
                label="Password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Enter your password"
                error={fieldErrors.password}
                wrapperClassName={darkInputWrapper}
                className={darkInput}
              />
              <Button type="submit" disabled={loading} className="w-full !bg-blue-500 !shadow-[0_12px_32px_rgba(37,99,235,0.35)] hover:!bg-blue-400">
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <div className="mt-6 flex flex-col items-center gap-2 text-center text-sm text-slate-400">
              <p>
                New to {APP_NAME}?{" "}
                <Link href="/register" className="font-medium text-blue-300 hover:text-blue-200 hover:underline">
                  Create an account
                </Link>
              </p>
              <Link href="/forgot-password" className="font-medium text-slate-400 hover:text-blue-300 hover:underline">
                Forgot password?
              </Link>
            </div>

            {showDemoAccounts && (
              <details className="mt-7 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                <summary className="cursor-pointer text-sm font-medium text-slate-300">
                  Development demo accounts
                </summary>
                <div className="mt-3 space-y-2">
                  {DEMO_ACCOUNTS.map((account) => (
                    <Button
                      key={account.email}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => fillDemoAccount(account)}
                      className={`h-auto w-full flex-col items-start gap-0.5 px-3 py-2 text-left font-normal ${demoButton}`}
                    >
                      <span className="block font-semibold text-slate-100">{account.role}</span>
                      <span className="block text-slate-400">{account.email}</span>
                      <span className="block font-mono text-slate-500">{account.password}</span>
                    </Button>
                  ))}
                </div>
              </details>
            )}
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
