import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar user={{ name: session.name, email: session.email, role: session.role }} />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
