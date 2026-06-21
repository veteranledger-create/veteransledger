// Shared by every content-type mapper (letters, articles, and whatever
// comes next) so a trivial helper like this doesn't get copy-pasted once
// per type the way the rollback utility almost was.
export function pick(...values: Array<string | undefined>): string | undefined {
  return values.find((v) => typeof v === "string" && v.trim().length > 0);
}
