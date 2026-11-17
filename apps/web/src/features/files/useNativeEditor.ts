import { usePersistentFlag } from '../../shared/storage';

const KEY = 'pm.files.plainEditor';

/** Touch-first device: the primary pointer is coarse, or touch points exist and there is no hovering fine pointer. */
export function isTouchDevice(): boolean {
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true;
    return (
      navigator.maxTouchPoints > 0 &&
      !window.matchMedia('(any-pointer: fine)').matches
    );
  } catch {
    return false;
  }
}

/** Plain (native textarea / pre) editor instead of Monaco; defaults to touch detection, a manual choice is remembered. */
export function usePlainEditor() {
  return usePersistentFlag(KEY, isTouchDevice);
}
