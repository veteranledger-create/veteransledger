# World War Axis Archives (VeteransLedger)

A focused, manifest-driven historical archive and web platform for documenting material related to the Axis powers and the Second World War. This repository contains the server code, frontend assets, archive validation and import tooling, and supporting documentation used to prepare, preview, and (when explicitly enabled) import archival records into a database-backed publication site.

What this repository does
- Provides a manifest-based framework to describe archive collections on disk and to read/preview their contents safely (loaders + providers).
- Implements archive loaders, validators, and transactional importers that produce preview reports and, when explicitly enabled, write to the database in a controlled way.
- Hosts a Node/Express server that serves a static frontend and provides API endpoints for archive and site management; it includes a version-aware resolver for published archive content under public/data.
- Includes architecture documentation describing the archive framework and recovery approach (see docs/).

Core archival areas (what the project collects)
- Military history and campaigns
- Armaments and military equipment
- Personnel / biographical records
- Political documents and events
- Articles and curated archival collections
- Maps, media, and related supporting resources

Implemented vs. planned (verified from source)
- Implemented (visible in source)
  - Manifest framework: BaseArchiveManifestLoader + BaseArchiveManifestProvider (generic read/parse/caching behavior).
  - Concrete manifest loaders/providers: Campaigns, Armaments, Articles (src/modules/publish/import-validation/*-archive-manifest-*.ts).
  - Archive record loaders and transactional importers: Campaigns, Armaments, Articles, Letters, Personnel, Formations, Timeline (importer modules and scripts exist under src/modules/publish/import-validation and scripts/).
  - Archive integrity checks: a concrete integrity validator is present for Campaigns (duplicate detection, manifest self-consistency, file-read vs. parse distinctions); armaments import flow also runs integrity checks.
  - Recovery tooling: a restore-from-archive script that previews and (if explicitly executed and importer gates are enabled) runs imports from published archive snapshots under public/data.
  - Execution safety: import execution is gated by per-importer EXECUTION_ENABLED flags and explicit confirmExecution options; preview/dry-run output is produced without database writes.
  - Static frontend and server boot: src/index.ts and src/app.ts implement server startup, static file mounts, maintenance mode, and an admin route.

- Planned or partially implemented (seen in code or docs but not fully automatic)
  - Some import wiring and additional import/preview plumbing have comments indicating future wiring phases (the codebase documents which loaders are fully wired and which are pending).
  - The Community subsystem is present as a reserved foundation with routes that currently respond 501 (placeholder).
  - Not all archive types necessarily have a concrete manifest loader/provider pair yet (Campaigns / Armaments / Articles are present; other types are supported by importers and the framework but may be in different integration stages).

How the archive tooling behaves (concise)
- Manifests: concrete archives place a manifest JSON file (e.g. campaigns.archive.json) in a known input directory; BaseArchiveManifestLoader reads and parses this file, returns a safe empty manifest plus an optional loadError rather than throwing.
- Providers: BaseArchiveManifestProvider adds lazy-load caching and invalidate() semantics; concrete providers expose domain-specific derived views (e.g. campaign files grouped by theater).
- Loaders vs. validators: record-loading code reads each declared file once per operation and returns a disposable snapshot used for previews and integrity checks. Validators detect manifest inconsistencies, duplicate declarations, unreadable vs malformed files, and other domain rules (Campaigns integrity validator is implemented).
- Import safety: importers run a sequence of gates—archive integrity, conformance dry-run, pre-import snapshot and preview—then run transactional upserts. No write occurs unless execution is explicitly enabled (per-importer flags) and the caller confirms execution.
- Publication and recovery: the server supports a version-aware resolver for public/data; the recovery script aggregates previews and can execute imports from published archive snapshots with the same safety gates described above.

Quick start (local development)
- Prerequisites: Node.js, npm, a database supported by Prisma, optional Redis for sessions.
- Install:
  npm install
- Development (hot-reload):
  npm run dev
- Build:
  npm run build
- Run compiled app:
  npm start
- Tests:
  npm test
- Prisma helpers:
  npm run prisma:generate
  npm run prisma:migrate
  npm run prisma:seed
  npm run prisma:studio
- Configuration: see .env.example at repository root for environment variables and path configuration. The server will create required log/storage directories on startup if they are missing.

Contributing
Contributions that respect historical accuracy and source provenance are welcome. Useful contributions include:
- Historical research, primary/secondary source citations, and verification.
- Manifest and metadata improvements, record cleanup, and duplicate resolution rules.
- Validation and integrity tests (improving validators that detect missing/duplicate/malformed records).
- Backend bug fixes, importer improvements, and safer import flows.
- Frontend UI/UX and accessibility improvements for public and admin pages.
- Documentation, tests, and issue triage.

Please follow repository conventions (TypeScript code style, tests where applicable). For substantial changes, open an issue first describing the planned work and primary sources used.

Neutrality and content policy
This project exists for historical research, documentation, archival preservation, and education. Presenting historical material does not imply endorsement of the individuals, regimes, or ideologies documented here. Contributors should separate factual documentation from commentary and always cite reliable sources when possible.

Repository notes and governance
- Documentation: a docs/ directory exists and includes architecture/review documents (for example docs/campaigns-archive-framework-stability-review.md).
- Configuration: .env.example is present; check it for environment variable names and path settings.
- License and contribution files: I did not find a LICENSE file or CONTRIBUTING.md in the repository root during review. Adding a LICENSE (and a CONTRIBUTING.md and ISSUE_TEMPLATE) is recommended to clarify reuse and contribution expectations.

Where to look in the code
- Server startup and route mounting: src/index.ts, src/app.ts
- Archive framework and validators: src/modules/publish/import-validation/
  - archive-manifest-loader.ts, archive-manifest-provider.ts
  - campaigns-archive-*, armaments-*, articles-*, and various importers
- Recovery script: src/scripts/recovery/restore-from-archive.ts
- Frontend static content: frontend/
- Documentation: docs/

If you want, I can produce a commit-ready patch for this README.md, or prepare a suggested CONTRIBUTING.md or LICENSE text for review.
