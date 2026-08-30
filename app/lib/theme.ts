import { useEffect, useState, useSyncExternalStore } from 'react';
import type { EffectiveTheme, ThemePreference } from '../types/theme';

/**
 * Browser/state behavior for the application theme. SSR never runs the
 * client-only branches: storage access is guarded, the store subscription is
 * installed by React only after hydration, and the server snapshot never
 * touches `window`.
 */

/** The one Comake localStorage key holding the theme preference. */
export const THEME_PREFERENCE_STORAGE_KEY = 'comake:theme-preference';

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): EffectiveTheme {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
}

export function readStoredThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    if (isThemePreference(stored)) {
      return stored;
    }
  } catch {
    // Storage may be blocked (private mode, privacy settings); fall back to the default.
  }
  return DEFAULT_THEME_PREFERENCE;
}

export function writeStoredThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // A persistence failure must not break the in-memory preference for this session.
  }
}

export function applyEffectiveTheme(theme: EffectiveTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function getSystemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

export interface ThemeController {
  preference: ThemePreference;
  effective: EffectiveTheme;
  setPreference: (preference: ThemePreference) => void;
}

export function useThemePreference(): ThemeController {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    typeof window === 'undefined'
      ? DEFAULT_THEME_PREFERENCE
      : readStoredThemePreference(),
  );
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemPrefersDark,
    getSystemPrefersDark,
  );
  const effective = resolveEffectiveTheme(preference, systemPrefersDark);

  useEffect(() => {
    applyEffectiveTheme(effective);
  }, [effective]);

  function setPreference(next: ThemePreference): void {
    setPreferenceState(next);
    writeStoredThemePreference(next);
  }

  return { preference, effective, setPreference };
}