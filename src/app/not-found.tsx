import Link from "next/link";
import { Wordmark } from "@/components/app/brand";

/** Out-of-scope records render this too: the app never confirms that something it won't show you exists. */
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="text-center">
        <Wordmark className="text-3xl" />
        <h1 className="mt-6 text-xl font-semibold">Not found</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">This page does not exist, or it belongs to a project or record outside your access.</p>
        <Link href="/" className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Back to my workspace
        </Link>
      </div>
    </main>
  );
}
