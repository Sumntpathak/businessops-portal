import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Dashboard</h1>
      <p className="text-gray-500 text-sm mb-6">
        Welcome back, {session.name} ({session.role})
      </p>

      {/* Stats grid — populated by /api/dashboard in Day 4 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {["Total Leads", "Open Leads", "Converted", "Lost"].map((label) => (
          <div key={label} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">—</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {["Total Invoices", "Paid", "Unpaid", "Revenue"].map((label) => (
          <div key={label} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">—</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
        <h2 className="font-semibold text-gray-800 mb-3">Follow-ups Due Today</h2>
        <p className="text-sm text-gray-400">Loading follow-ups...</p>
      </div>
    </div>
  );
}
