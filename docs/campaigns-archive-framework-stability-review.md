# Campaigns Archive Framework — Stability Review

Architecture review only. No behavior was modified to produce this document — see the verification section at the end for what was checked without changing anything.

## 1. Common behavior vs. policy, per base class

### `BaseArchiveManifestLoader<T>` (`archive-manifest-loader.ts`)

| Behavior | Common (mechanism) or policy? |
|---|---|
| `fs.readFileSync` + try/catch → `loadError` | **Common.** Identical for every archive type — a file read either succeeds or it doesn't, and the failure message shape doesn't vary. |
| `JSON.parse` + try/catch → `loadError` | **Common.** Same reasoning. |
| Never throws, degrades to an empty manifest on any failure | **Common.** This is a cross-cutting safety property (loaders sit on the live server's boot path via each archive type's generator), not something any archive type should be allowed to opt out of. |
| Path computation (`path.join(archiveDirectory, manifestFilename)`) | **Common.** Pure string math, identical algorithm regardless of archive type. |
| `getEmptyManifest()` | **Policy.** What "nothing" looks like is genuinely different per archive type (`{active:[], obsolete:[]}` for campaigns; a future archive's empty shape could be structurally different). Correctly left abstract. |
| `isValidManifestShape()` | **Policy.** What "valid" means is inherently archive-specific (which fields must exist, what type they are). Correctly left abstract. |

The common/policy line here is clean: the abstract class owns the entire *mechanism* (read, parse, fail-safe), and exposes exactly two narrow, well-named *policy* hooks. This is a textbook Template Method — the shared algorithm's shape never changes, only two small steps in the middle of it do.

### `BaseArchiveManifestProvider<T>` (`archive-manifest-provider.ts`)

| Behavior | Common or policy? |
|---|---|
| Lazy-load-on-first-access (`ensureLoaded()`) | **Common.** Identical caching trigger for any archive type. |
| Memoization of `manifest`/`loadError` | **Common.** |
| `invalidate()` clearing the base cache | **Common** (as a *mechanism* — but see §2: whether a given archive type *needs* invalidation is itself a policy question, addressed by leaving `invalidate()` overridable, not by making it non-generic). |
| Delegating `getArchiveDirectory()`/`getManifestPath()` to the loader | **Common.** Pure pass-through, no archive-specific logic possible here. |
| Derived views (e.g. `getCampaignFiles()`, grouping `active: string[]` by theater) | **Policy.** A future archive type may have no equivalent grouping concept at all, or a completely different one. Correctly left out of the base class entirely — not even as an abstract hook, since not every archive type will need one. |

Notably, `BaseArchiveManifestProvider` is declared as a **concrete class**, not `abstract`. It is fully usable standalone (`new BaseArchiveManifestProvider(loader)`) with zero subclassing required. Campaigns extends it only to *add* one derived-view method and participate in the invalidate lifecycle for that method's cache slot — it does not need to override anything to make the base class function.

### `ArchiveIntegrityValidator<T>` (`archive-integrity-validator.ts`)

This file is interfaces only — no base class, no shared implementation. This is correct, not an omission: there is no genuinely common *validation algorithm* across archive types (per the framework's own founding decision, from the prior "Archive Framework Pass," to keep duplicate-detection rules, replacement-chain verification, and filename conventions entirely inside each archive type's own implementation). The only thing every archive type's integrity report shares is its *shape* (`generatedAt`, `violations`, `passed`), which is exactly what `ArchiveIntegrityReport` captures and nothing more.

## 2. Composition vs. inheritance

**Finding — the Loader's inheritance requirement is real but narrow, and composition is a viable, arguably better alternative.**

`BaseArchiveManifestLoader<T>` requires subclassing specifically to supply two functions: `getEmptyManifest()` and `isValidManifestShape()`. Both are pure, stateless, one-to-three-line functions with no dependency on `this` beyond what a closure could capture. There is no technical reason these need to be class methods resolved via prototype dispatch — they could equally be **constructor-injected functions**:

```ts
// Illustrative only — not implemented, per "do not modify behavior."
class GenericArchiveManifestLoader<T> implements ArchiveManifestLoader<T> {
  constructor(
    archiveDirectory: string,
    manifestFilename: string,
    private readonly getEmptyManifest: () => T,
    private readonly isValidManifestShape: (parsed: unknown) => parsed is T,
  ) {}
  // load() body unchanged, calling this.getEmptyManifest()/this.isValidManifestShape()
}
```

Under this design, a future archive type would never need its own `*ArchiveManifestLoader` subclass file at all — it would construct `new GenericArchiveManifestLoader(dir, filename, emptyFn, shapeCheckFn)` directly wherever it's needed. This removes one class and one file per archive type with no loss of capability, and is a legitimate "prefer composition" opportunity.

**This is a recommendation for the next archive type's implementation, not a retroactive change to campaigns** — campaigns' current `CampaignArchiveManifestLoader` is not wrong, just slightly heavier than necessary. Whether to apply this is a call for whoever builds the second archive type (Armaments), since it's easiest to evaluate with two real data points instead of one.

**Finding — the Provider's inheritance is a reasonable, low-cost choice, not clearly improvable by composition.**

`CampaignArchiveManifestProvider extends BaseArchiveManifestProvider<CampaignArchiveManifest>` adds one new method (`getCampaignFiles()`) and one two-line `invalidate()` override that calls `super.invalidate()` first. Converting this to composition (wrapping a `BaseArchiveManifestProvider` instance as a private field) would require manually forwarding all five interface methods (`getManifest`, `getLoadError`, `getArchiveDirectory`, `getManifestPath`, `invalidate`) — real boilerplate, for no clear benefit, since the "is-a" relationship is semantically accurate here (a `CampaignArchiveManifestProvider` genuinely *is* an `ArchiveManifestProvider<CampaignArchiveManifest>`, just with one extra capability) and the derived-view cache (`campaignFiles`) is naturally cohesive with the caching state it derives from. **No change recommended here.**

## 3. Abstraction smell check

Reviewed every override in the codebase (there are exactly two):

- `CampaignArchiveManifestLoader.getEmptyManifest()` / `.isValidManifestShape()` — these implement *required abstract methods*, not overrides of existing base behavior. There is nothing to compare them against; they are pure policy hooks. **Not a smell.**
- `CampaignArchiveManifestProvider.invalidate()` — two lines: calls `super.invalidate()` unconditionally, then clears one additional field. It extends the base method rather than replacing or duplicating any part of it. **Not a smell.**

No subclass anywhere overrides `load()`, `getArchiveDirectory()`, `getManifestPath()`, `getManifest()`, or `getLoadError()` — the actual shared algorithms in both base classes are untouched by campaigns' implementation. **Verdict: zero abstraction smells found.** If a future archive type's subclass ever needs to override more than a couple of lines of a base method, or override `load()`/`ensureLoaded()` itself, that would be the concrete signal to revisit this — not anything present today.

## 4. Dependency graph

```
Interfaces
  ArchiveManifestLoader<T>
  ArchiveManifestProvider<T>
  ArchiveIntegrityValidator<T>  (+ ArchiveIntegrityReport, ArchiveIntegrityViolation)
        │
        ▼
Implementations (generic, reusable)
  BaseArchiveManifestLoader<T>      — abstract class, Template Method
  BaseArchiveManifestProvider<T>    — concrete class, cache layer
  (no base impl for the validator — pure contract, by design)
        │
        ▼
Campaign Archive (first concrete archive type)
  CampaignArchiveManifestLoader      extends BaseArchiveManifestLoader<CampaignArchiveManifest>
  CampaignArchiveManifestProvider    extends BaseArchiveManifestProvider<CampaignArchiveManifest>
  CampaignArchiveIntegrityValidator  implements ArchiveIntegrityValidator<CampaignArchiveIntegrityReport>
                                       → wraps validateCampaignArchiveIntegrity(),
                                         which owns every campaign-specific rule
                                         (duplicate id/recordId/slug detection,
                                         obsolete/replacement verification,
                                         filename-convention checks)
```

## 5. Extension points for a future archive type (e.g. Armaments)

**Must implement, per archive type:**
1. A manifest type (`ArmamentArchiveManifest` + any nested types) — whatever shape that archive's manifest actually needs.
2. `ArmamentArchiveManifestLoader extends BaseArchiveManifestLoader<ArmamentArchiveManifest>` (or, per §2's finding, a plain instance of a future `GenericArchiveManifestLoader` constructed with the right functions) — supplying `getEmptyManifest()` and `isValidManifestShape()` only.
3. `ArmamentArchiveManifestProvider extends BaseArchiveManifestProvider<ArmamentArchiveManifest>` — supplying whatever derived-view getters that archive type actually needs (may be zero).
4. `ArmamentArchiveIntegrityReport extends ArchiveIntegrityReport`, `IntegrityViolation` shape, and a `validateArmamentArchiveIntegrity()` function containing **all** of that archive's actual rules — nothing here is inherited from campaigns, by design, since campaigns' rules (obsolete/replacedBy chains, filename-vs-id conventions) are specific to how campaigns' archive drifted, not universal truths about archives in general. Armaments' real historical problem (the stale `DUPLICATE_RESOLUTIONS` table found several passes ago) is a structurally different kind of check and would need its own logic regardless.
5. A thin `ArmamentArchiveIntegrityValidator implements ArchiveIntegrityValidator<ArmamentArchiveIntegrityReport>` wrapping that function — same pattern as `CampaignArchiveIntegrityValidator`.

**Can be reused as-is, zero new code:**
- `BaseArchiveManifestLoader`'s entire `load()` method — read, parse, three-way fail-safe error handling.
- `BaseArchiveManifestProvider`'s entire caching mechanism — lazy load, memoize, base `invalidate()`.
- The `ArchiveManifestLoadResult<T>`, `ArchiveManifestLoader<T>`, `ArchiveManifestProvider<T>`, `ArchiveIntegrityReport`, `ArchiveIntegrityViolation`, `ArchiveIntegrityValidator<T>` type contracts.

None of this requires touching any existing campaign file — every extension point above is additive (new files, new classes implementing/extending existing generic ones).

## Verification (no behavior changed)

- `npx tsc --noEmit` — clean, no changes made to any file's logic.
- Confirmed via `git status` and direct re-reading that no source file was edited during this review; only this document was added.
- Re-confirmed (by inspection, consistent with the live tests run in the prior two passes) that the override footprint in both subclasses is exactly what's documented above — two hook implementations in the loader, one two-line extending override in the provider.

## Final confirmation

**The framework is stable enough that adding Armaments, Articles, Letters, Personnel, or Formations will not require modifying `archive-manifest-loader.ts`, `archive-manifest-provider.ts`, or `archive-integrity-validator.ts`.** Every extension point identified above is additive. The one open recommendation (§2, converting the Loader from abstract-subclass to constructor-injected composition) is an optional simplification for the *next* archive type's implementation, not a defect blocking expansion — the current inheritance-based Loader works correctly and would not need to change even if that recommendation is never acted on.
