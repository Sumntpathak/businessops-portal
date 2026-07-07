import type { ReactNode } from "react";

export function AuthCard({
  title,
  description,
  children,
  footer
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-md rounded-2xl border bg-muted/20 p-8 shadow-2xl shadow-black/20">
        <a href="/" className="mb-10 block text-sm font-semibold tracking-[0.2em]">
          RECEPTO
        </a>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-8">{children}</div>
        {footer ? <div className="mt-7 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </section>
    </main>
  );
}
