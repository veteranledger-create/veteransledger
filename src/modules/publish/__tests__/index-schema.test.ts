import fs from "fs";
import os from "os";
import path from "path";
import {
  INDEX_SCHEMAS,
  CorruptIndexError,
  CorruptRecordError,
  regenerateIndex,
  schemaFor,
} from "../index-schema";

/**
 * D4 — schema-driven index regeneration.
 *
 * Every test builds a throwaway directory shaped like a promoted section and
 * runs the real engine against it. Nothing under public/data is read or
 * written, no promotion is performed, and PROMOTION_ENABLED is untouched.
 */

const CONTAINER_TYPES = ["armaments", "articles", "campaigns", "personnel", "letters"] as const;
const FLAT_TYPES = ["awards", "maps", "political-docs"] as const;
const ALL_TYPES = [...CONTAINER_TYPES, ...FLAT_TYPES];

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vl-index-schema-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const write = (rel: string, content: string): void => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
};
const writeIndex = (value: unknown): void => write("index.json", JSON.stringify(value, null, 2));
const readIndex = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(tmp, "index.json"), "utf-8"));

/** Runs the engine and applies its output, as a promotion would. */
async function regenerate(type: string): Promise<{ notes: string[]; changed: boolean }> {
  const result = await regenerateIndex(type, tmp);
  if (!result) return { notes: [], changed: false };
  write(result.relPath, result.content);
  return { notes: result.notes, changed: true };
}

/**
 * A fixture per type: the index as an administrator curated it, plus the
 * published output it describes. Deliberately includes editorial ordering
 * that differs from alphabetical, and fields the engine knows nothing about.
 */
const FIXTURES: Record<string, { index: unknown; files: Array<[string, string]>; arrayKey: string }> = {
  armaments: {
    arrayKey: "categories",
    index: {
      nations: ["germany", "italy"],
      houseNote: "ordering is deliberate",
      categories: [
        { id: "panzer", label: "Panzers & Armour", nations: ["germany"], featured: true },
        { id: "naval", label: "Naval Vessels", nations: ["germany"] },
      ],
    },
    files: [
      ["panzer/germany.json", "[]"],
      ["panzer/italy.json", "[]"],
      ["naval/germany.json", "[]"],
      ["armaments.archive.json", '{"active":[],"obsolete":[]}'],
    ],
  },
  articles: {
    arrayKey: "categories",
    index: {
      editorialNote: "military first",
      categories: [
        { id: "military", label: "Military", files: [], curatedBy: "jc" },
        { id: "legal", label: "Legal", files: [] },
      ],
    },
    files: [
      ["military/poland-1939.json", "{}"],
      ["legal/nuremberg.json", "{}"],
      ["articles.archive.json", '{"active":[],"obsolete":[]}'],
    ],
  },
  campaigns: {
    arrayKey: "theaters",
    index: {
      theaters: [
        { id: "eastern-front", label: "Eastern Front", campaigns: [], priority: 1 },
        { id: "africa", label: "North Africa", campaigns: [] },
      ],
    },
    files: [
      ["eastern-front/barbarossa.json", "{}"],
      ["africa/tobruk.json", "{}"],
      ["campaigns.archive.json", '{"active":[],"obsolete":[]}'],
    ],
  },
  personnel: {
    arrayKey: "branches",
    index: {
      branches: [
        { id: "army", label: "Heer (Army)", file: "/public/data/personnel/army.json", showFirst: true },
        { id: "luftwaffe", label: "Luftwaffe", file: "/public/data/personnel/luftwaffe.json" },
      ],
    },
    files: [["army.json", "[]"], ["luftwaffe.json", "[]"]],
  },
  letters: {
    arrayKey: "collections",
    index: {
      note: "collections are ordered by significance, not alphabet",
      collections: [
        { id: "german", label: "German", language: "de", file: "/public/data/letters/german.json", count: 4 },
        { id: "italian", label: "Italian", language: "it", file: "/public/data/letters/italian.json", count: 4 },
      ],
    },
    files: [["german.json", "[]"], ["italian.json", "[]"]],
  },
  awards: {
    arrayKey: "records",
    index: {
      heading: "Decorations",
      records: [
        { id: "ek1", recordId: "r1", title: "Iron Cross 1st Class", featured: true },
        { id: "knights-cross", recordId: "r9", title: "Knight's Cross" },
      ],
    },
    files: [
      ["ek1.json", '{"id":"ek1","recordId":"r1","title":"Iron Cross 1st Class","nation":"germany"}'],
      ["knights-cross.json", '{"id":"knights-cross","recordId":"r9","title":"Knight\'s Cross"}'],
    ],
  },
  maps: {
    arrayKey: "records",
    index: {
      heading: "Cartography",
      records: [
        { id: "barbarossa-map", recordId: "m1", title: "Barbarossa", pinned: true },
        { id: "kursk-salient", recordId: "m9", title: "Kursk Salient" },
      ],
    },
    files: [
      ["barbarossa-map.json", '{"id":"barbarossa-map","recordId":"m1","title":"Barbarossa","year":1941}'],
      ["kursk-salient.json", '{"id":"kursk-salient","recordId":"m9","title":"Kursk Salient"}'],
    ],
  },
  "political-docs": {
    arrayKey: "records",
    index: {
      heading: "Papers",
      records: [
        { id: "anschluss", recordId: "p1", title: "Anschluss", reviewed: true },
        { id: "nuremberg-laws", recordId: "p9", title: "Nuremberg Laws" },
      ],
    },
    files: [
      ["anschluss.json", '{"id":"anschluss","recordId":"p1","title":"Anschluss","date":"1938-03-12"}'],
      ["nuremberg-laws.json", '{"id":"nuremberg-laws","recordId":"p9","title":"Nuremberg Laws"}'],
    ],
  },
};

