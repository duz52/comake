/**
 * Application theme model. Type declarations only: no React, browser, storage,
 * or side-effect code. Behavior lives in `app/lib/theme.ts`.
 */

/** Explicit user preference; `system` follows the OS `prefers-color-scheme`. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** Resolved theme actually rendered by the chrome. */
export type EffectiveTheme = 'light' | 'dark';