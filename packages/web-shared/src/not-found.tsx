import type { Metadata } from "next";
import { Logo } from "./logo";

/**
 * Both apps' `app/global-not-found.tsx`: an address neither serves. Each app
 * imports its own stylesheet there, then exports these two.
 */
export const notFoundMetadata: Metadata = {
  title: "Page not found | Nodrail",
  robots: { index: false },
};

export function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="grid min-h-screen place-items-center p-8 text-center">
        <main>
          {/* A plain link: this page has no router context to navigate from. */}
          <a href="/" className="mb-10 inline-block">
            <Logo width="166" height="51" />
          </a>
          <h1 className="font-display text-4xl font-extrabold">
            Page not found
          </h1>
          <nav className="mt-6 flex justify-center gap-6">
            <a className="inline-block py-3 underline" href="/">
              Back to Nodrail
            </a>
          </nav>
        </main>
      </body>
    </html>
  );
}
