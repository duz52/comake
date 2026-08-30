import { Select } from '@base-ui/react/select';
import { useEffect, useState } from 'react';
import { useThemePreference } from '../lib/theme';
import type { ThemePreference } from '../types/theme';

const PREFERENCE_LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const PREFERENCE_OPTIONS: readonly ThemePreference[] = ['light', 'dark', 'system'];

function valueLabel(preference: ThemePreference, effective: ThemePreference): string {
  return preference === 'system'
    ? `System · ${PREFERENCE_LABELS[effective]}`
    : PREFERENCE_LABELS[preference];
}

/**
 * Accessible theme control: a semantic Base UI Select whose value is the
 * persisted preference. The trigger also states the effective theme so the
 * user always knows what System resolves to right now.
 *
 * The value label depends on localStorage and the OS scheme, which only exist
 * after hydration. Rendering it in the server markup would mismatch the
 * client's first paint, so the trigger shows a static placeholder until
 * mount; the live value replaces it afterwards.
 */
export function ThemeToggle() {
  const { preference, effective, setPreference } = useThemePreference();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Select.Root<ThemePreference>
      onValueChange={(value) => {
        if (value) {
          setPreference(value);
        }
      }}
      value={preference}
    >
      <Select.Trigger aria-label="App theme" className="theme-toggle">
        <span aria-hidden="true" className="theme-toggle-swatch" />
        {mounted ? (
          <Select.Value>
            {(value: ThemePreference | null) => valueLabel(value ?? 'system', effective)}
          </Select.Value>
        ) : (
          'Theme'
        )}
        <Select.Icon aria-hidden="true" className="theme-toggle-chevron">
          ▾
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner align="end" sideOffset={6}>
          <Select.Popup aria-label="App theme" className="theme-menu">
            {PREFERENCE_OPTIONS.map((option) => (
              <Select.Item className="theme-menu-item" key={option} value={option}>
                {PREFERENCE_LABELS[option]}
                <Select.ItemIndicator className="theme-menu-check">
                  ✓
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}