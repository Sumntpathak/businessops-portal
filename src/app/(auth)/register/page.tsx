"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, CardBody, Input } from "@/shared/ui";
import { APP_NAME } from "@/shared/constants";
import { registerSchema, type RegisterInput } from "@/features/auth/auth.schema";

type FieldErrors = Partial<Record<keyof RegisterInput, string>>;

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState<RegisterInput>({ name: "", email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        name: errors.name?.[0],
        email: errors.email?.[0],
        password: errors.password?.[0],
      });
      return;
    }

    setFieldErrors({});
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json();

      if (!res.ok) {
        const details = data.details as Record<string, string[]> | undefined;
        const message = details ? Object.values(details).flat().join(", ") : data.error;
        setError(message ?? "We could not create your account.");
        return;
      }

      // Backend returns this message when REQUIRE_ADMIN_ACTIVATION=true
      if (data.data?.message?.includes("Awaiting admin activation")) {
        setPendingApproval(true);
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

  if (pendingApproval) {
    return (
      <main className="min-h-screen bg-white px-4 py-10 text-gray-950">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md items-center">
          <Card className="w-full">
            <CardBody className="p-7 sm:p-8 text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
                <svg className="h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Account pending approval</h2>
              <p className="text-sm text-gray-500">
                Your account for <strong>{form.email}</strong> has been created and is waiting for an admin to activate it.
                You&apos;ll be able to log in once your account is approved.
              </p>
              <p className="text-xs text-gray-400">
                Contact your workspace admin to get access sooner.
              </p>
              <Link href="/login">
                <Button variant="secondary" className="w-full mt-2">Back to login</Button>
              </Link>
            </CardBody>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white px-4 py-10 text-gray-950">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md items-center">
        <Card className="w-full">
          <CardBody className="p-7 sm:p-8">
            <div className="mb-7">
              <div className="mb-6 flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-blue-600 text-sm font-semibold text-white shadow-sm">
                  B
                </span>
                <span className="text-base font-semibold tracking-tight text-gray-950">{APP_NAME}</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-950">Create your account</h1>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                New accounts start as agents and require admin activation before you can log in.
              </p>
            </div>

            {error && <Alert className="mb-4">{error}</Alert>}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Full name"
                name="name"
                type="text"
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Aarav Mehta"
                error={fieldErrors.name}
              />
              <Input
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="aarav@company.com"
                error={fieldErrors.email}
              />
              <Input
                label="Password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="At least 8 characters"
                error={fieldErrors.password}
              />
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Creating account..." : "Create account"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-500">
              Already have access?{" "}
              <Link href="/login" className="font-medium text-blue-700 hover:underline">
                Sign in
              </Link>
            </p>
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
