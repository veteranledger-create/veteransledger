# Community System — Architecture (Foundation Phase)

Status: **architecture only**. No comments, reactions, posts, or moderation
logic are implemented. Every reserved API route responds `501 Not
Implemented`. This document describes the foundation now in place and the
contract future implementation phases will build against.

## 1. Module relationships

The Community system is a new, self-contained module tree at
`src/modules/community/` with no imports from — and no imports by — any
archive module (`armaments`, `personnel`, `letters`, `campaigns`, `articles`,
`timeline`, `formations`, etc.). The only coupling points are intentional and
one-directional:

- **`src/app.ts`** mounts `communityRoutes` at `/api/community`, exactly like
  every other module. This is the single line of "unrelated" code touched.
- **`prisma/schema.prisma`** — Community models reference the existing `User`
  model (for admin report-review and moderation-action attribution only) and
  reference archive records **generically** via `entityType`/`entityId`
  string columns, never via a foreign key to `Record`, `Entity`, or
  `TimelineEvent`. This is the same convention already used by `Translation`
  and `PreservationRecord` — it's why zero schema changes were needed on any
  archive model.

```
src/modules/community/
  community.types.ts       shared string-literal-union types (reasons, reaction
                            types, moderation actions, notification types, ...)
  not-implemented.ts        shared 501 handler every reserved route uses
  community.routes.ts       aggregator, mounted at /api/community
  posts.routes.ts            /api/community/posts
  comments.routes.ts          /api/community/comments
  reactions.routes.ts          /api/community/reactions
  reports.routes.ts             /api/community/reports
  notifications.routes.ts        /api/community/notifications
  moderation.routes.ts             /api/community/moderation
  profiles.routes.ts                 /api/community/profiles
```

Each resource is its own router file (mirroring how `translations.routes.ts`
separates concerns) so a future implementation phase can fill in one
resource's controller/service without touching the others.

### Identity: two separate "users"

- **`User`** (existing) — CMS/staff auth. Roles `VIEWER` / `ADMIN` /
  `SUPER_ADMIN`. Used for Admin login, audit logs, media uploads, and (new)
  report review + moderation actions.
- **`CommunityMember`** (new) — the future public commenter/poster identity.
  Deliberately has **no** auth wiring yet. Public community authentication
  (sign-up, login, session/JWT) is out of scope for this phase and is called
  out below as the largest piece of remaining work.

Keeping these separate means the eventual community-auth system can be built
independently of the CMS's admin auth, and a `CommunityMember` being
suspended/banned never touches `User`/staff accounts.

## 2. Database responsibilities

Seven new tables, all additive (migration
`prisma/migrations/20260716000000_community_foundation`) — no existing table
was altered:

| Model | Purpose | Key design point |
|---|---|---|
| `CommunityMember` | future public identity | separate from `User`; `status` (ACTIVE/SUSPENDED/BANNED), `reputation` reserved |
| `CommunityPost` | top-level posts | `entityType`/`entityId` nullable — attaches to an archive record *or* stands alone as general discussion |
| `CommunityComment` | comments **and** replies | self-referencing `parentId`; one model, not two, avoids duplicating comment logic for replies |
| `CommunityReaction` | Helpful / Informative / Well Researched / Needs Verification | polymorphic `targetType`+`targetId` (POST or COMMENT); unique constraint prevents duplicate identical reactions from one member |
| `CommunityReport` | abuse reports | `reason` is a closed set of conduct-based categories (see §3); `reviewedBy` links to admin `User` |
| `CommunityModerationAction` | audit trail of moderator actions | append-only log, `moderatorId` links to admin `User` |
| `CommunityNotification` | reserved delivery records | belongs to `CommunityMember`; `payload Json?` keeps the shape flexible per `type` |

All `status`/`type`/`reason`/`action` columns are `String` with the allowed
values documented inline as comments (matching existing columns like
`Translation.status`), not Prisma `enum` blocks — consistent with the rest of
the schema.

**Record integration is schema-free.** Because `CommunityPost.entityType` /
`entityId` reuses the generic linking pattern already established by
`Translation` and `PreservationRecord`, *every* archive record type
(`record`, `entity`, `timeline_event`) can have attached discussion the
moment posts are implemented — no migration, no per-module change, and
no change to any of the 9 existing `record.html` templates was made or is
required at the data layer.

## 3. Comment philosophy → data model

Per the brief: the system restricts *conduct*, not *opinion*. This is
reflected directly in `REPORT_REASONS`
(`src/modules/community/community.types.ts`): every value names an abuse
pattern (`SPAM`, `FLOODING`, `BOT`, `PROMOTIONAL`, `ADVERTISING`,
`MALICIOUS_LINK`, `FALSE_ACCUSATION`, `HARASSMENT`, `IMPERSONATION`), not a
viewpoint or disagreement category. There is intentionally no "I disagree
with this" or "misinformation" report reason — historical debate is not a
moderation target. `FALSE_ACCUSATION` covers accusations against *people*
presented as fact without evidence, not historical interpretation.

`CommunityModerationAction` is a separate append-only audit table from
`CommunityReport` so that "someone reported this" and "a moderator acted on
it" stay distinct and both remain visible in an eventual moderation UI.

## 4. Future API structure

