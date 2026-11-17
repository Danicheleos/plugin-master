import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Rendered instead of the children after one of them threw; `reset` renders the children again. */
  fallback: (props: { error: Error; reset: () => void }) => ReactNode;
  /** The boundary resets by itself when one of these changes (e.g. the open file). */
  resetKeys?: readonly unknown[];
};
type State = { error: Error | null };

const changed = (a: readonly unknown[] = [], b: readonly unknown[] = []) =>
  a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));

/** Catches render errors of its subtree so one broken part does not blank the whole page. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    if (this.state.error && changed(prev.resetKeys, this.props.resetKeys))
      this.reset();
  }

  reset = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    return error
      ? this.props.fallback({ error, reset: this.reset })
      : this.props.children;
  }
}
