import fs from "fs";
import path from "path";
import { validateContent, GENERATED_FIELDS, GeneratedSpec } from "../content-validation";
import { INDEX_SCHEMAS } from "../../publish/index-schema";

/**
 * Phase 1D — what an editorial save may contain.
 *
 * The generated-field map is checked against the real index files in this
 * checkout, so a manifest whose shape changes cannot leave the map quietly
 * describing fields that no longer exist.
 */

const PUBLIC_DATA = path.resolve(__dirname, "../../../../public/data");

describe("the body itself", () => {
  it.each([
    ["a string", "just text"],
    ["a number", 42],
    ["a boolean", true],
    ["null", null],
  ])("rejects %s, which would replace the file with a scalar", (_label, body) => {
    const failure = validateContent("homepage.json", body, { hero: "x" });
    expect(failure?.status).toBe(400);
    expect(failure?.message).toMatch(/object or array/);
  });

  it("accepts an object", () => {
    expect(validateContent("homepage.json", { hero: "y" }, { hero: "x" })).toBeNull();
  });

  it("accepts an array when the file is already an array", () => {
    expect(validateContent("legal/x.json", [1, 2], [1])).toBeNull();
  });

  it("accepts anything object-shaped for a file that does not exist yet", () => {
    expect(validateContent("legal/new.json", { a: 1 }, null)).toBeNull();
    expect(validateContent("legal/new.json", [], null)).toBeNull();
  });

  it("still rejects a scalar for a file that does not exist yet", () => {
    expect(validateContent("legal/new.json", "text", null)?.status).toBe(400);
  });
});

describe("destructive shape changes", () => {
  it("refuses to turn an object into an array", () => {
    const failure = validateContent("homepage.json", [], { hero: "x" });
    expect(failure?.status).toBe(409);
    expect(failure?.message).toMatch(/stay a JSON object/);
  });

  it("refuses to turn an array into an object", () => {
    expect(validateContent("legal/x.json", {}, [1])?.status).toBe(409);
  });

  it("refuses to drop an existing top-level field", () => {
    const failure = validateContent(
      "site-settings.json",
      { title: "VeteransLedger" },
      { title: "VeteransLedger", contact: { email: "x@y" } },
    );
    expect(failure?.status).toBe(409);
    expect(failure?.message).toMatch(/"contact"/);
  });

  it("names every dropped field", () => {
    const failure = validateContent("homepage.json", { a: 1 }, { a: 1, b: 2, c: 3 });
    expect(failure?.message).toMatch(/"b"/);
    expect(failure?.message).toMatch(/"c"/);
  });

  it("allows adding a new top-level field", () => {
    expect(validateContent("homepage.json", { a: 1, b: 2 }, { a: 1 })).toBeNull();
  });

  it("allows changing an existing field's value", () => {
    expect(validateContent("homepage.json", { a: "new" }, { a: "old" })).toBeNull();
  });
});

