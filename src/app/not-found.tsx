import Link from "next/link";
import { SearchX } from "lucide-react";
import { Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="auth-card text-center">
        <div className="mb-4 flex justify-center"><Logo size={40} /></div>
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-muted">
          <SearchX size={22} />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          The page you are looking for doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
        <Link href="/dashboard" className="btn btn-primary mt-6 w-full">Go to dashboard</Link>
        <Link href="/" className="mt-3 block text-sm text-faint hover:text-muted">Back to home</Link>
      </div>
    </div>
  );
}
