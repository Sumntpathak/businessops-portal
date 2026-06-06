import { Button, Card, CardBody } from "@/shared/ui";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <Card className="max-w-md">
        <CardBody>
          <p className="text-sm font-medium text-gray-500">404</p>
          <h1 className="mt-2 text-2xl font-semibold text-gray-950">Page not found</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            The page may have moved, or you may not have access to it.
          </p>
          <Button href="/dashboard" className="mt-5">
            Back to dashboard
          </Button>
        </CardBody>
      </Card>
    </main>
  );
}
