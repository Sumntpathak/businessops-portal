import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <AuthCard title="Create your account" description="Start with your details. Your business comes next.">
      <SignupForm />
    </AuthCard>
  );
}
