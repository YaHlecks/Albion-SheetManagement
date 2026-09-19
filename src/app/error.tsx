"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Logo, Button } from "@/components/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="auth-card text-center">
        <div className="mb-4 flex justify-center"><Logo size={40} /></div>
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
          <AlertTriangle size={22} />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          An unexpected error occurred. It has been logged. Try again, and if the problem
          persists contact an administrator.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button onClick={reset}>Try again</Button>
          <Link href="/dashboard" className="btn btn-secondary w-full">Go to dashboard</Link>
        </div>
      </div>
    </div>
  );
}
