"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, CardBody, Input } from "@/shared/ui";
import { APP_NAME } from "@/shared/constants";
import { loginSchema, type LoginInput } from "@/features/auth/auth.schema";
import { DEMO_ACCOUNTS } from "@/features/auth/demo-accounts";

type FieldErrors = Partial<Record<keyof LoginInput, string>>;

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
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-950">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] w-full max-w-6xl items-center gap-10 lg:grid-cols-[1fr_440px]">
        <section className="hidden text-white lg:block">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
            {APP_NAME}
          </p>
          <h1 className="mt-5 max-w-2xl text-5xl font-semibold leading-tight">
            Run sales, invoices, and follow-ups from one calm workspace.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
            Designed for small operations teams that need clean handoffs, role-based access,
            and payment visibility without spreadsheet sprawl.
          </p>
          <div className="mt-8 grid max-w-xl grid-cols-3 gap-3">
            {["Leads", "Invoices", "Audit trail"].map((label) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-medium text-white">{label}</p>
                <p className="mt-1 text-xs text-slate-400">Ready for your team</p>
              </div>
            ))}
          </div>
        </section>

        <Card>
          <CardBody className="p-7 sm:p-8">
            <div className="mb-7">
              <p className="text-sm font-semibold text-slate-500">{APP_NAME}</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">Welcome back</h2>
              <p className="mt-1 text-sm text-slate-500">
                Sign in with your team credentials to continue.
              </p>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

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
              />
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              New to {APP_NAME}?{" "}
              <Link href="/register" className="font-semibold text-slate-950 hover:underline">
                Create an account
              </Link>
            </p>

            <div className="mt-7 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3">
                <p className="text-sm font-semibold text-slate-800">Demo accounts</p>
                <p className="mt-0.5 text-xs text-slate-500">Click any account to fill the login form.</p>
              </div>
              <div className="space-y-2">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => fillDemoAccount(account)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs transition hover:border-slate-300 hover:bg-slate-100"
                  >
                    <span className="block font-semibold text-slate-800">{account.role}</span>
                    <span className="block text-slate-600">{account.email}</span>
                    <span className="block font-mono text-slate-500">{account.password}</span>
                  </button>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
