/**
 * convert-data-files.mjs
 *
 * SAFE CONVERSION: Converts legacy .js data files (JS object/array literals)
 * to strict valid JSON. Original .js files remain untouched.
 *
 * Pattern 1 (array): const XxxData = [{ ... }];
 * Pattern 2 (object): const modalData = { ... };
 *
 * Usage: node scripts/convert-data-files.mjs
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const CONFIG = [
  {
    src: "data/battles.js",
    dest: "public/data/battles.json",
    varName: "battlesData",
    type: "array",
    label: "Battles",
    fields: [
      "id",
      "title",
      "year",
      "description",
      "longContent",
      "image",
      "credit",
    ],
  },
  {
    src: "data/veterans.js",
    dest: "public/data/veterans.json",
    varName: "veteranProfiles",
    type: "array",
    label: "Veterans",
    fields: [
      "id",
      "name",
      "rank",
      "branch",
      "life",
      "nickname",
      "commands",
      "birth",
      "death",
      "image",
      "imageCredit",
    ],
  },
  {
    src: "data/technology.js",
    dest: "public/data/technology.json",
    varName: "technologyData",
    type: "array",
    label: "Technology",
    fields: [
      "id",
      "name",
      "category",
      "date",
      "shortDesc",
      "fullDesc",
      "image",
      "imageCredit",
    ],
  },
  {
    src: "data/articles.js",
    dest: "public/data/topics.json",
    varName: "topicsData",
    type: "array",
    label: "Topics",
    fields: ["id", "title", "tags", "description", "fullArticle"],
  },
  {
    src: "data/technology.js",
    dest: "public/data/weapons.json",
    varName: "technologyData",
    type: "array",
    label: "Weapons (legacy)",
    fields: [
      "id",
      "name",
      "category",
      "date",
      "shortDesc",
      "fullDesc",
      "image",
      "imageCredit",
    ],
  },
  {
    src: "data/letters.js",
    dest: "public/data/letters.json",
    varName: "lettersData",
    type: "array",
    label: "Letters",
    fields: [
      "id",
      "author",
      "year",
      "description",
      "longContent",
      "image",
      "credit",
    ],
  },
  {
    src: "data/modal.js",
    dest: "public/data/modal.json",
    varName: "modalData",
    type: "object",
    label: "Modal",
    fields: [],
  },
];

function validateEntry(entry, fields, index, label) {
  const errors = [];

  if (entry.id !== undefined && typeof entry.id !== "number") {
    errors.push(
      `Entry ${index}: 'id' is not a number (got ${typeof entry.id})`,
    );
  }

  for (const field of fields) {
    if (entry[field] === undefined || entry[field] === null) {
      errors.push(
        `Entry ${index} (id=${entry.id || "N/A"}): missing field '${field}'`,
      );
    }
  }

  for (const field of ["description", "longContent", "content"]) {
    if (entry[field] !== undefined && typeof entry[field] !== "string") {
      errors.push(
        `Entry ${index} (id=${entry.id || "N/A"}): field '${field}' is not a string`,
      );
    }
  }

  return errors;
}

function convertFile(config) {
  const srcPath = path.resolve(ROOT, config.src);
  const destPath = path.resolve(ROOT, config.dest);

  if (!fs.existsSync(srcPath)) {
    return { success: false, error: `Source file not found: ${config.src}` };
  }

  try {
    const raw = fs.readFileSync(srcPath, "utf-8");

    // Strip leading comment line
    let cleanSource = raw;
    const commentMatch = cleanSource.match(/^\/\/.*\n/);
    if (commentMatch) {
      cleanSource = cleanSource.slice(commentMatch[0].length);
    }

    // Remove browser-only global assignments (e.g., window.*) for Node eval
    cleanSource = cleanSource.replace(/\bwindow\.[\w$]+\s*=.*?;?\s*$/gm, "");

    // Evaluate using new Function
    const fn = new Function(cleanSource + `; return ${config.varName};`);
    const data = fn();

    const validationErrors = [];
    let entryCount = 0;

    if (config.type === "array") {
      if (!Array.isArray(data)) {
        return {
          success: false,
          error: `Expected array but got ${typeof data}`,
        };
      }
      entryCount = data.length;

      const ids = data.map((e) => e.id).filter((id) => id !== undefined);
      const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (duplicateIds.length > 0) {
        validationErrors.push(
          `Duplicate IDs: [${[...new Set(duplicateIds)].join(", ")}]`,
        );
      }

      data.forEach((entry, i) => {
        const errs = validateEntry(entry, config.fields, i, config.label);
        validationErrors.push(...errs);
      });
    } else {
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        return {
          success: false,
          error: `Expected object but got ${typeof data}`,
        };
      }
      entryCount = Object.keys(data).length;

      for (const [key, val] of Object.entries(data)) {
        if (!val.title) validationErrors.push(`Key '${key}': missing 'title'`);
        if (!val.content)
          validationErrors.push(`Key '${key}': missing 'content'`);
        if (!val.link) validationErrors.push(`Key '${key}': missing 'link'`);
      }
    }

    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(destPath, json, "utf-8");

    const fileSize = (Buffer.byteLength(json) / 1024).toFixed(1);

    return {
      success: true,
      entryCount,
      fileSize: `${fileSize}KB`,
      validationErrors,
      dest: config.dest,
    };
  } catch (err) {
    return { success: false, error: `Conversion failed: ${err.message}` };
  }
}

// ---- Main Execution ----
console.log("╔══════════════════════════════════════════════════╗");
console.log("║   Legacy .js → JSON Data Converter              ║");
console.log("╠══════════════════════════════════════════════════╣");
console.log("║   Original .js files: UNTOUCHED                 ║");
console.log("║   Output: public/data/*.json                    ║");
console.log("╚══════════════════════════════════════════════════╝\n");

let totalSuccess = 0;
let totalErrors = 0;

for (const config of CONFIG) {
  console.log(`── ${config.label} ──`);
  console.log(`   Source: ${config.src}`);

  const result = convertFile(config);

  if (result.success) {
    console.log(
      `   ✓ ${result.dest} (${result.fileSize}, ${result.entryCount} entries)`,
    );
    totalSuccess++;

    if (result.validationErrors.length > 0) {
      console.log(`   ⚠  Warnings:`);
      result.validationErrors.forEach((err) => console.log(`      - ${err}`));
    } else {
      console.log(`   ✓ Validation passed`);
    }
  } else {
    console.log(`   ✗ ${result.error}`);
    totalErrors++;
  }
  console.log("");
}

console.log("═══════════════════════════════════════════════════");
console.log(`   Total: ${totalSuccess + totalErrors} files`);
console.log(`   Successful: ${totalSuccess}`);
console.log(`   Failed: ${totalErrors}`);
console.log("═══════════════════════════════════════════════════");
