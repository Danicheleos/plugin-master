/** Push-based AsyncIterable: `push` items, `end` to finish the iteration. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiting?: (r: IteratorResult<T>) => void;
  private done = false;

  push(item: T): void {
    if (this.done) return;
    if (this.waiting) {
      this.waiting({ value: item, done: false });
      this.waiting = undefined;
    } else this.items.push(item);
  }

  end(): void {
    this.done = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length)
          return Promise.resolve({
            value: this.items.shift() as T,
            done: false,
          });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}