function buildFixture(type: string): void {
  const f = FIXTURES[type];
  writeIndex(f.index);
  for (const [rel, content] of f.files) write(rel, content);
}

const entries = (type: string): Array<Record<string, unknown>> =>
  readIndex()[FIXTURES[type].arrayKey] as Array<Record<string, unknown>>;
const ids = (type: string): string[] => entries(type).map((e) => e.id as string);

// ── the schemas themselves ────────────────────────────────────

describe("the declared schemas", () => {
  it("covers exactly the eight versioned section types", () => {
    expect(Object.keys(INDEX_SCHEMAS).sort()).toEqual([...ALL_TYPES].sort());
  });

  it("declares no schema for types with no regenerated index", () => {
    for (const type of ["formations", "nsdap", "timeline", "unknown"]) {
      expect(schemaFor(type)).toBeNull();
    }
  });

  it("returns null for a type with no schema", async () => {
    expect(await regenerateIndex("formations", tmp)).toBeNull();
    expect(await regenerateIndex("nsdap", tmp)).toBeNull();
  });

  it("gives container types retain and flat types drop", () => {
    for (const t of CONTAINER_TYPES) expect(INDEX_SCHEMAS[t].orphanPolicy).toBe("retain");
    for (const t of FLAT_TYPES) expect(INDEX_SCHEMAS[t].orphanPolicy).toBe("drop");
  });

  it("matches the real index structures in this checkout", () => {
    const PUBLIC_DATA = path.resolve(__dirname, "../../../../public/data");
    for (const [type, schema] of Object.entries(INDEX_SCHEMAS)) {
      const file = path.join(PUBLIC_DATA, type, "index.json");
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
      expect(Array.isArray(parsed[schema.arrayKey])).toBe(true);
    }
  });
});

// ── per-type behaviour, all eight ─────────────────────────────

