import { redirect } from "next/navigation";
import AppSidebar from "@/shared/layout/AppSidebar";
import { getSession } from "@/server/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-dvh bg-gray-50 lg:flex">
      <AppSidebar user={{ name: session.name, email: session.email, role: session.role }} />
      <main className="min-w-0 flex-1 pt-16 lg:h-dvh lg:overflow-y-auto lg:pt-0">
        <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
