import Link from "next/link";
import { Card, CardBody } from "@/components/ui";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="max-w-md">
        <CardBody>
          <p className="text-sm font-medium text-slate-500">404</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Page not found</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            The page may have moved, or you may not have access to it.
          </p>
          <Link
            href="/dashboard"
            className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Back to dashboard
          </Link>
        </CardBody>
      </Card>
    </main>
  );
}
