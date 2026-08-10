# Phase 1 — Pre-fix baseline evidence

Captured 2026-08-10, before any Phase 1 code changes. DB counts baseline: `baseline-phase0.json` in this directory.

## BE-01 — unpublished record's translation is publicly fetchable

Test fixture: Armament `cmsnozaw50001trie0ih8ili1` ("ZZ-TEST-PHASE1-DELETE-ME"), created via the real Admin API with `published: false`. Wrote a `status: "human"` German translation for it.

```
GET /api/translations/record/cmsnozaw50001trie0ih8ili1/de   (no Authorization header)
→ HTTP 200
→ {"id":"cmsnozl890002triets0v5ve1","entityType":"record","entityId":"cmsnozaw50001trie0ih8ili1",
   "locale":"de","status":"human","fields":{"title":"ZZ-TEST-PHASE1-LOESCHEN",...}, ...}
```

**Confirmed: fully public, no auth required, unpublished record.**

## BE-02 — `/api/search` is fully public with no auth check

```
GET /api/search?q=Jagdpanther   (no Authorization header)
→ HTTP 200 — full record data returned
```

## BE-03 — personnel search pagination broken

```
GET /api/search?q=a&type=PERSON&page=1&limit=5 → entities: ["Heinz Guderian", ...], total: 0
GET /api/search?q=a&type=PERSON&page=2&limit=5 → entities: ["Heinz Guderian", ...] (IDENTICAL — page ignored)
```

**Confirmed: `total` under-reports as 0 despite real results; page 2 returns page 1's results.**

## BE-04 — raw 500 (with leaked internal stack trace) on missing-row update/delete

Test fixture: Letter `cmsnp0ilf0007triex1ggd7w5`, created then deleted once (204, correct).

```
DELETE /api/letters/cmsnp0ilf0007triex1ggd7w5   (second delete, already gone)
→ HTTP 500
→ {"error":"Internal server error","details":"...prisma.record.delete()...",
   "stack":"PrismaClientKnownRequestError: ...at LettersService.delete (C:\\Users\\...\\letters.service.ts:39:5)..."}

PUT /api/letters/cmsnp0ilf0007triex1ggd7w5   (update, already gone)
→ HTTP 500 — same pattern, full server file path + stack trace in the response body.
```

**Confirmed: not just the wrong status code — the raw error response leaks internal file paths and stack traces to the client. The BE-04 fix (catching P2025 → AppError(404)) resolves both.**

## BE-05 / BE-09

No "before" reproduction needed beyond the code-level mass-assignment/unescaped-src risk already cited with file:line in the audit — both are latent (not currently exploited by the shipped frontend) rather than reproducible bugs. Verified via code read, not a live repro.

## Cleanup

Both test fixtures (`cmsnozaw50001trie0ih8ili1` Armament + its translation, and the already-self-deleted Letter) are removed as part of Phase 1 regression testing, after the fixes are verified against them.