describe.each(ALL_TYPES)("%s", (type) => {
  const isFlat = (FLAT_TYPES as readonly string[]).includes(type);

  it("adding a record preserves editorial fields and ordering", async () => {
    buildFixture(type);
    const before = ids(type);

    // Publish one more record into an existing container / as a new record.
    if (type === "armaments") write("naval/italy.json", "[]");
    else if (type === "articles") write("military/rearmament.json", "{}");
    else if (type === "campaigns") write("africa/gazala.json", "{}");
    else if (type === "personnel") write("army.json", "[]");
    else if (type === "letters") write("german.json", "[]");
    else if (type === "awards") write("zz-war-merit.json", '{"id":"zz-war-merit","recordId":"r2","title":"War Merit Cross"}');
    else if (type === "maps") write("zz-ardennes.json", '{"id":"zz-ardennes","recordId":"m2","title":"Ardennes"}');
    else write("zz-july-20.json", '{"id":"zz-july-20","recordId":"p2","title":"July 20"}');

    await regenerate(type);

    // Existing entries stay put, at the front, in their original order.
    expect(ids(type).slice(0, before.length)).toEqual(before);

    // Every editorial field on the first entry survives.
    const first = entries(type)[0];
    const originalFirst = (FIXTURES[type].index as Record<string, unknown[]>)[FIXTURES[type].arrayKey][0] as Record<string, unknown>;
    for (const [k, v] of Object.entries(originalFirst)) {
      if (INDEX_SCHEMAS[type].generated.includes(k)) continue;
      expect(first[k]).toEqual(v);
    }
  });

  it("keeps unknown safe fields, at entry and top level", async () => {
    buildFixture(type);
    await regenerate(type);

    const index = readIndex();
    // Top-level fields the engine knows nothing about.
    for (const [k, v] of Object.entries(FIXTURES[type].index as Record<string, unknown>)) {
      if (k === FIXTURES[type].arrayKey) continue;
      expect(index[k]).toEqual(v);
    }
    // Per-entry custom fields.
    const custom = entries(type)[0];
    const marker = ["featured", "curatedBy", "priority", "showFirst", "count", "pinned", "reviewed"].find(
      (k) => k in custom,
    );
    expect(marker).toBeDefined();
  });

  it("recomputes its generated fields from the published directory", async () => {
    buildFixture(type);
    await regenerate(type);

    const first = entries(type)[0];
    if (isFlat) {
      // The flat projection carries id/recordId/title always, and the other
      // declared fields only when the record actually supplies them.
      for (const field of ["id", "recordId", "title"]) expect(first).toHaveProperty(field);
    } else {
      for (const field of INDEX_SCHEMAS[type].generated) expect(first).toHaveProperty(field);
    }
    if (type === "armaments") expect(first.nations).toEqual(["germany", "italy"]);
    if (type === "articles") expect(first.files).toEqual(["/public/data/articles/military/poland-1939.json"]);
    if (type === "campaigns") expect(first.campaigns).toEqual(["barbarossa"]);
    if (type === "personnel") expect(first.file).toBe("/public/data/personnel/army.json");
    if (type === "letters") expect(first.file).toBe("/public/data/letters/german.json");
    if (type === "awards") expect(first.nation).toBe("germany");
    if (type === "maps") expect(first.year).toBe(1941);
    if (type === "political-docs") expect(first.date).toBe("1938-03-12");
  });

  it("appends newly discovered entries in sorted id order", async () => {
    buildFixture(type);
    const before = ids(type);

    // Three new containers / records, created out of alphabetical order.
    const newIds = ["zeta", "alpha", "mid"];
    for (const id of newIds) {
      if (type === "armaments") write(`${id}/germany.json`, "[]");
      else if (type === "articles") write(`${id}/x.json`, "{}");
      else if (type === "campaigns") write(`${id}/x.json`, "{}");
      else if (isFlat) write(`${id}.json`, `{"id":"${id}","recordId":"r-${id}","title":"${id}"}`);
      else write(`${id}.json`, "[]");
    }

    const { notes } = await regenerate(type);
    expect(ids(type)).toEqual([...before, "alpha", "mid", "zeta"]);
    expect(notes.join(" ")).toContain("appended 3");
  });

  it("follows its declared orphan policy", async () => {
    buildFixture(type);
    await regenerate(type); // settle

    // Remove everything backing the SECOND entry.
    const secondId = ids(type)[1];
    if (type === "armaments" || type === "articles" || type === "campaigns") {
      fs.rmSync(path.join(tmp, secondId), { recursive: true, force: true });
    } else {
      fs.rmSync(path.join(tmp, `${secondId}.json`), { force: true });
    }

    const { notes, changed } = await regenerate(type);

    if (isFlat) {
      // drop: the entry goes, because an entry is one record file.
      expect(ids(type)).not.toContain(secondId);
      expect(notes.join(" ")).toContain("dropped");
      return;
    }

    // retain: the container survives with its label intact.
    expect(ids(type)).toContain(secondId);
    const entry = entries(type).find((e) => e.id === secondId)!;
    expect(entry.label).toBeDefined();

    const field = INDEX_SCHEMAS[type].generated[0];
    if (type === "personnel") {
      // personnel's only generated field is a URL derived from the id, not
      // from the file's existence — so an unpublished branch keeps the same
      // value and the index does not change at all.
      expect(entry[field]).toBe("/public/data/personnel/" + secondId + ".json");
      expect(changed).toBe(false);
    } else if (type === "letters") {
      // letters derives its URL from the id the same way, but it also derives
      // count from the file — which is gone, so the count is removed and the
      // index does change.
      expect(entry.file).toBe("/public/data/letters/" + secondId + ".json");
      expect(entry).not.toHaveProperty("count");
      expect(changed).toBe(true);
      expect(notes.join(" ")).toContain("retained");
    } else {
      // Their generated field is a listing of published content, which is
      // now empty. A stale listing would make the index claim files exist.
      expect(entry[field]).toEqual([]);
      expect(notes.join(" ")).toContain("retained");
    }
  });

  it("a failed regeneration leaves the index exactly as it was", async () => {
    buildFixture(type);
    const before = fs.readFileSync(path.join(tmp, "index.json"), "utf-8");

    // Corrupt the index, which must abort rather than rewrite.
    fs.writeFileSync(path.join(tmp, "index.json"), `${before.slice(0, 20)} <<<broken`, "utf-8");
    const broken = fs.readFileSync(path.join(tmp, "index.json"), "utf-8");

    await expect(regenerateIndex(type, tmp)).rejects.toBeInstanceOf(CorruptIndexError);
    // Not partially overwritten — byte-identical to the broken input.
    expect(fs.readFileSync(path.join(tmp, "index.json"), "utf-8")).toBe(broken);
  });

  it("returns null when nothing changed", async () => {
    buildFixture(type);
    await regenerate(type);
    expect(await regenerateIndex(type, tmp)).toBeNull();
  });
});

// ── cross-cutting ─────────────────────────────────────────────

describe("importer manifests", () => {
  it.each([["campaigns", "campaigns.archive.json"], ["articles", "articles.archive.json"]])(
    "%s regeneration leaves %s untouched and unindexed", async (type, manifest) => {
      buildFixture(type);
      const before = fs.readFileSync(path.join(tmp, manifest));

      await regenerate(type);

      expect(fs.existsSync(path.join(tmp, manifest))).toBe(true);
      expect(fs.readFileSync(path.join(tmp, manifest)).equals(before)).toBe(true);
      // And it was never mistaken for a published record.
      expect(ids(type)).not.toContain(manifest.replace(".json", ""));
      expect(JSON.stringify(readIndex())).not.toContain("archive.json");
    });

  it("armaments regeneration leaves armaments.archive.json untouched", async () => {
    buildFixture("armaments");
    const before = fs.readFileSync(path.join(tmp, "armaments.archive.json"));
    await regenerate("armaments");
    expect(fs.readFileSync(path.join(tmp, "armaments.archive.json")).equals(before)).toBe(true);
  });

  it("does not index a flat type's protected root files as records", async () => {
    // A flat type with a stray protected-looking file present.
    writeIndex({ records: [] });
    write("ek1.json", '{"id":"ek1","recordId":"r1","title":"Iron Cross"}');
    write("awards.archive.json", '{"active":[]}'); // not declared for awards
    await regenerate("awards");
    // index.json is always protected; awards declares no importer input, so a
    // stray archive-shaped file IS treated as a record if it has an id — this
    // one has none, so it is skipped.
    expect(ids("awards")).toEqual(["ek1"]);
  });
});

