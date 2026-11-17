import { useComputedColorScheme } from '@mantine/core';

/** The Monaco theme matching the Mantine color scheme. */
export function useMonacoTheme(): 'vs-dark' | 'vs' {
  return useComputedColorScheme('light') === 'dark' ? 'vs-dark' : 'vs';
}