describe("generated fields on section manifests", () => {
  const armaments = () => ({
    categories: [
      { id: "naval", label: "Naval Vessels", nations: ["germany", "italy"] },
      { id: "panzer", label: "Panzers", nations: ["germany"] },
    ],
    nations: ["germany", "italy"],
  });

  it("allows editing a label", () => {
    const next = armaments();
    next.categories[0].label = "Kriegsmarine Vessels";
    expect(validateContent("armaments/index.json", next, armaments())).toBeNull();
  });

  it("allows reordering entries", () => {
    const next = armaments();
    next.categories.reverse();
    expect(validateContent("armaments/index.json", next, armaments())).toBeNull();
  });

  it("rejects editing a generated field, naming it", () => {
    const next = armaments();
    next.categories[0].nations = ["germany", "italy", "invented"];
    const failure = validateContent("armaments/index.json", next, armaments());
    expect(failure?.status).toBe(409);
    expect(failure?.message).toContain("categories[naval].nations");
  });

  it("rejects removing an entry", () => {
    const next = armaments();
    next.categories.pop();
    const failure = validateContent("armaments/index.json", next, armaments());
    expect(failure?.status).toBe(409);
    expect(failure?.message).toContain('"panzer"');
  });

  it("allows adding an entry", () => {
    const next = armaments();
    next.categories.push({ id: "aircraft", label: "Aircraft", nations: [] });
    expect(validateContent("armaments/index.json", next, armaments())).toBeNull();
  });

  it("rejects replacing the array with a non-array", () => {
    const failure = validateContent("armaments/index.json", { ...armaments(), categories: {} }, armaments());
    expect(failure?.status).toBe(409);
    expect(failure?.message).toMatch(/must remain an array/);
  });

  it.each([
    ["articles/index.json", "categories", "files"],
    ["campaigns/index.json", "theaters", "campaigns"],
    ["personnel/index.json", "branches", "file"],
    ["letters/index.json", "collections", "file"],
  ])("protects %s -> %s[].%s", (key, arrayKey, field) => {
    const current = { [arrayKey]: [{ id: "a", label: "A", [field]: ["original"] }] };
    const next = { [arrayKey]: [{ id: "a", label: "A", [field]: ["tampered"] }] };
    const failure = validateContent(key, next, current);
    expect(failure?.status).toBe(409);
    expect(failure?.message).toContain(`${arrayKey}[a].${field}`);
  });

  it.each(["awards/index.json", "maps/index.json", "political-docs/index.json"])(
    "%s owns each record's own fields, naming the one that was touched", (key) => {
      const current = { records: [{ id: "a", recordId: "r", title: "A" }] };
      expect(validateContent(key, { records: [{ id: "a", recordId: "r", title: "A" }] }, current)).toBeNull();

      const failure = validateContent(key, { records: [{ id: "a", recordId: "r", title: "Renamed" }] }, current);
      expect(failure?.status).toBe(409);
      expect(failure?.message).toContain("records[a].title");
    });

  it.each(["awards/index.json", "maps/index.json", "political-docs/index.json"])(
    "%s now permits the editorial metadata D4 preserves", (key) => {
      // Before D4 the whole records array was rebuilt and nothing on it
      // survived, so forbidding every change was right. D4 preserves
      // per-entry editorial fields, so forbidding them became wrong.
      const current = { heading: "Section", records: [{ id: "a", recordId: "r", title: "A" }] };
      const next = {
        heading: "Section",
        records: [{ id: "a", recordId: "r", title: "A", featured: true, curatorNote: "shown first" }],
      };
      expect(validateContent(key, next, current)).toBeNull();
    });

  it.each(["awards/index.json", "maps/index.json", "political-docs/index.json"])(
    "%s refuses a record added by hand", (key) => {
      const current = { records: [{ id: "a", recordId: "r", title: "A" }] };
      const next = { records: [{ id: "a", recordId: "r", title: "A" }, { id: "b", recordId: "r2", title: "B" }] };

      const failure = validateContent(key, next, current);
      expect(failure?.status).toBe(409);
      expect(failure?.message).toMatch(/built from the published record files/);
      expect(failure?.message).toContain('"b"');
    });

  it("leaves non-manifest editorial files unrestricted beyond shape", () => {
    const current = { sections: [{ id: "a", label: "A", file: "/x.json" }] };
    const next = { sections: [{ id: "a", label: "A", file: "/changed.json" }] };
    // nsdap/index.json has no regenerator, so nothing on it is generated.
    expect(validateContent("nsdap/index.json", next, current)).toBeNull();
  });
});

describe("the generated-field map matches this checkout", () => {
  it("names an array key that really exists in each index file", () => {
    for (const [key, spec] of Object.entries(GENERATED_FIELDS)) {
      const file = path.join(PUBLIC_DATA, key);
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
      expect(Array.isArray(parsed[spec.arrayKey])).toBe(true);
    }
  });

  it("names entry fields that really appear on those entries", () => {
    for (const [key, spec] of Object.entries(GENERATED_FIELDS)) {
      const file = path.join(PUBLIC_DATA, key);
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
      const entries = parsed[spec.arrayKey] as Array<Record<string, unknown>>;
      if (entries.length === 0) continue; // awards/maps/political-docs are empty
      for (const field of spec.fields) {
        // Optional projected fields are only present when a record supplies
        // one; the always-present ones must really be on the entry.
        if (!spec.ownsEntry) expect(Object.keys(entries[0])).toContain(field);
      }
    }
  });

  it("covers exactly the eight allowlisted section manifests", () => {
    expect(Object.keys(GENERATED_FIELDS).sort()).toEqual([
      "armaments/index.json", "articles/index.json", "awards/index.json",
      "campaigns/index.json", "letters/index.json", "maps/index.json",
      "personnel/index.json", "political-docs/index.json",
    ]);
  });
});

/**
 * D6 — validation's generated-field rules come from INDEX_SCHEMAS.
 *
 * They used to be a second hand-written list, and it drifted exactly as a
 * duplicated declaration does: when letters.count became derived in D5, this
 * list still called it editorial, so the API would have accepted a count the
 * next regeneration silently discarded. These tests assert the two can no
 * longer disagree, for every field of every schema.
 */
