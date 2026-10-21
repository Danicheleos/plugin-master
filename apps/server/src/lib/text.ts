/** `s` cut to `n` chars with an ellipsis. */
export const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
