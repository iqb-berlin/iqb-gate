/** The rejections of one kind within one window: the first is written, the others counted. */
interface RejectionWindow {
  startedAt: number;
  /** The row the first rejection was written to. */
  row: number;
  /** Repeats not yet added to that row. */
  uncounted: number;
}

/** Repeats to add to the row of a written rejection. */
export interface RepeatCount {
  id: number;
  count: number;
}

/**
 * Folds identical rejections of a write into one audit entry. A client that is rejected again and
 * again -- a script in a loop gets its 403 at once -- would otherwise write one row per request and
 * bury every other entry. The first rejection of a kind is written ({@link opened}); those of the
 * same kind within the window are only counted ({@link isRepeat}), and the count is added to that
 * row later ({@link drain}).
 *
 * What counts as the same kind is the caller's key. Kept in memory, like the sessions it is about:
 * there is one gateway instance.
 */
export class RepeatedRejections {
  private readonly current = new Map<string, RejectionWindow>();
  /** Windows replaced by a newer one of their kind while they still held repeats for their row. */
  private finished: RejectionWindow[] = [];

  constructor(private readonly windowMs: number) {}

  /**
   * Whether a rejection of this kind was written within the window: then this one is counted, and
   * is not to be written. A kind whose first rejection could not be written has no window, so the
   * next one is written instead of being counted for nothing.
   */
  isRepeat(key: string, now: number): boolean {
    const window = this.current.get(key);
    if (!window || now - window.startedAt >= this.windowMs) return false;
    window.uncounted += 1;
    return true;
  }

  /** The first rejection of its kind was written to `row`: its window opens. */
  opened(key: string, row: number, now: number): void {
    const previous = this.current.get(key);
    if (previous?.uncounted) this.finished.push(previous);
    this.current.set(key, { startedAt: now, row, uncounted: 0 });
  }

  /** The repeats to add to each row, counted from now on as added; forgets the windows that are over. */
  drain(now: number): RepeatCount[] {
    const counts: RepeatCount[] = [];
    const take = (window: RejectionWindow): void => {
      if (!window.uncounted) return;
      counts.push({ id: window.row, count: window.uncounted });
      window.uncounted = 0;
    };
    this.finished.forEach(take);
    this.finished = [];
    this.current.forEach(take);
    this.current.forEach((window, key) => {
      if (now - window.startedAt >= this.windowMs) this.current.delete(key);
    });
    return counts;
  }
}