describe("validation is derived from INDEX_SCHEMAS", () => {
  it("covers every schema, and only schemas", () => {
    const fromSchemas = Object.values(INDEX_SCHEMAS).map((s) => `${s.type}/index.json`).sort();
    expect(Object.keys(GENERATED_FIELDS).sort()).toEqual(fromSchemas);
    expect(fromSchemas).toHaveLength(8);
  });

  it("claims exactly the fields each schema declares — no more, no fewer", () => {
    for (const schema of Object.values(INDEX_SCHEMAS)) {
      const spec = GENERATED_FIELDS[`${schema.type}/index.json`];
      expect(spec.arrayKey).toBe(schema.arrayKey);
      expect([...spec.fields].sort()).toEqual([...schema.generated].sort());
    }
  });

  it("includes letters.count, which the old hand-written list had missed", () => {
    expect(GENERATED_FIELDS["letters/index.json"].fields).toContain("count");
    expect(INDEX_SCHEMAS.letters.generated).toContain("count");
  });

  it("derives entry ownership from the schema rather than a separate flag", () => {
    for (const schema of Object.values(INDEX_SCHEMAS)) {
      const spec = GENERATED_FIELDS[`${schema.type}/index.json`];
      expect(spec.ownsEntry).toBe(schema.generated.includes("id"));
      // Which lines up with the orphan policy: a type that rebuilds entries
      // from record files is the one that drops entries with no file.
      expect(spec.ownsEntry).toBe(schema.orphanPolicy === "drop");
    }
  });

  it("cannot be mutated at runtime", () => {
    expect(Object.isFrozen(GENERATED_FIELDS)).toBe(true);
  });
});

describe("every pipeline-owned field is rejected, for every schema", () => {
  /** A minimal current index for a type, with one entry carrying `field`. */
  const fixtureFor = (arrayKey: string, field: string, value: unknown) => ({
    [arrayKey]: [{ id: "a", label: "A", recordId: "r", title: "T", [field]: value }],
  });

  /** A value that differs from `value`, whatever its type. */
  const altered = (value: unknown): unknown => {
    if (Array.isArray(value)) return [...value, "added"];
    if (typeof value === "number") return value + 1;
    if (typeof value === "boolean") return !value;
    return `${String(value)}-edited`;
  };

  const ORIGINALS: Record<string, unknown> = {
    nations: ["germany"], files: ["/public/data/x/y.json"], campaigns: ["barbarossa"],
    file: "/public/data/x/a.json", count: 4,
    id: "a", recordId: "r", title: "T",
    nation: "germany", summary: "s", image: "/i.png", theater: "east", year: 1941, date: "1938-01-01",
  };

  it("rejects an edit to each declared field of each schema, naming it", () => {
    let checked = 0;
    for (const schema of Object.values(INDEX_SCHEMAS)) {
      const key = `${schema.type}/index.json`;
      for (const field of schema.generated) {
        // `id` is the match key: changing it reads as removing one entry and
        // adding another, which the entry rules already refuse.
        if (field === "id") continue;

        const original = ORIGINALS[field];
        expect(original).toBeDefined(); // the fixture must know every field
        const current = fixtureFor(schema.arrayKey, field, original);
        const next = fixtureFor(schema.arrayKey, field, altered(original));

        const failure = validateContent(key, next, current);
        expect(failure?.status).toBe(409);
        expect(failure?.message).toContain(`${schema.arrayKey}[a].${field}`);
        checked++;
      }
    }
    // 1 + 1 + 1 + 1 + 2 container fields, plus 5 each for three flat types.
    expect(checked).toBe(21);
  });

  it("rejects a hand-edited letters count specifically", () => {
    const current = {
      note: "ordered by significance",
      collections: [{ id: "german", label: "German", language: "de", file: "/public/data/letters/german.json", count: 4 }],
    };
    const next = JSON.parse(JSON.stringify(current)) as typeof current;
    next.collections[0].count = 99;

    const failure = validateContent("letters/index.json", next, current);
    expect(failure?.status).toBe(409);
    expect(failure?.message).toContain("collections[german].count");
    expect(failure?.message).toMatch(/regenerated from the published content/);
  });
});

