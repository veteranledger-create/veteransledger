import { ValidationIssue } from "../publish.types";

// Validates NSDAP JSON files for structural integrity before staging.
// `files` is a Map<relPath, rawJsonString> from the public/data/nsdap/ directory.
export function checkNsdapFiles(files: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pushError = (file: string, field: string, message: string) =>
    issues.push({ recordId: file, field, message, severity: "error" });
  const pushWarning = (file: string, field: string, message: string) =>
    issues.push({ recordId: file, field, message, severity: "warning" });

  for (const [relPath, raw] of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      pushError(relPath, "json", `${relPath}: invalid JSON — cannot parse.`);
      continue;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      // timeline.json and glossary.json are objects with arrays inside — top-level must be object
      pushError(relPath, "structure", `${relPath}: top-level value must be a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}.`);
      continue;
    }

    const obj = parsed as Record<string, unknown>;

    // overview.json
    if (relPath === "overview.json") {
      if (!obj.name) pushError(relPath, "name", "overview.json: missing required field 'name'.");
      if (!obj.founded) pushWarning(relPath, "founded", "overview.json: missing 'founded' date.");
      if (!obj.leader) pushWarning(relPath, "leader", "overview.json: missing 'leader' field.");
    }

    // timeline.json
    if (relPath === "timeline.json") {
      if (!Array.isArray(obj.events)) {
        pushError(relPath, "events", "timeline.json: missing or non-array 'events' field.");
      } else {
        obj.events.forEach((ev: unknown, i: number) => {
          if (!ev || typeof ev !== "object" || Array.isArray(ev)) return;
          const e = ev as Record<string, unknown>;
          if (!e.title) pushWarning(relPath, `events[${i}].title`, `timeline.json events[${i}]: missing 'title'.`);
          if (!e.year && !e.date) pushWarning(relPath, `events[${i}].year`, `timeline.json events[${i}]: missing 'year' or 'date'.`);
        });
      }
    }

    // glossary.json
    if (relPath === "glossary.json") {
      if (!Array.isArray(obj.entries)) {
        pushError(relPath, "entries", "glossary.json: missing or non-array 'entries' field.");
      } else {
        obj.entries.forEach((entry: unknown, i: number) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
          const e = entry as Record<string, unknown>;
          if (!e.term) pushWarning(relPath, `entries[${i}].term`, `glossary.json entries[${i}]: missing 'term'.`);
        });
      }
    }

    // index.json
    if (relPath === "index.json") {
      if (!Array.isArray(obj.sections)) {
        pushError(relPath, "sections", "index.json: missing or non-array 'sections' field.");
      }
    }

    // party/leadership.json
    if (relPath === "party/leadership.json") {
      if (!Array.isArray(obj.leaders) && !Array.isArray(obj.members) && !Array.isArray(obj.inner_circle)) {
        pushWarning(relPath, "leaders", "party/leadership.json: expected at least one of 'leaders', 'members', or 'inner_circle' arrays.");
      }
    }
  }

  return issues;
}
