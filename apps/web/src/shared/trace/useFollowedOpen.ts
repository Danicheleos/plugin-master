import { useState } from 'react';

/**
 * Open state that follows `byDefault` (e.g. "is the last group") until the user toggles it;
 * from then on it keeps what the user chose, also when the default changes.
 */
export function useFollowedOpen(byDefault: boolean) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? byDefault;
  return [open, () => setChosen(!open)] as const;
}