describe("legitimate editorial edits still pass, for every schema", () => {
  const EDITORIAL_FIXTURES: Array<[string, string, Record<string, unknown>]> = [
    ["armaments/index.json", "categories", { id: "naval", label: "Naval", nations: ["germany"] }],
    ["articles/index.json", "categories", { id: "military", label: "Military", files: [] }],
    ["campaigns/index.json", "theaters", { id: "africa", label: "Africa", campaigns: [] }],
    ["personnel/index.json", "branches", { id: "army", label: "Army", file: "/public/data/personnel/army.json" }],
    ["letters/index.json", "collections", { id: "german", label: "German", language: "de", file: "/public/data/letters/german.json", count: 4 }],
    ["awards/index.json", "records", { id: "a", recordId: "r", title: "T" }],
    ["maps/index.json", "records", { id: "a", recordId: "r", title: "T" }],
    ["political-docs/index.json", "records", { id: "a", recordId: "r", title: "T" }],
  ];

  it.each(EDITORIAL_FIXTURES)("%s accepts a label and unknown-metadata edit", (key, arrayKey, entry) => {
    const current = { [arrayKey]: [entry] };
    const next = {
      [arrayKey]: [{ ...entry, ...(("label" in entry) ? { label: "Renamed by an editor" } : {}),
        featured: true, curatorNote: "shown first", sortWeight: 2 }],
    };
    expect(validateContent(key, next, current)).toBeNull();
  });

  it.each(EDITORIAL_FIXTURES)("%s accepts a reordering", (key, arrayKey, entry) => {
    const second = { ...entry, id: "second" };
    const current = { [arrayKey]: [entry, second] };
    const next = { [arrayKey]: [second, entry] };
    expect(validateContent(key, next, current)).toBeNull();
  });

  it("keeps letters label, language and the top-level note editable", () => {
    const current = {
      note: "ordered by significance",
      collections: [{ id: "german", label: "German", language: "de", file: "/public/data/letters/german.json", count: 4 }],
    };
    const next = {
      note: "re-ordered for the 1945 exhibition",
      houseStyle: { showCounts: false },
      collections: [{ id: "german", label: "German correspondence", language: "de-DE", file: "/public/data/letters/german.json", count: 4, highlight: true }],
    };
    expect(validateContent("letters/index.json", next, current)).toBeNull();
  });

  it("still allows a container to be created by hand", () => {
    // Container types do not own entry identity, so an administrator may add
    // a category before any content is published into it.
    const current = { categories: [{ id: "naval", label: "Naval", nations: [] }] };
    const next = { categories: [{ id: "naval", label: "Naval", nations: [] }, { id: "rocketry", label: "Rocketry" }] };
    expect(validateContent("armaments/index.json", next, current)).toBeNull();
  });
});

describe("nested generated fields are checked at the right level", () => {
  // No schema declares a nested path yet. The spec map is injectable so the
  // behaviour is proved now rather than discovered later.
  const NESTED: Record<string, GeneratedSpec> = {
    "armaments/index.json": {
      arrayKey: "categories",
      entryKey: "id",
      fields: ["metadata.generatedSlug"],
      ownsEntry: false,
    },
  };

  const current = {
    categories: [{
      id: "naval", label: "Naval",
      metadata: { generatedSlug: "naval-vessels", editorsNote: "keep this" },
    }],
  };

  it("rejects an edit to the owned leaf", () => {
    const next = JSON.parse(JSON.stringify(current)) as typeof current;
    next.categories[0].metadata.generatedSlug = "tampered";

    const failure = validateContent("armaments/index.json", next, current, NESTED);
    expect(failure?.status).toBe(409);
    expect(failure?.message).toContain("categories[naval].metadata.generatedSlug");
  });

  it("permits edits to its siblings in the same object", () => {
    const next = JSON.parse(JSON.stringify(current)) as typeof current;
    next.categories[0].metadata.editorsNote = "revised";
    expect(validateContent("armaments/index.json", next, current, NESTED)).toBeNull();
  });

  it("permits adding a sibling, and does not treat the container as owned", () => {
    const next = JSON.parse(JSON.stringify(current)) as typeof current;
    (next.categories[0].metadata as Record<string, unknown>).newNote = "added";
    expect(validateContent("armaments/index.json", next, current, NESTED)).toBeNull();
  });

  it("treats a removed parent object as a change to the owned leaf", () => {
    const next = { categories: [{ id: "naval", label: "Naval" }] };
    const failure = validateContent("armaments/index.json", next, current, NESTED);
    expect(failure?.status).toBe(409);
    expect(failure?.message).toContain("metadata.generatedSlug");
  });
});

describe("the validation layer stays independent of the database", () => {
  /** Follows relative imports from a file, transitively. */
  function importGraph(entry: string): string[] {
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = fs.readFileSync(file, "utf-8");
      for (const m of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        const resolved = path.resolve(path.dirname(file), m[1]);
        for (const candidate of [`${resolved}.ts`, path.join(resolved, "index.ts")]) {
          if (fs.existsSync(candidate)) { walk(candidate); break; }
        }
      }
    };
    walk(entry);
    return [...seen];
  }

  it("reaches no prisma or database module, transitively", () => {
    const entry = path.resolve(__dirname, "../content-validation.ts");
    const graph = importGraph(entry);

    // The graph really did expand — otherwise this would pass vacuously.
    expect(graph.length).toBeGreaterThan(3);
    expect(graph.some((f) => f.endsWith("index-schema.ts"))).toBe(true);

    for (const file of graph) {
      const source = fs.readFileSync(file, "utf-8");
      expect(source).not.toMatch(/from\s+["'][^"']*prisma/i);
      expect(source).not.toMatch(/from\s+["'][^"']*\/database\//);
      expect(source).not.toMatch(/PrismaClient/);
    }
  });
});