describe("flat indexes preserve top-level fields", () => {
  it.each(FLAT_TYPES)("%s keeps its top-level editorial fields", async (type) => {
    buildFixture(type);
    await regenerate(type);
    expect(readIndex().heading).toBe((FIXTURES[type].index as Record<string, unknown>).heading);
  });

  it.each(FLAT_TYPES)("%s keeps per-entry editorial fields across regeneration", async (type) => {
    buildFixture(type);
    await regenerate(type);
    const entry = entries(type)[0];
    const editorialMarker = ["featured", "pinned", "reviewed"].find((k) => k in entry);
    expect(editorialMarker).toBeDefined();
    expect(entry[editorialMarker as string]).toBe(true);
  });

  it("would have lost those fields under the previous {records} rebuild", async () => {
    // Pins the defect D4 fixes: the old regenerateFlatIndex returned
    // { records } with no spread of the current index at all.
    buildFixture("awards");
    const current = readIndex();
    const oldBehaviour = { records: [{ id: "ek1", recordId: "r1", title: "Iron Cross 1st Class", nation: "germany" }] };
    expect(oldBehaviour).not.toHaveProperty("heading");
    expect(current).toHaveProperty("heading");

    await regenerate("awards");
    expect(readIndex()).toHaveProperty("heading");
    expect(entries("awards")[0]).toHaveProperty("featured", true);
  });
});

describe("missing versus corrupt indexes", () => {
  it("generates from the declared skeleton when the index is absent, and says so", async () => {
    write("panzer/germany.json", "[]");
    const { notes } = await regenerate("armaments");

    expect(notes.join(" ")).toMatch(/was absent; generated from the declared default skeleton/);
    const index = readIndex();
    expect(Array.isArray(index.categories)).toBe(true);
    // The declared defaults, with generated fields filled from what exists.
    expect(ids("armaments")).toContain("panzer");
    expect(entries("armaments").find((e) => e.id === "panzer")!.nations).toEqual(["germany"]);
    expect(entries("armaments").find((e) => e.id === "panzer")!.label).toBe("Panzers & Armour");
  });

  it("uses an empty skeleton for types that declare one", async () => {
    write("eastern-front/barbarossa.json", "{}");
    const { notes } = await regenerate("campaigns");
    expect(notes.join(" ")).toMatch(/was absent/);
    expect(ids("campaigns")).toEqual(["eastern-front"]);
  });

  it.each([
    ["invalid JSON", "{ not json"],
    ["a JSON array", "[]"],
    ["a scalar", '"a string"'],
    ["a non-array arrayKey", '{"categories":"oops"}'],
  ])("aborts on %s rather than replacing it", async (_label, body) => {
    write("index.json", body);
    write("panzer/germany.json", "[]");

    await expect(regenerateIndex("armaments", tmp)).rejects.toBeInstanceOf(CorruptIndexError);
    // Left exactly as found — never replaced by a skeleton.
    expect(fs.readFileSync(path.join(tmp, "index.json"), "utf-8")).toBe(body);
  });

  it("names the type and the reason in the error", async () => {
    write("index.json", "{ not json");
    const err: unknown = await regenerateIndex("letters", tmp).catch((e) => e);
    expect(err).toBeInstanceOf(CorruptIndexError);
    const corrupt = err as CorruptIndexError;
    expect(corrupt.type).toBe("letters");
    expect(corrupt.message).toContain("letters/index.json");
    expect(corrupt.message).toMatch(/not valid JSON/);
    expect(corrupt.message).toMatch(/Fix or remove the file/);
  });

  it("treats a missing arrayKey as empty, not corrupt", async () => {
    writeIndex({ note: "no collections yet" });
    write("german.json", "[]");
    await expect(regenerateIndex("letters", tmp)).resolves.not.toBeNull();
    await regenerate("letters");
    expect(readIndex().note).toBe("no collections yet");
    expect(ids("letters")).toEqual(["german"]);
  });
});

describe("administrator ordering survives", () => {
  it("keeps a deliberately non-alphabetical order through a promotion", async () => {
    // letters is ordered by significance in the real archive, not alphabet.
    writeIndex({
      collections: [
        { id: "german", label: "German", file: "" },
        { id: "italian", label: "Italian", file: "" },
        { id: "japanese", label: "Japanese", file: "" },
        { id: "british", label: "British", file: "" },
      ],
    });
    for (const id of ["british", "german", "italian", "japanese"]) write(`${id}.json`, "[]");

    await regenerate("letters");
    expect(ids("letters")).toEqual(["german", "italian", "japanese", "british"]);
  });

  it("does not let directory order override the index, for articles", async () => {
    // The previous articles regenerator iterated directories, so this order
    // would have been rewritten to alphabetical.
    writeIndex({
      categories: [
        { id: "military", label: "Military", files: [] },
        { id: "political", label: "Political", files: [] },
        { id: "economy", label: "Economy", files: [] },
      ],
    });
    for (const dir of ["economy", "military", "political"]) write(`${dir}/x.json`, "{}");

    await regenerate("articles");
    expect(ids("articles")).toEqual(["military", "political", "economy"]);
  });

  it("carries through an entry with no id rather than discarding it", async () => {
    writeIndex({ collections: [{ label: "Unlabelled legacy entry", note: "no id" }, { id: "german", label: "German", file: "" }] });
    write("german.json", "[]");

    await regenerate("letters");
    const all = entries("letters");
    expect(all[0]).toEqual({ label: "Unlabelled legacy entry", note: "no id" });
    expect(all[1].id).toBe("german");
  });
});

