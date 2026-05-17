/**
 * Lock-free async queue that bridges push-based notifications
 * into a pull-based AsyncGenerator. Used to convert ACP
 * sessionUpdate callbacks into an iterable stream.
 */
export class AsyncQueue<T> {
  private buffer: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private finished = false;
  private err: Error | null = null;

  push(item: T): void {
    if (this.finished) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  finish(): void {
    this.finished = true;
    for (const waiter of this.waiters) {
      waiter({ value: undefined as unknown as T, done: true });
    }
    this.waiters = [];
  }

  abort(error: Error): void {
    this.err = error;
    this.finished = true;
    for (const waiter of this.waiters) {
      waiter({ value: undefined as unknown as T, done: true });
    }
    this.waiters = [];
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!;
        continue;
      }
      if (this.finished) {
        if (this.err) throw this.err;
        return;
      }
      const result = await new Promise<IteratorResult<T>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (result.done) {
        if (this.err) throw this.err;
        return;
      }
      yield result.value;
    }
  }
}
