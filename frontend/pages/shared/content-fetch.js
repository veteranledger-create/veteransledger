/**
 * VeteransLedger · version-aware archive content fetching
 *
 * Every archive page loads an index and then fetches records whose URLs came
 * out of that index. Those are separate HTTP requests, so a promotion landing
 * between them used to mean the records could come from different content
 * than the index that named them — a mixed-version page.
 *
 * The server answers an index request with an `X-Content-Version` header
 * naming the exact version the bytes came from. This module pins the
 * follow-up record requests to that same version with `?v=`, so a page load
 * resolves entirely within one version no matter how many promotions happen
 * while it is loading.
 *
 * Deliberately NOT a window.fetch override: a silent global would catch
 * unrelated requests and be invisible at the call sites that depend on it.
 * Pages opt in by using a session.
 *
 * Retention is finite, so a version can be pruned out from under a long-lived
 * tab. The server then answers 410 Gone rather than quietly substituting
 * current content, and `session.load()` recovers by re-reading the index and
 * re-running the whole load against the new version — never by continuing
 * with the stale index.
 */

/**
 * @typedef {{ data: unknown, version: string|null }} ContentResult
 * @typedef {(url: string) => Promise<unknown>} RecordFetcher
 * @typedef {{ version: string|null, attempt: number }} LoadMeta
 */

/** Versions are retained for a while, but not forever. */
export class ContentVersionGoneError extends Error {
  /** @param {string|null|undefined} requestedVersion @param {string|null} activeVersion */
  constructor(requestedVersion, activeVersion) {
    super(`Content version ${requestedVersion} is no longer available`);
    this.name = "ContentVersionGoneError";
    this.requestedVersion = requestedVersion;
    this.activeVersion = activeVersion;
  }
}

/** Recovery was attempted and did not converge. Terminal, and loud. */
export class ContentUnavailableError extends Error {
  /** @param {string} message @param {number} attempts */
  constructor(message, attempts) {
    super(message);
    this.name = "ContentUnavailableError";
    this.attempts = attempts;
  }
}

/**
 * Renders a terminal content failure where the records would have gone.
 *
 * Listing pages have no "not found" state to fall back on, and silently
 * rendering an empty grid would read as "there is nothing here" rather than
 * "this could not be loaded". The message is set as text, never HTML — it
 * can carry a server-supplied version identifier.
 *
 * @param {Element|null} el
 * @param {unknown} error
 */
export function renderContentError(el, error) {
  if (!el) return;
  const wrap = document.createElement("div");
  wrap.className = "empty-state";

  const icon = document.createElement("div");
  icon.className = "empty-state__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⚠";

  const title = document.createElement("p");
  title.className = "empty-state__title";
  title.textContent = "Content unavailable";

  const text = document.createElement("p");
  text.className = "empty-state__text";
  text.textContent = error instanceof Error ? error.message : String(error);

  wrap.append(icon, title, text);
  el.replaceChildren(wrap);
}

/** How many times a load is re-run against a fresher version before giving up. */
export const MAX_RELOAD_ATTEMPTS = 3;

const VERSION_HEADER = "X-Content-Version";

/** @param {string} url @param {string|null|undefined} version @returns {string} */
function withVersion(url, version) {
  if (!version) return url;
  // Preserve any query the caller already has; never clobber it.
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(version)}`;
}

/**
 * One archive request. Returns the parsed body and the version that served
 * it. A 410 throws, because the caller's index belongs to a version that no
 * longer exists and silently answering from another one is exactly the
 * mixed-version state this module prevents.
 *
 * Every other failure resolves to `null`, matching how these pages have
 * always treated a missing or unreadable content file.
 */
/**
 * @param {string} url
 * @param {{ version?: string|null }} [options]
 * @returns {Promise<ContentResult>}
 */
export async function fetchContentJson(url, options = {}) {
  const { version } = options;
  let res;
  try {
    res = await fetch(withVersion(url, version));
  } catch (_) {
    return { data: null, version: null };
  }

  if (res.status === 410) {
    let body = null;
    try { body = await res.json(); } catch (_) { /* body is advisory only */ }
    throw new ContentVersionGoneError(version, body?.activeVersion ?? null);
  }

  if (!res.ok) return { data: null, version: res.headers.get(VERSION_HEADER) };

  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  return { data, version: res.headers.get(VERSION_HEADER) };
}

/**
 * A single page load's view of one section.
 *
 * The index promise is memoized for the life of the page, as it always has
 * been — but it now carries the version it was served from, and record
 * requests are pinned to that version, so a cached index can never silently
 * resolve records from a different one. The cache is dropped only when the
 * server says its version is gone.
 */
/**
 * @param {string} indexUrl
 * @param {{ loadIndex?: (url: string) => Promise<ContentResult> }} [options]
 */
export function createContentSession(indexUrl, options = {}) {
  const loadIndex = options.loadIndex ?? ((url) => fetchContentJson(url));
  /** @type {ContentResult|null} */
  let cached = null;

  async function index() {
    if (!cached) cached = await loadIndex(indexUrl);
    return cached;
  }

  function invalidate() {
    cached = null;
  }

  /**
   * Runs a load that reads the index and then fetches records from it.
   *
   * `run` receives the index body and a `record(url)` function already bound
   * to the index's version. If any record request reports its version gone,
   * the index is re-read and the whole of `run` is executed again against the
   * new one — both halves move together, so the page never mixes an old index
   * with new records.
   */
  /**
   * @template T
   * @param {(index: unknown, record: RecordFetcher, meta: LoadMeta) => Promise<T>} run
   * @returns {Promise<T>}
   */
  async function load(run) {
    /** @type {ContentVersionGoneError|null} */
    let lastGone = null;

    for (let attempt = 1; attempt <= MAX_RELOAD_ATTEMPTS; attempt++) {
      const current = await index();
      const pinned = current.version;

      /** @type {RecordFetcher} */
      const record = async (url) => {
        const { data } = await fetchContentJson(url, { version: pinned });
        return data;
      };

      try {
        return await run(current.data, record, { version: pinned, attempt });
      } catch (err) {
        if (!(err instanceof ContentVersionGoneError)) throw err;
        lastGone = err;
        invalidate(); // next attempt re-reads the index, and the records with it
      }
    }

    throw new ContentUnavailableError(
      `Archive content kept changing while this page was loading. Gave up after ` +
        `${MAX_RELOAD_ATTEMPTS} attempts (last known active version: ` +
        `${lastGone?.activeVersion ?? "unknown"}). Reload the page to try again.`,
      MAX_RELOAD_ATTEMPTS,
    );
  }

  return { index, load, invalidate, get version() { return cached?.version ?? null; } };
}
