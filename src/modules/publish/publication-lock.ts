import { INDEX_SCHEMAS } from "./index-schema";

/**
 * Serialisation for operations that write the published archive.
 *
 * Two things in this system write public/data: the promotion pipeline, and
 * editorial saves through /api/site-content. Neither was serialised against
 * the other, or against a second copy of itself, and two consequences follow
 * from that directly.
 *
 * First, version capture is repository-wide. createVersionFrom copies every
 * entry in VERSIONED_TYPES out of public/data, not just the type being
 * promoted — so a promotion reaching activation while a second promotion is
 * still mid-write captures that second type half-written, and then *activates*
 * it. The torn state stops being a transient window and becomes the durable,
 * addressable, active version: strictly worse than the unversioned behaviour
 * versioning was introduced to fix.
 *
 * Second, eight section manifests are both editable through the Admin and
 * regenerated at promotion time (see REGENERATED_INDEX_KEYS). Regeneration
 * reads the manifest, merges, and writes it back. A save landing inside that
 * read-modify-write is lost; a regeneration landing inside a save's own
 * validate-then-write is lost the same way.
 *
 * One lock closes both, because both are the same hazard: concurrent writers
 * on one published tree.
 *
 * Scope, stated precisely so it is not over-read:
 *
 *  - It is in-process. One Node process, one lock. Two instances sharing a
 *    volume would need a lockfile or a Postgres advisory lock instead, and
 *    this would be necessary but not sufficient.
 *  - It serialises *writers*. It does not make a reader's view atomic. For
 *    versioned types the version pointer already does that; for NSDAP, which
 *    is served live from public/data and is deliberately not versioned,
 *    nothing does — a request arriving mid-promotion can still observe a
 *    partially updated NSDAP file set. The lock removes concurrent *writers*
 *    as a cause of that; it does not remove the single-writer window.
 *
 * Deliberately not reentrant. Nothing inside a critical section may re-enter
 * it: promotion regenerates indexes through applyFileChangesAtomically rather
 * than through SiteContentService, and that separation is what keeps this
 * safe. A nested acquisition would deadlock rather than silently interleave,
 * which is the failure mode to prefer.
 */

/**
 * A FIFO async mutex.
 *
 * Each caller chains onto the previous one's completion, so entry order is
 * call order. The tail promise is only ever resolved — never rejected — so a
 * critical section that throws releases the lock and leaves the queue intact
 * rather than poisoning it.
 */
export class AsyncLock {
  private tail: Promise<void> = Promise.resolve();
  private heldCount = 0;
  private waitingCount = 0;

  /** True while a critical section is executing. */
  get held(): boolean {
    return this.heldCount > 0;
  }

  /** How many callers are queued behind the current holder. */
  get waiting(): number {
    return this.waitingCount;
  }

  /**
   * Runs `fn` with exclusive access. The lock is released whether `fn`
   * resolves or rejects, and the rejection is passed straight through.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.waitingCount++;
    await previous;
    this.waitingCount--;

    this.heldCount++;
    try {
      return await fn();
    } finally {
      this.heldCount--;
      release();
    }
  }
}

/**
 * The section manifests the promotion pipeline regenerates.
 *
 * Derived from INDEX_SCHEMAS rather than written out again. That list is
 * already the single declaration of which types have a regenerated index —
 * D6 removed the one other hand-maintained copy of it precisely because it
 * had drifted — so a type gaining or losing a schema changes what the Admin
 * coordinates against in the same edit, with nothing to keep in sync.
 */
export const REGENERATED_INDEX_KEYS: ReadonlySet<string> = new Set(
  Object.values(INDEX_SCHEMAS).map((schema) => `${schema.type}/index.json`),
);

/**
 * Whether an editorial key names a manifest regeneration owns, and therefore
 * one whose saves must be serialised against publication.
 *
 * Keys arrive from the HTTP layer as POSIX-style paths, but normalising here
 * means a backslash variant cannot slip past the check into an unserialised
 * write.
 */
export function isRegeneratedIndexKey(key: string): boolean {
  return REGENERATED_INDEX_KEYS.has(key.replace(/\\/g, "/"));
}

/**
 * A set of independent FIFO mutexes, one per key.
 *
 * Unrelated keys never wait on each other. Each key gets its own AsyncLock,
 * created on first use and then reused, so ordering within a key is call
 * order exactly as for a single lock.
 *
 * A lock is kept once created rather than deleted when it falls idle.
 * Deleting an idle lock would race: a caller that has already taken a
 * reference would serialise against a different instance than the next
 * caller creates. The key space here is the content types, which is fixed
 * and small, so retaining them costs nothing.
 */
export class KeyedAsyncLock {
  private readonly locks = new Map<string, AsyncLock>();

  private lockFor(key: string): AsyncLock {
    let lock = this.locks.get(key);
    if (!lock) {
      lock = new AsyncLock();
      this.locks.set(key, lock);
    }
    return lock;
  }

  /** Runs `fn` with exclusive access to `key`. Other keys are unaffected. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.lockFor(key).run(fn);
  }

  held(key: string): boolean {
    return this.locks.get(key)?.held ?? false;
  }

  waiting(key: string): number {
    return this.locks.get(key)?.waiting ?? 0;
  }

  /** Keys with a section currently executing. */
  get activeKeys(): string[] {
    return [...this.locks.entries()].filter(([, lock]) => lock.held).map(([key]) => key);
  }
}

/** The lock this application's publication operations share. */
export const publicationLock = new AsyncLock();

/**
 * Serialises publish runs, per content type.
 *
 * A publish run is a read-modify-write across two artefacts: it invalidates
 * the provenance record, replaces the staging directory, then records
 * completion. Two runs of the same type could interleave those steps
 * freely, and the orders that end with one run's directory beside another
 * run's record are real. The provenance gate catches the mismatch and
 * refuses, so nothing unsafe was ever promotable — but a type could be left
 * stranded in a refusing state by nothing worse than two clicks.
 *
 * Per type rather than global, because the artefacts are per type: a
 * campaigns publish and an armaments publish touch disjoint directories and
 * disjoint records, and making one wait for the other buys nothing.
 *
 * ── Why this cannot deadlock ────────────────────────────────
 *
 * Deadlock needs a cycle, and a cycle needs someone holding two locks. No
 * code path here holds more than one:
 *
 *   publish.run()                 takes stagingLock(type), and nothing else
 *   promote() / rollback()        take publicationLock, and nothing else
 *   SiteContentService write      takes publicationLock, and nothing else
 *
 * Promotion deliberately does NOT take stagingLock, even though it reads
 * staging. It does not need to: a publish invalidates the provenance record
 * BEFORE it touches the directory, and promotion reads the directory before
 * it reads the record, so a promotion that catches a directory mid-replace
 * necessarily then reads an incomplete or superseded record and refuses.
 * Taking both locks to tidy that up would create the one thing this note
 * exists to rule out.
 *
 * sourceFingerprint() is likewise left unlocked, so promotion's recompute
 * cannot block behind a publish of the same type. It is a single query and
 * is consistent on its own.
 */
export const stagingLock = new KeyedAsyncLock();
