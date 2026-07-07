import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="max-w-2xl text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.25em] text-muted-foreground">
          Recepto
        </p>
        <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-7xl">
          Your business always answers.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
          A multi-tenant AI receptionist platform for calls, questions, and appointments.
        </p>
        <Button className="mt-8" disabled>Dashboard coming soon</Button>
      </section>
    </main>
  );
}
