import {
  fetchContentJson,
  createContentSession,
  ContentVersionGoneError,
  ContentUnavailableError,
  MAX_RELOAD_ATTEMPTS,
} from "../content-fetch";

/**
 * Phase 1C — the client half of version pinning.
 *
 * The server contract is covered against a real HTTP server in
 * src/modules/publish/__tests__/version-resolver.test.ts. What is tested here
 * is the behaviour that contract requires of the client: pinning records to
 * the index's version, recovering from a pruned version by reloading both
 * halves, bounding that recovery, and failing loudly when it does not
 * converge.
 */

interface Reply {
  status?: number;
  version?: string | null;
  body?: unknown;
  networkError?: boolean;
}

let calls: string[];
let replies: (url: string) => Reply;

function install(): void {
  calls = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    calls.push(url);
    const r = replies(url);
    if (r.networkError) throw new TypeError("Failed to fetch");
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h: string) => (h.toLowerCase() === "x-content-version" ? r.version ?? null : null) },
      json: async () => {
        if (r.body === undefined) throw new SyntaxError("not json");
        return r.body;
      },
    };
  };
}

/** The query-less part of a recorded call, for readable assertions. */
const pathsCalled = (): string[] => calls.map((c) => c.split("?")[0]);
const versionsCalled = (): Array<string | null> =>
  calls.map((c) => new URLSearchParams(c.split("?")[1] ?? "").get("v"));

beforeEach(install);

describe("fetchContentJson", () => {
  it("returns the body and the version that served it", async () => {
    replies = () => ({ version: "v41", body: { marker: "A" } });
    const res = await fetchContentJson("/public/data/armaments/index.json");
    expect(res.data).toEqual({ marker: "A" });
    expect(res.version).toBe("v41");
    expect(calls).toEqual(["/public/data/armaments/index.json"]);
  });

  it("pins a request to a version without clobbering an existing query", async () => {
    replies = () => ({ version: "v41", body: {} });
    await fetchContentJson("/public/data/a.json", { version: "v41" });
    await fetchContentJson("/public/data/b.json?lang=de", { version: "v41" });
    expect(calls).toEqual(["/public/data/a.json?v=v41", "/public/data/b.json?lang=de&v=v41"]);
  });

  it("throws when the version is gone, carrying the active one", async () => {
    replies = () => ({ status: 410, body: { activeVersion: "v44", requestedVersion: "v41" } });
    const err = await fetchContentJson("/public/data/x.json", { version: "v41" }).catch((e) => e);
    expect(err).toBeInstanceOf(ContentVersionGoneError);
    expect(err.requestedVersion).toBe("v41");
    expect(err.activeVersion).toBe("v44");
  });

  it("still reports a missing file as null, as these pages always have", async () => {
    replies = () => ({ status: 404 });
    expect((await fetchContentJson("/public/data/missing.json")).data).toBeNull();
  });

  it("still reports a network failure as null", async () => {
    replies = () => ({ networkError: true });
    expect((await fetchContentJson("/public/data/x.json")).data).toBeNull();
  });

  it("reports unparseable content as null rather than throwing", async () => {
    replies = () => ({ version: "v1" }); // body undefined -> json() throws
    expect((await fetchContentJson("/public/data/x.json")).data).toBeNull();
  });
});

describe("a session pins records to the index it read", () => {
  it("sends the index's version on every record request", async () => {
    replies = (url) =>
      url.includes("index.json")
        ? { version: "v41", body: { files: ["a.json", "b.json"] } }
        : { version: "v41", body: { marker: "A" } };

    const session = createContentSession("/public/data/armaments/index.json");
    const out = await session.load(async (index, record) => {
      const files = (index as { files: string[] }).files;
      return Promise.all(files.map((f) => record(`/public/data/armaments/${f}`)));
    });

    expect(out).toEqual([{ marker: "A" }, { marker: "A" }]);
    expect(versionsCalled()).toEqual([null, "v41", "v41"]); // index unpinned, records pinned
    expect(session.version).toBe("v41");
  });

  it("reuses one index across loads, as a long-lived tab does", async () => {
    replies = (url) =>
      url.includes("index.json") ? { version: "v41", body: { n: 1 } } : { version: "v41", body: { marker: "A" } };

    const session = createContentSession("/public/data/armaments/index.json");
    for (let i = 0; i < 4; i++) {
      await session.load(async (_index, record) => record("/public/data/armaments/a.json"));
    }

    // One index fetch, four record fetches — and every record still pinned.
    expect(pathsCalled().filter((p) => p.endsWith("index.json"))).toHaveLength(1);
    expect(versionsCalled().filter((v) => v === "v41")).toHaveLength(4);
  });

  it("keeps a cached index pinned to its own version after the server moves on", async () => {
    let activeVersion = "v41";
    replies = (url) =>
      url.includes("index.json")
        ? { version: activeVersion, body: { marker: activeVersion } }
        : { version: "v41", body: { marker: "A" } };

    const session = createContentSession("/public/data/armaments/index.json");
    await session.load(async (_i, record) => record("/public/data/armaments/a.json"));

    activeVersion = "v99"; // promotions happen while the tab sits open

    await session.load(async (index, record) => {
      // The cached index is still v41's, so records must still ask for v41 —
      // never silently resolve against whatever is active now.
      expect(index).toEqual({ marker: "v41" });
      return record("/public/data/armaments/b.json");
    });

    expect(versionsCalled()).toEqual([null, "v41", "v41"]);
  });
});

