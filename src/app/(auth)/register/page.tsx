"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthTestPanel } from "@/components/auth/AuthTestPanel";
import { Button, Card, CardBody, Input } from "@/components/ui";
import { APP_NAME } from "@/lib/constants";
import { registerSchema, type RegisterInput } from "@/lib/schemas/auth";

type FieldErrors = Partial<Record<keyof RegisterInput, string>>;

const registerTestCases = [
  {
    label: "Missing full name",
    description: "Fails name validation before the API call.",
    values: { name: "", email: "new.agent@example.com", password: "Agent@1234" },
  },
  {
    label: "Invalid email format",
    description: "Checks email format validation.",
    values: { name: "Test Agent", email: "not-an-email", password: "Agent@1234" },
  },
  {
    label: "Whitespace in email",
    description: "Email cannot contain spaces, tabs, or line breaks.",
    values: { name: "Test Agent", email: "test @company.com", password: "Agent@1234" },
  },
  {
    label: "Two @ symbols",
    description: "Checks that only one @ symbol is allowed.",
    values: { name: "Test Agent", email: "test@@company.com", password: "Agent@1234" },
  },
  {
    label: "Consecutive dots",
    description: "Blocks addresses like user..name@company.com.",
    values: { name: "Test Agent", email: "test..agent@company.com", password: "Agent@1234" },
  },
  {
    label: "Leading dot",
    description: "Blocks local parts that start with a dot.",
    values: { name: "Test Agent", email: ".agent@company.com", password: "Agent@1234" },
  },
  {
    label: "Bad domain label",
    description: "Blocks domain labels that start or end with a hyphen.",
    values: { name: "Test Agent", email: "agent@company-.com", password: "Agent@1234" },
  },
  {
    label: "Disposable domain",
    description: "Blocks throwaway email providers during sign-up.",
    values: { name: "Test Agent", email: "agent@mailinator.com", password: "Agent@1234" },
  },
  {
    label: "Role-based email",
    description: "Blocks shared inboxes like support@ or sales@.",
    values: { name: "Test Agent", email: "support@company.com", password: "Agent@1234" },
  },
  {
    label: "Provider typo",
    description: "Prompts for common domain typos before sign-up.",
    values: { name: "Test Agent", email: "agent@gmial.com", password: "Agent@1234" },
  },
  {
    label: "Short password",
    description: "Checks the minimum 8 character password rule.",
    values: { name: "Test Agent", email: "new.agent@example.com", password: "short" },
  },
  {
    label: "Duplicate seeded user",
    description: "Passes form validation, then checks the server duplicate-email error.",
    values: { name: "Agent One", email: "agent1@businessops.dev", password: "Agent@1234" },
  },
] satisfies Array<{ label: string; description: string; values: RegisterInput }>;

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState<RegisterInput>({ name: "", email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function loadTestValues(values: RegisterInput) {
    setForm(values);
    setError("");
    setFieldErrors({});
  }

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
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md items-center">
        <Card className="w-full">
          <CardBody className="p-7 sm:p-8">
            <div className="mb-7">
              <p className="text-sm font-semibold text-slate-500">{APP_NAME}</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-950">Create your account</h1>
              <p className="mt-1 text-sm text-slate-500">
                New accounts start as agents. Admins can adjust access later.
              </p>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

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

            <p className="mt-6 text-center text-sm text-slate-500">
              Already have access?{" "}
              <Link href="/login" className="font-semibold text-slate-950 hover:underline">
                Sign in
              </Link>
            </p>

            <AuthTestPanel
              title="Sign-up tester"
              testCases={registerTestCases}
              onSelect={loadTestValues}
            />
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
