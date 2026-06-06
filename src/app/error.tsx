"use client";

import { Button, Card, CardBody } from "@/shared/ui";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <Card className="max-w-md">
        <CardBody>
          <p className="text-sm font-medium text-gray-500">Something went wrong</p>
          <h1 className="mt-2 text-2xl font-semibold text-gray-950">
            We could not load this workspace.
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            Try again in a moment. If this keeps happening, share the error digest with support.
          </p>
          {error.digest && (
            <p className="mt-3 rounded-md bg-gray-100 px-3 py-2 font-mono text-xs text-gray-600">
              {error.digest}
            </p>
          )}
          <Button className="mt-5" onClick={reset}>
            Try again
          </Button>
        </CardBody>
      </Card>
    </main>
  );
}