describe("regeneration never reads the database", () => {
  it("the schema module imports no database or prisma code", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../index-schema.ts"), "utf-8");
    expect(source).not.toMatch(/from\s+["'].*prisma/i);
    expect(source).not.toMatch(/from\s+["'].*database/i);
    expect(source).not.toMatch(/PrismaClient/);
  });

  it("derives entries only from files on disk", async () => {
    // An index naming a record that exists nowhere on disk must not gain
    // content, and a record on disk must not gain fields it does not have.
    writeIndex({ records: [{ id: "ghost", recordId: "g", title: "Ghost" }] });
    write("real.json", '{"id":"real","recordId":"r","title":"Real"}');

    await regenerate("awards");
    expect(ids("awards")).toEqual(["real"]); // ghost dropped, nothing invented
    expect(entries("awards")[0]).toEqual({ id: "real", recordId: "r", title: "Real" });
  });
});

/**
 * D4 follow-up — pipeline-owned fields on the flat record indexes.
 *
 * Every field a schema declares as generated belongs to the publishing
 * pipeline. Previously the projection cherry-picked only the fields a record
 * happened to supply, so a field absent from the record kept whatever value
 * was already in the index — a hand-typed value, or one left over from a
 * record that used to carry it. Both outlived the record they described.
 *
 * The rule now: a declared field is the record's value when the record
 * supplies one, and absent otherwise. Fields the schema does not declare are
 * untouched either way.
 */
describe.each(FLAT_TYPES)("pipeline-owned fields on %s", (type) => {
  const schema = INDEX_SCHEMAS[type];
  /** The declared fields beyond the three every record carries. */
  const optionalFields = schema.generated.filter((f) => !["id", "recordId", "title"].includes(f));

  /** A record file for an entry, carrying only the fields given. */
  const record = (id: string, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ id, recordId: `r-${id}`, title: `Title ${id}`, ...extra });

  it("declares at least one optional pipeline-owned field", () => {
    expect(optionalFields.length).toBeGreaterThan(0);
  });

  it.each(optionalFields)("removes a stale %s when the record no longer supplies it", async (field) => {
    // The index carries a value the record does not.
    writeIndex({ records: [{ id: "x", recordId: "r-x", title: "Title x", [field]: "stale value" }] });
    write("x.json", record("x"));

    await regenerate(type);

    const entry = entries(type)[0];
    expect(entry).not.toHaveProperty(field);
    expect(JSON.stringify(readIndex())).not.toContain("stale value");
  });

  it.each(optionalFields)("does not preserve a hand-entered %s", async (field) => {
    // Settle first, so the index is exactly what the pipeline produces.
    writeIndex({ records: [] });
    write("x.json", record("x"));
    await regenerate(type);
    expect(entries(type)[0]).not.toHaveProperty(field);

    // An administrator adds the field by hand.
    const index = readIndex();
    (index.records as Array<Record<string, unknown>>)[0][field] = "typed by hand";
    writeIndex(index);

    // The next promotion takes it back: this field is not theirs to set.
    await regenerate(type);
    expect(entries(type)[0]).not.toHaveProperty(field);
  });

  it.each(optionalFields)("writes %s from the record when it is supplied", async (field) => {
    writeIndex({ records: [] });
    write("x.json", record("x", { [field]: "from the record" }));
    await regenerate(type);
    expect(entries(type)[0][field]).toBe("from the record");
  });

  it.each(optionalFields)("replaces an outdated %s rather than keeping both", async (field) => {
    writeIndex({ records: [{ id: "x", recordId: "r-x", title: "Title x", [field]: "old" }] });
    write("x.json", record("x", { [field]: "new" }));
    await regenerate(type);
    expect(entries(type)[0][field]).toBe("new");
  });

  it("leaves unknown editorial fields untouched while clearing owned ones", async () => {
    const stale = Object.fromEntries(optionalFields.map((f) => [f, "stale"]));
    writeIndex({
      heading: "Curated section",
      records: [{
        id: "x", recordId: "r-x", title: "Title x", ...stale,
        // Not declared by any schema — editorial metadata.
        featured: true, curatorNote: "shown on the landing page", sortWeight: 3,
      }],
    });
    write("x.json", record("x"));

    await regenerate(type);

    const entry = entries(type)[0];
    for (const field of optionalFields) expect(entry).not.toHaveProperty(field);
    // Everything the schema does not claim survived, exactly.
    expect(entry.featured).toBe(true);
    expect(entry.curatorNote).toBe("shown on the landing page");
    expect(entry.sortWeight).toBe(3);
    expect(readIndex().heading).toBe("Curated section");
  });

  it("clears an owned field the record sets to null or empty string", async () => {
    const field = optionalFields[0];
    writeIndex({ records: [{ id: "x", recordId: "r-x", title: "Title x", [field]: "was set" }] });
    write("x.json", record("x", { [field]: "" }));
    await regenerate(type);
    expect(entries(type)[0]).not.toHaveProperty(field);

    writeIndex({ records: [{ id: "y", recordId: "r-y", title: "Title y", [field]: "was set" }] });
    write("y.json", record("y", { [field]: null }));
    await regenerate(type);
    expect(entries(type).find((e) => e.id === "y")).not.toHaveProperty(field);
  });

  it("keeps a falsy-but-real owned value", async () => {
    // Plain truthiness would have discarded these; they are real values.
    const field = optionalFields[0];
    writeIndex({ records: [] });
    write("zero.json", record("zero", { [field]: 0 }));
    write("no.json", record("no", { [field]: false }));
    await regenerate(type);

    expect(entries(type).find((e) => e.id === "zero")![field]).toBe(0);
    expect(entries(type).find((e) => e.id === "no")![field]).toBe(false);
  });

  it("does not broaden ownership beyond the declared list", async () => {
    writeIndex({ records: [] });
    // A record carrying a field no schema declares.
    write("x.json", JSON.stringify({
      id: "x", recordId: "r-x", title: "Title x", undeclaredFromRecord: "should not be indexed",
    }));
    await regenerate(type);

    const entry = entries(type)[0];
    expect(entry).not.toHaveProperty("undeclaredFromRecord");
    // The entry holds only declared fields the record supplied.
    expect(Object.keys(entry).sort()).toEqual(["id", "recordId", "title"]);
  });
});

describe("ownership rules are consistent across all eight schemas", () => {
  it("every flat schema projects exactly its declared fields", async () => {
    for (const type of FLAT_TYPES) {
      const schema = INDEX_SCHEMAS[type];
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vl-proj-${type}-`));
      try {
        // A record carrying every declared field plus an undeclared one.
        const raw: Record<string, unknown> = { id: "p", recordId: "rp", title: "T", extra: "x" };
        for (const f of schema.generated) if (!(f in raw)) raw[f] = `v-${f}`;
        fs.writeFileSync(path.join(dir, "p.json"), JSON.stringify(raw), "utf-8");

        const projected = await schema.scan(dir);
        expect([...projected.keys()]).toEqual(["p"]);
        // Exactly the declared keys, no more and no fewer.
        expect(Object.keys(projected.get("p")!).sort()).toEqual([...schema.generated].sort());
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("container schemas answer for every generated field on the retain path", () => {
    // The one deliberate exception: a collection with no published file has
    // an unknown number of letters, so count is cleared rather than asserted
    // as 0. It is still answered for — the key is present with an explicit
    // undefined — which is what distinguishes a deliberate clear from a
    // schema that simply forgot a field.
    const DELIBERATELY_CLEARED: Record<string, string[]> = { letters: ["count"] };

    for (const type of CONTAINER_TYPES) {
      const schema = INDEX_SCHEMAS[type];
      const absent = schema.absentGenerated("some-id");
      const cleared = DELIBERATELY_CLEARED[type] ?? [];

      for (const field of schema.generated) {
        expect(Object.keys(absent)).toContain(field);
        if (cleared.includes(field)) expect(absent[field]).toBeUndefined();
        else expect(absent[field]).not.toBeUndefined();
      }
    }
  });

  it("flat schemas own their whole entry; container schemas own only what they derive", () => {
    for (const type of FLAT_TYPES) {
      expect(INDEX_SCHEMAS[type].generated).toContain("id");
      expect(INDEX_SCHEMAS[type].generated.length).toBeGreaterThan(3);
    }
    // Containers own their published-content listing, and nothing that
    // identifies or describes the container itself.
    const OWNED: Record<string, string[]> = {
      armaments: ["nations"],
      articles: ["files"],
      campaigns: ["campaigns"],
      personnel: ["file"],
      letters: ["file", "count"], // count is derived from the published file
    };
    for (const type of CONTAINER_TYPES) {
      expect([...INDEX_SCHEMAS[type].generated].sort()).toEqual([...OWNED[type]].sort());
      expect(INDEX_SCHEMAS[type].generated).not.toContain("id");
      expect(INDEX_SCHEMAS[type].generated).not.toContain("label");
    }
  });

  it("no schema claims a field that is editorial by definition", () => {
    // count is deliberately absent from this list: it is a count OF published
    // content, so it is derived, not editorial. language and label describe
    // the collection itself and stay with the administrator.
    const editorialOnly = ["label", "language", "note", "heading", "featured"];
    for (const [type, schema] of Object.entries(INDEX_SCHEMAS)) {
      for (const field of editorialOnly) {
        expect(schema.generated).not.toContain(field);
      }
      expect(schema.type).toBe(type);
    }
  });

  it("letters claims count, and nothing else claims it", () => {
    expect(INDEX_SCHEMAS.letters.generated).toContain("count");
    for (const [type, schema] of Object.entries(INDEX_SCHEMAS)) {
      if (type === "letters") continue;
      expect(schema.generated).not.toContain("count");
    }
  });
});

/**
 * D5 — letters.count is derived from the published collection file.
 *
 * It used to be editorial: preserved verbatim from the index and never
 * recomputed, so it drifted silently. In the live archive, japanese and
 * volunteers both claim 2 while holding 4 letters.
 *
 * Counting semantics, verified against the published data and the pipeline
 * rather than assumed: a collection file is a top-level JSON array whose
 * elements are one letter each — 24 elements across the six live files, every
 * one with its own id and recordId, none containing a nested list. That is
 * also exactly what generateFiles stages. The { letters: [...] } wrapper is
 * accepted because both public readers accept it. Any other shape is refused
 * rather than counted.
 */
describe("letters.count", () => {
  /** A collection file holding `n` distinct letters, as the pipeline writes it. */
  const collection = (id: string, n: number): string =>
    JSON.stringify(
      Array.from({ length: n }, (_, i) => ({
        id: `${id}-${String(i + 1).padStart(3, "0")}`,
        recordId: `rec-${id}-${i}`,
        collection: id,
        subject: `Letter ${i + 1}`,
      })),
      null,
      2,
    );

  const collectionEntry = (id: string, count: number, extra: Record<string, unknown> = {}) => ({
    id,
    label: capitaliseId(id),
    language: id,
    file: `/public/data/letters/${id}.json`,
    count,
    ...extra,
  });

  const capitaliseId = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);
  const countOf = (id: string): unknown => entries("letters").find((e) => e.id === id)?.count;

  it("counts every one of the six real collections accurately", async () => {
    // The six live collections, with their real letter counts.
    const real: Array<[string, number]> = [
      ["german", 4], ["italian", 4], ["japanese", 4],
      ["volunteers", 4], ["british", 4], ["polish", 4],
    ];
    writeIndex({
      note: "ordered by significance",
      collections: real.map(([id]) => collectionEntry(id, 0)),
    });
    for (const [id, n] of real) write(`${id}.json`, collection(id, n));

    await regenerate("letters");

    for (const [id, n] of real) expect(countOf(id)).toBe(n);
    // 24 letters across six collections, as in the live archive.
    expect(entries("letters").reduce((sum, e) => sum + (e.count as number), 0)).toBe(24);
  });

  it("corrects the japanese and volunteers 2-versus-4 discrepancies", async () => {
    // Exactly the live drift: the index says 2, the files hold 4.
    writeIndex({
      note: "ordered by significance",
      collections: [
        collectionEntry("german", 4),
        collectionEntry("japanese", 2),
        collectionEntry("volunteers", 2),
      ],
    });
    write("german.json", collection("german", 4));
    write("japanese.json", collection("japanese", 4));
    write("volunteers.json", collection("volunteers", 4));

    await regenerate("letters");

    expect(countOf("japanese")).toBe(4);
    expect(countOf("volunteers")).toBe(4);
    expect(countOf("german")).toBe(4);
    // And the editorial layer came through untouched.
    expect(readIndex().note).toBe("ordered by significance");
    expect(ids("letters")).toEqual(["german", "japanese", "volunteers"]);
  });

  it("follows the count up when a letter is added", async () => {
    writeIndex({ collections: [collectionEntry("german", 0)] });
    write("german.json", collection("german", 4));
    await regenerate("letters");
    expect(countOf("german")).toBe(4);

    write("german.json", collection("german", 5));
    await regenerate("letters");
    expect(countOf("german")).toBe(5);
  });

  it("follows the count down when a letter is removed", async () => {
    writeIndex({ collections: [collectionEntry("german", 0)] });
    write("german.json", collection("german", 4));
    await regenerate("letters");

    write("german.json", collection("german", 1));
    await regenerate("letters");
    expect(countOf("german")).toBe(1);
  });

  it("reports zero for a published but empty collection", async () => {
    writeIndex({ collections: [collectionEntry("german", 4)] });
    write("german.json", "[]");
    await regenerate("letters");
    // Published and genuinely empty is a real zero, distinct from unknown.
    expect(countOf("german")).toBe(0);
  });

  it("accepts the { letters: [...] } wrapper both readers tolerate", async () => {
    writeIndex({ collections: [collectionEntry("german", 0)] });
    write("german.json", JSON.stringify({ letters: JSON.parse(collection("german", 3)) }));
    await regenerate("letters");
    expect(countOf("german")).toBe(3);
  });

  it("removes the count when the collection file is not published", async () => {
    writeIndex({ collections: [collectionEntry("german", 4), collectionEntry("polish", 4)] });
    write("german.json", collection("german", 4));
    // polish.json is deliberately absent.

    await regenerate("letters");

    // Retained, with its editorial fields, but no count — an absent file
    // means the number is unknown, and 0 would be a false claim.
    const polish = entries("letters").find((e) => e.id === "polish")!;
    expect(polish.label).toBe("Polish");
    expect(polish.language).toBe("polish");
    expect(polish).not.toHaveProperty("count");
    expect(JSON.stringify(readIndex())).not.toContain('"count": 4,\n        "x"');
    expect(countOf("german")).toBe(4);
  });

  it("never carries a hand-entered count", async () => {
    writeIndex({ collections: [collectionEntry("german", 0)] });
    write("german.json", collection("german", 4));
    await regenerate("letters");
    expect(countOf("german")).toBe(4);

    // An administrator edits the number by hand.
    const index = readIndex();
    (index.collections as Array<Record<string, unknown>>)[0].count = 99;
    writeIndex(index);

    await regenerate("letters");
    expect(countOf("german")).toBe(4);
  });

  it("gives a newly discovered collection a real count", async () => {
    writeIndex({ collections: [collectionEntry("german", 4)] });
    write("german.json", collection("german", 4));
    write("hungarian.json", collection("hungarian", 7));

    const { notes } = await regenerate("letters");

    expect(ids("letters")).toEqual(["german", "hungarian"]);
    expect(countOf("hungarian")).toBe(7);
    expect(entries("letters")[1].label).toBe("Hungarian");
    expect(notes.join(" ")).toContain("hungarian");
  });

  it.each([
    ["invalid JSON", "{ not json"],
    ["a scalar", '"four letters"'],
    ["a number", "4"],
    ["null", "null"],
    ["an object with no letters array", '{"total":4,"items":{"a":1}}'],
    ["an object whose letters is not an array", '{"letters":4}'],
  ])("aborts rather than counting %s", async (_label, body) => {
    writeIndex({ collections: [collectionEntry("german", 4)] });
    const before = fs.readFileSync(path.join(tmp, "index.json"), "utf-8");
    write("german.json", body);

    await expect(regenerateIndex("letters", tmp)).rejects.toBeInstanceOf(CorruptRecordError);
    // The index is left exactly as it was — no partial write, no wrong count.
    expect(fs.readFileSync(path.join(tmp, "index.json"), "utf-8")).toBe(before);
  });

  it("names the file and the reason when it refuses", async () => {
    writeIndex({ collections: [collectionEntry("german", 4)] });
    write("german.json", "{ not json");

    const err: unknown = await regenerateIndex("letters", tmp).catch((e) => e);
    expect(err).toBeInstanceOf(CorruptRecordError);
    const corrupt = err as CorruptRecordError;
    expect(corrupt.type).toBe("letters");
    expect(corrupt.recordPath).toBe("german.json");
    expect(corrupt.message).toMatch(/not valid JSON/);
    expect(corrupt.message).toMatch(/Fix or remove the file/);
  });

  it("one malformed collection does not let the others write a half-correct index", async () => {
    writeIndex({
      collections: [collectionEntry("german", 4), collectionEntry("japanese", 2)],
    });
    const before = fs.readFileSync(path.join(tmp, "index.json"), "utf-8");
    write("german.json", collection("german", 4));
    write("japanese.json", "{ broken");

    await expect(regenerateIndex("letters", tmp)).rejects.toBeInstanceOf(CorruptRecordError);
    // japanese is still wrong at 2, because nothing was written at all.
    expect(fs.readFileSync(path.join(tmp, "index.json"), "utf-8")).toBe(before);
    expect(JSON.parse(before).collections[1].count).toBe(2);
  });

  it("preserves label, language, note, ordering and unknown metadata", async () => {
    writeIndex({
      note: "collections are ordered by significance, not alphabet",
      houseStyle: { showCounts: true },
      collections: [
        collectionEntry("german", 1, { curatorNote: "start here", sortWeight: 1 }),
        collectionEntry("italian", 1),
        collectionEntry("british", 1, { highlight: true }),
      ],
    });
    for (const id of ["british", "german", "italian"]) write(`${id}.json`, collection(id, 3));

    await regenerate("letters");

    const index = readIndex();
    // Administrator ordering, not alphabetical.
    expect(ids("letters")).toEqual(["german", "italian", "british"]);
    expect(index.note).toBe("collections are ordered by significance, not alphabet");
    expect(index.houseStyle).toEqual({ showCounts: true });

    const german = entries("letters")[0];
    expect(german.label).toBe("German");
    expect(german.language).toBe("german");
    expect(german.curatorNote).toBe("start here");
    expect(german.sortWeight).toBe(1);
    expect(german.count).toBe(3); // the only field that moved
    expect(entries("letters")[2].highlight).toBe(true);
  });

  it("changes nothing when every count is already right", async () => {
    writeIndex({ collections: [collectionEntry("german", 3)] });
    write("german.json", collection("german", 3));
    expect(await regenerateIndex("letters", tmp)).toBeNull();
  });

  it("counts from the published file, never from a database", async () => {
    // There is no database in this process; the count must come from bytes
    // on disk and the schema module must not import one.
    const source = fs.readFileSync(path.resolve(__dirname, "../index-schema.ts"), "utf-8");
    expect(source).not.toMatch(/from\s+["'].*prisma/i);
    expect(source).not.toMatch(/from\s+["'].*database/i);

    writeIndex({ collections: [collectionEntry("german", 0)] });
    write("german.json", collection("german", 2));
    await regenerate("letters");
    expect(countOf("german")).toBe(2);

    // Change only the file, and the count follows only the file.
    write("german.json", collection("german", 6));
    await regenerate("letters");
    expect(countOf("german")).toBe(6);
  });

  it("ignores protected root files when counting collections", async () => {
    writeIndex({ collections: [collectionEntry("german", 0)] });
    write("german.json", collection("german", 2));
    await regenerate("letters");
    // index.json is protected and must not become a collection of its own.
    expect(ids("letters")).toEqual(["german"]);
  });
});