All routes are mounted and reserved today; each responds `501` via the
shared `reserved()` handler (`not-implemented.ts`) until implemented.

```
GET    /api/community/posts
GET    /api/community/posts/by-record/:entityType/:entityId
GET    /api/community/posts/:id
POST   /api/community/posts
PATCH  /api/community/posts/:id
DELETE /api/community/posts/:id

GET    /api/community/comments            ?postId=
GET    /api/community/comments/:id
POST   /api/community/comments             (body.parentId set => reply)
PATCH  /api/community/comments/:id
DELETE /api/community/comments/:id

GET    /api/community/reactions           ?targetType=&targetId=
POST   /api/community/reactions
DELETE /api/community/reactions/:id

POST   /api/community/reports                          (public)
GET    /api/community/reports             (admin — authenticate + requireAdmin)
PATCH  /api/community/reports/:id          (admin — authenticate + requireAdmin)

GET    /api/community/notifications/:memberId
PATCH  /api/community/notifications/:id/read

GET    /api/community/moderation/actions   (admin — authenticate + requireAdmin)
POST   /api/community/moderation/actions   (admin — authenticate + requireAdmin)

GET    /api/community/profiles/:id
PATCH  /api/community/profiles/:id
```

Auth is applied per-route today based on who will actually call it later:
existing admin JWT auth (`authenticate` + `requireAdmin`) guards only the
report-review and moderation endpoints, matching how every other
admin-only endpoint in this app is protected. Member-facing routes
(posts/comments/reactions/notifications/profiles) have no auth yet because
community-member authentication doesn't exist — that is future work, not an
oversight.

## 5. Frontend responsibilities (not built yet)

No frontend files were added or changed in this phase — "do not redesign
existing pages" was taken literally, so none of the 9 archive
`record.html` templates were touched. When Posts/Comments ship, the
expected integration is:

- A new, self-contained frontend component (e.g.
  `frontend/components/CommunityThread/`) that record pages opt into by
  fetching `/api/community/posts/by-record/:entityType/:entityId`, using the
  same `entityType` values already used by the Translation/related-media
  systems on those pages (`record`, `entity`, `timeline_event`).
  Consistency-wise, this should follow the design-system work already done
  in the Admin CSS consolidation (shared card/button/badge tokens from
  `frontend/styles/core.css`) rather than introducing new visual language.
- Each `record.html` gains one hidden mount element
  (e.g. `<div id="community-thread" data-entity-type="…" data-entity-id="…" hidden></div>`)
  when that phase begins — deliberately not added now, since an empty hook
  with no visible effect would still count as touching 9 "existing pages"
  for no present benefit.
- A future Admin → **Community** section (Posts, Comments, Reports,
  Moderation, Reactions, Notifications) as new tabs alongside the existing
  19 — not built this phase; see §6.

## 6. Admin architecture (reserved, not built)

Future Admin tabs, matching the CRUD-tab pattern already used for every
archive type:

| Tab | Talks to | Primary job |
|---|---|---|
| Community → Posts | `/api/community/posts` | browse/hide/delete posts |
| Community → Comments | `/api/community/comments` | browse/hide/delete comments & replies |
| Community → Reports | `/api/community/reports` | review queue, resolve/dismiss |
| Community → Moderation | `/api/community/moderation/actions` | audit log of actions taken |
| Community → Reactions | `/api/community/reactions` | (likely read-only) reaction volume/abuse signal |
| Community → Notifications | `/api/community/notifications` | (likely admin-facing delivery diagnostics, not per-member inbox) |

No Admin HTML/JS was written this phase — `frontend/pages/Admin/index.html`
and `admin.js` are untouched.

## 7. Scalability considerations

- **Comments at depth**: `CommunityComment.parentId` self-relation supports
  arbitrary reply nesting without a schema change; a future implementation
  can choose to flatten display to 1–2 visual levels without changing the
  data model.
- **Reactions won't bloat post/comment rows**: reactions are a separate
  table with `@@unique([memberId, targetType, targetId, type])`, not a
  counter column, so concurrent reactions don't need row-locking on the
  post/comment itself; aggregate counts are a `GROUP BY` away.
- **Discussion volume per record is unbounded but isolated**: because posts
  attach via `entityType`/`entityId` (indexed) rather than a hard FK, high
  discussion volume on one record can't force a migration or index change
  on `Record`/`Entity`/`TimelineEvent`.
- **Moderation audit trail is append-only** (`CommunityModerationAction`),
  so it can be retained/archived independently of the mutable
  `CommunityReport` queue.
- **Notifications are per-recipient rows** with an indexed
  `(memberId, read)`, which is the standard shape for an unread-count query
  and for later fan-out to a queue/worker without redesigning the table.

## Remaining work (explicitly out of scope this phase)

- Community-member authentication (sign-up/login/session) — the single
  largest missing piece; every member-facing route depends on it.
- All actual business logic: creating/editing/deleting posts and comments,
  computing reaction counts, generating notifications, running report
  triage, enforcing the moderation actions.
- Rate limiting / spam & bot detection for posts and comments (the abuse
  vectors named in the brief — spam, flooding, bots, promotional content).
- The frontend `CommunityThread` component and the 9 record-page mount
  points described in §5.
- The Admin → Community tabs described in §6.
- Rich profile fields beyond the reserved `displayName`/`avatarUrl`/`bio`.
