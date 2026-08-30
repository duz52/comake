import type { ReactNode } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import './styles.css';

/**
 * Static pre-paint theme bootstrap. Runs synchronously in <head>, before any
 * app script or style sheet, so the first paint already has the right theme.
 * Self-contained on purpose: it duplicates the storage key and resolution
 * logic of `app/lib/theme.ts` — keep them in sync. Handles inaccessible
 * storage and browsers without `matchMedia` gracefully.
 */
const THEME_BOOTSTRAP_SCRIPT = `(function () {
  var key = 'comake:theme-preference';
  var preference = 'system';
  try {
    var stored = localStorage.getItem(key);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      preference = stored;
    }
  } catch (error) {}
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var isDark = preference === 'dark' || (preference === 'system' && prefersDark);
  var theme = isDark ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();`;

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <meta content="A shared canvas for people and agents to make presentations together." name="description" />
        <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}

export function ErrorBoundary() {
  return (
    <main className="route-error">
      <p>Comake could not open this workspace. Please try again.</p>
    </main>
  );
}