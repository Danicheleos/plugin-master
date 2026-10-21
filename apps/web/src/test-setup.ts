import { afterEach } from 'vitest';

// evals settings persist in localStorage: start every test from the defaults
afterEach(() => localStorage.clear());

// Mantine needs these browser APIs, which jsdom lacks.

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

window.ResizeObserver = class {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
};

// Textarea `autosize` listens to font loading
Object.defineProperty(document, 'fonts', {
  value: { addEventListener: () => undefined, removeEventListener: () => undefined },
});
