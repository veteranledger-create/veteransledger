import { readFileSync } from "fs";
import { ROUTE_MAP, TYPE_ALIASES, CanonicalType } from "../route-definitions";
import { resolveRelatedUrl, normalizeType } from "../../modules/publish/related-url-resolver";
import { buildContent, GENERATED_PATH } from "../../scripts/generate-client-resolver";

// ---------------------------------------------------------------------------
// Route map structural invariants
// ---------------------------------------------------------------------------

describe("ROUTE_MAP", () => {
  test("every canonical type maps to a /lowercase-path", () => {
    for (const [type, path] of Object.entries(ROUTE_MAP)) {
      expect(typeof type).toBe("string");
      expect(path).toMatch(/^\/[a-z][a-z-]*$/);
    }
  });

  test("all route paths are unique", () => {
    const paths = Object.values(ROUTE_MAP);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("no canonical type key is empty", () => {
    for (const key of Object.keys(ROUTE_MAP)) {
      expect(key.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// TYPE_ALIASES structural invariants
// ---------------------------------------------------------------------------

describe("TYPE_ALIASES", () => {
  const canonicalTypes = new Set<string>(Object.keys(ROUTE_MAP));

  test("every alias value is a known canonical type in ROUTE_MAP", () => {
    for (const [alias, canonical] of Object.entries(TYPE_ALIASES)) {
      expect(canonicalTypes).toContain(canonical);
    }
  });

  test("no alias key is empty", () => {
    for (const alias of Object.keys(TYPE_ALIASES)) {
      expect(alias.length).toBeGreaterThan(0);
    }
  });

  test("DB uppercase enum aliases are all present", () => {
    const required = ["CAMPAIGN", "PERSON", "ARMAMENT", "FORMATION", "ARTICLE", "LETTER"];
    for (const key of required) {
      expect(TYPE_ALIASES).toHaveProperty(key);
    }
  });

  test("letter collection name aliases are all present", () => {
    const collections = [
      "German Collection", "Italian Collection", "Japanese Collection",
      "British Collection", "Polish Collection", "Volunteers Collection",
    ];
    for (const name of collections) {
      expect(TYPE_ALIASES).toHaveProperty(name);
      expect(TYPE_ALIASES[name]).toBe("Letter");
    }
  });
});

// ---------------------------------------------------------------------------
// resolveRelatedUrl: server-side resolver (TypeScript)
// ---------------------------------------------------------------------------

describe("resolveRelatedUrl (server)", () => {
  test("resolves every canonical type correctly", () => {
    for (const [type, expectedPath] of Object.entries(ROUTE_MAP)) {
      const url = resolveRelatedUrl(type, "test-id");
      expect(url).toBe(`${expectedPath}/test-id`);
    }
  });

  test("resolves all DB uppercase aliases correctly", () => {
    const cases: Array<[string, CanonicalType]> = [
      ["CAMPAIGN",  "Campaign"],
      ["PERSON",    "Personnel"],
      ["ARMAMENT",  "Armament"],
      ["FORMATION", "Formation"],
      ["ARTICLE",   "Article"],
      ["LETTER",    "Letter"],
    ];
    for (const [alias, canonical] of cases) {
      const url = resolveRelatedUrl(alias, "test-id");
      expect(url).toBe(`${ROUTE_MAP[canonical]}/test-id`);
    }
  });

  test("resolves all letter collection aliases to /letters/id", () => {
    const collections = [
      "German Collection", "Italian Collection", "Japanese Collection",
      "British Collection", "Polish Collection", "Volunteers Collection",
    ];
    for (const col of collections) {
      expect(resolveRelatedUrl(col, "de-001")).toBe("/letters/de-001");
    }
  });

  test("unknown type falls back to /letters", () => {
    expect(resolveRelatedUrl("UnknownType", "x")).toBe("/letters/x");
  });

  test("undefined type falls back to /letters", () => {
    expect(resolveRelatedUrl(undefined, "x")).toBe("/letters/x");
  });
});

// ---------------------------------------------------------------------------
// normalizeType
// ---------------------------------------------------------------------------

describe("normalizeType", () => {
  test("returns canonical type for every alias", () => {
    for (const [alias, canonical] of Object.entries(TYPE_ALIASES)) {
      expect(normalizeType(alias)).toBe(canonical);
    }
  });

  test("passes through already-canonical types unchanged", () => {
    for (const type of Object.keys(ROUTE_MAP)) {
      expect(normalizeType(type)).toBe(type);
    }
  });

  test("undefined returns Letter", () => {
    expect(normalizeType(undefined)).toBe("Letter");
  });
});

// ---------------------------------------------------------------------------
// Generated client resolver — sync check
//
// These tests verify two things:
//   1. The file on disk is byte-for-byte identical to what buildContent()
//      produces from the current route-definitions.ts.  If this fails after
//      `npm test` (which runs `npm run generate:routes` as a pretest step),
//      it means someone manually edited the generated file — which is wrong.
//      If it fails when running `jest` directly (no pretest), the generated
//      file is stale and needs `npm run generate:routes`.
//   2. The functions in the generated JS file produce the same URLs as the
//      server-side TypeScript resolver for every type and alias.
// ---------------------------------------------------------------------------

describe("Generated client resolver (frontend/pages/shared/related-url-resolver.js)", () => {
  let jsContent: string;

  beforeAll(() => {
    try {
      jsContent = readFileSync(GENERATED_PATH, "utf-8");
    } catch {
      throw new Error(
        `Client resolver not found at ${GENERATED_PATH}.\nRun: npm run generate:routes`,
      );
    }
  });

  test("file on disk is byte-for-byte identical to buildContent() output", () => {
    expect(jsContent).toBe(buildContent());
  });

  test("exports resolveRelatedUrl and normalizeType", () => {
    expect(jsContent).toContain("export function resolveRelatedUrl");
    expect(jsContent).toContain("export function normalizeType");
  });

  test("produces identical URL output to the server resolver for all types and aliases", () => {
    const sandboxSrc = jsContent
      .replace(/^export function /gm, "function ")
      .concat("\nmodule.exports = { resolveRelatedUrl, normalizeType };");

    let clientModule: { resolveRelatedUrl: (t: string | undefined, id: string) => string };
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function("module", "exports", sandboxSrc);
      const mod = { exports: {} as Record<string, unknown> };
      fn(mod, mod.exports);
      clientModule = mod.exports as typeof clientModule;
    } catch (e) {
      throw new Error(`Failed to evaluate generated client resolver: ${e}`);
    }

    for (const type of Object.keys(ROUTE_MAP)) {
      expect(clientModule.resolveRelatedUrl(type, "test-id")).toBe(
        resolveRelatedUrl(type, "test-id"),
      );
    }

    for (const alias of Object.keys(TYPE_ALIASES)) {
      expect(clientModule.resolveRelatedUrl(alias, "test-id")).toBe(
        resolveRelatedUrl(alias, "test-id"),
      );
    }
  });
});
