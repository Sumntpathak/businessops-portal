"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, CardBody, Input } from "@/shared/ui";
import { APP_NAME } from "@/shared/constants";

const IS_DEV = process.env.NODE_ENV !== "production";

interface ApiResult {
  message: string;
  resetUrl?: string;
  emailSent?: boolean;
  smtpFailReason?: string;
  debug?: Record<string, unknown>;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);
    if (!email.trim()) { setError("Enter your email address."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Request failed."); return; }
      setResult(data.data ?? data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-slate-400">Reset your password</p>
        </div>

        <Card>
          <CardBody className="space-y-4">
            {!result ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm text-gray-500">
                  Enter your account email and we&apos;ll send a reset link valid for 60 minutes.
                </p>
                {error && <Alert variant="error">{error}</Alert>}
                <Input
                  label="Email address"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending..." : "Send reset link"}
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                {/* Lookup failed */}
                {IS_DEV && result.debug && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-center space-y-1">
                    <p className="text-sm font-semibold text-red-700">Account not found or inactive</p>
                    <p className="text-xs text-red-500">{result.message}</p>
                  </div>
                )}

                {/* Reset link available */}
                {result.resetUrl && (
                  <div className="space-y-4 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                      <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>

                    {result.emailSent ? (
                      <p className="text-sm text-gray-600">
                        Reset link sent to <strong>{email}</strong>. Check your inbox (and spam).
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500">
                        Use the link below to reset your password.
                      </p>
                    )}

                    <a
                      href={result.resetUrl}
                      className="block w-full rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
                    >
                      Reset password
                    </a>

                    <p className="text-xs text-gray-400">
                      Link expires in 60 minutes.
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => { setResult(null); setEmail(""); }}
                  className="w-full text-center text-xs text-gray-400 hover:text-gray-600"
                >
                  Try again
                </button>
              </div>
            )}

            <div className="border-t border-gray-100 pt-3 text-center text-sm text-gray-500">
              <Link href="/login" className="text-blue-600 hover:underline">Back to login</Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
