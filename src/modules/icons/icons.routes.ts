import { Router, Request, Response, NextFunction } from "express";
import fs from "fs/promises";
import path from "path";
import { config } from "../../config/app";

/**
 * GET /api/icons — manifest of the official project icon library.
 *
 * Scans public/images/icons/ (already publicly served as static assets) and
 * returns every SVG as { id, category }, where id is the path relative to the
 * icons root without extension (e.g. "navigation/close"). The Admin icon
 * picker uses this as its single source of truth so the selectable set can
 * never drift from what actually exists on disk — no hardcoded manifest.
 */
export const iconsRoutes = Router();

let cache: { icons: Array<{ id: string; category: string }> } | null = null;

async function scan(dir: string, base: string): Promise<Array<{ id: string; category: string }>> {
  const out: Array<{ id: string; category: string }> = [];
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await scan(full, base)));
    } else if (entry.isFile() && entry.name.endsWith(".svg")) {
      const rel = path.relative(base, full).replace(/\\/g, "/");
      const id = rel.slice(0, -".svg".length);
      const category = path.dirname(rel).replace(/\\/g, "/");
      out.push({ id, category: category === "." ? "misc" : category });
    }
  }
  return out;
}

iconsRoutes.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!cache) {
      const iconsDir = path.join(config.paths.public, "images", "icons");
      const icons = await scan(iconsDir, iconsDir);
      icons.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
      cache = { icons };
    }
    res.json(cache);
  } catch (err) {
    next(err);
  }
});
