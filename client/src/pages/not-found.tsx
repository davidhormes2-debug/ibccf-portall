import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft, ShieldAlert } from "lucide-react";

export default function NotFound() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen w-full flex items-center justify-center bg-gradient-to-b from-slate-50 via-white to-slate-100 dark:from-[#050b1f] dark:via-[#0a1840] dark:to-[#050b1f] px-4 py-16"
    >
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0a1840] to-[#004182] shadow-lg shadow-[#0a1840]/20 ring-1 ring-[#c8a951]/20">
          <ShieldAlert className="h-10 w-10 text-[#c8a951]" aria-hidden="true" />
        </div>

        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#c8a951]">
          Error 404
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-5xl font-serif">
          Page not found
        </h1>
        <p className="mx-auto mt-5 max-w-md text-base text-slate-600 dark:text-slate-300">
          The page you're looking for has been moved, removed, or never existed.
          If you arrived here from a link inside your case portal, please return
          to your dashboard.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="w-full sm:w-auto bg-[#0a1840] hover:bg-[#004182] text-white"
          >
            <Link href="/">
              <Home className="mr-2 h-4 w-4" aria-hidden="true" />
              Back to home
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="w-full sm:w-auto border-slate-300 dark:border-slate-700"
          >
            <Link href="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Go to portal
            </Link>
          </Button>
        </div>

        <p className="mt-12 text-xs text-slate-500 dark:text-slate-400">
          Need help? Contact{" "}
          <a
            href="mailto:info@ibccf.site"
            className="font-medium text-[#004182] underline-offset-4 hover:underline dark:text-[#c8a951]"
          >
            info@ibccf.site
          </a>
        </p>
      </div>
    </main>
  );
}
