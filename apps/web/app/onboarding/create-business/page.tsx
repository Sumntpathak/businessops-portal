import { redirect } from "next/navigation";
import { CreateBusinessForm } from "@/components/auth/create-business-form";
import {
  getMembershipsForUser,
  requireUser
} from "@/lib/auth-helpers";

export default async function CreateBusinessPage() {
  const user = await requireUser();
  const memberships = await getMembershipsForUser(user.id);

  if (memberships.length > 0) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-12">
      <section className="w-full rounded-2xl border bg-muted/20 p-8 sm:p-10">
        <p className="text-sm font-medium text-muted-foreground">One last step</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Create your business</h1>
        <p className="mt-3 max-w-xl leading-7 text-muted-foreground">
          We’ll use your website and this short brief to prepare the first version of your receptionist.
        </p>
        <CreateBusinessForm />
      </section>
    </main>
  );
}