describe("recovering from a pruned version", () => {
  it("reloads the index and re-runs the whole load against the new one", async () => {
    let indexVersion = "v41";
    let indexBody: unknown = { marker: "old" };
    replies = (url) => {
      if (url.includes("index.json")) return { version: indexVersion, body: indexBody };
      const asked = new URLSearchParams(url.split("?")[1] ?? "").get("v");
      if (asked === "v41") return { status: 410, body: { activeVersion: "v44" } };
      return { version: asked, body: { marker: "new" } };
    };

    const seen: unknown[] = [];
    const session = createContentSession("/public/data/armaments/index.json");

    const result = await session.load(async (index, record) => {
      seen.push(index);
      // The server prunes v41 between the two loads.
      indexVersion = "v44";
      indexBody = { marker: "fresh" };
      return record("/public/data/armaments/a.json");
    });

    expect(result).toEqual({ marker: "new" });
    // The second attempt ran against the NEW index, not the stale one.
    expect(seen).toEqual([{ marker: "old" }, { marker: "fresh" }]);
    expect(pathsCalled().filter((p) => p.endsWith("index.json"))).toHaveLength(2);
    expect(versionsCalled()).toEqual([null, "v41", null, "v44"]);
  });

  it("never answers from active content while still holding the old index", async () => {
    replies = (url) => {
      if (url.includes("index.json")) return { version: "v41", body: { marker: "old" } };
      return { status: 410, body: { activeVersion: "v44" } };
    };

    const indexesSeen: unknown[] = [];
    const session = createContentSession("/public/data/armaments/index.json");
    const err = await session
      .load(async (index, record) => {
        indexesSeen.push(index);
        return record("/public/data/armaments/a.json");
      })
      .catch((e) => e);

    // Every attempt re-read the index; none fell back to unpinned content.
    expect(indexesSeen).toHaveLength(MAX_RELOAD_ATTEMPTS);
    expect(versionsCalled().filter((v) => v === null)).toHaveLength(MAX_RELOAD_ATTEMPTS);
    expect(err).toBeInstanceOf(ContentUnavailableError);
  });

  it("bounds the retries and fails with a clear, actionable error", async () => {
    replies = (url) =>
      url.includes("index.json")
        ? { version: "v41", body: {} }
        : { status: 410, body: { activeVersion: "v44" } };

    const session = createContentSession("/public/data/armaments/index.json");
    const err = (await session
      .load(async (_i, record) => record("/public/data/armaments/a.json"))
      .catch((e) => e)) as ContentUnavailableError;

    expect(err).toBeInstanceOf(ContentUnavailableError);
    expect(err.attempts).toBe(MAX_RELOAD_ATTEMPTS);
    expect(err.message).toContain("v44");
    expect(err.message).toMatch(/reload/i);

    const recordCalls = versionsCalled().filter((v) => v !== null);
    expect(recordCalls).toHaveLength(MAX_RELOAD_ATTEMPTS);
  });

  it("lets an unrelated error through untouched", async () => {
    replies = () => ({ version: "v41", body: {} });
    const session = createContentSession("/public/data/armaments/index.json");
    const boom = new Error("page bug");
    await expect(session.load(async () => { throw boom; })).rejects.toBe(boom);
    // No retry storm for an error that has nothing to do with versioning.
    expect(pathsCalled().filter((p) => p.endsWith("index.json"))).toHaveLength(1);
  });
});

describe("when the server is not versioning content", () => {
  it("sends no version and behaves like a plain fetch", async () => {
    replies = () => ({ version: null, body: { marker: "A" } });
    const session = createContentSession("/public/data/armaments/index.json");
    const out = await session.load(async (_i, record) => record("/public/data/armaments/a.json"));
    expect(out).toEqual({ marker: "A" });
    expect(calls).toEqual(["/public/data/armaments/index.json", "/public/data/armaments/a.json"]);
  });
});
