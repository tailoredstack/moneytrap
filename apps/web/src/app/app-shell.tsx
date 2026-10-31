import type { ReactNode } from "react";

// The first focusable element is a skip link, so keyboard users can bypass the header.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b px-6 py-3 text-sm font-semibold">Moneytrap</header>
      <main id="main-content" tabIndex={-1} className="p-6">
        {children}
      </main>
    </div>
  );
}
