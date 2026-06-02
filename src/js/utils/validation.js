/**
 * VALIDATION UTILITY MODULE
 * Schema validation and data integrity checks.
 */

/**
 * Check that all required fields exist in an entry.
 * @param {Object} entry - Data entry
 * @param {string[]} fields - Required field names
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function checkRequiredFields(entry, fields) {
  const missing = fields.filter(
    (f) => entry[f] === undefined || entry[f] === null || entry[f] === ""
  );
  return { valid: missing.length === 0, missing };
}

/**
 * Validate all entries in a dataset against a schema.
 * @param {Array} data - Array of entries
 * @param {Object} schema - Schema definition
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDataset(data, schema) {
  const errors = [];

  if (!Array.isArray(data)) {
    return { valid: false, errors: ["Data is not an array"] };
  }

  data.forEach((entry, index) => {
    const id = entry.id || `[${index}]`;

    // Check required fields
    if (schema.required) {
      const { missing } = checkRequiredFields(entry, schema.required);
      missing.forEach((field) => {
        errors.push(`"${id}": missing required field "${field}"`);
      });
    }

    // Check field types
    if (schema.types) {
      for (const [field, type] of Object.entries(schema.types)) {
        if (entry[field] !== undefined && entry[field] !== null) {
          const actual = typeof entry[field];
          if (actual !== type) {
            errors.push(
              `"${id}": field "${field}" should be ${type}, got ${actual}`
            );
          }
        }
      }
    }

    // Check nested schemas
    if (schema.nested) {
      for (const [parentField, nestedSchema] of Object.entries(schema.nested)) {
        const parent = entry[parentField];
        if (parent && typeof parent === "object") {
          for (const [field, type] of Object.entries(nestedSchema)) {
            if (parent[field] !== undefined && parent[field] !== null) {
              const actual = typeof parent[field];
              if (actual !== type) {
                errors.push(
                  `"${id}": ${parentField}.${field} should be ${type}, got ${actual}`
                );
              }
            }
          }
        }
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Check for duplicate IDs in a dataset.
 * @param {Array} data - Array of entries with 'id' field
 * @param {string} [idField='id']
 * @returns {{ duplicates: string[], unique: boolean }}
 */
export function checkDuplicateIds(data, idField = "id") {
  const seen = new Map();
  const duplicates = [];

  data.forEach((entry) => {
    const id = entry[idField];
    if (id !== undefined) {
      if (seen.has(id)) {
        duplicates.push(id);
      }
      seen.set(id, true);
    }
  });

  return { duplicates: [...new Set(duplicates)], unique: duplicates.length === 0 };
}

/**
 * Create a validation report string.
 * @param {string} datasetName
 * @param {{ valid: boolean, errors: string[] }} result
 * @returns {string}
 */
export function formatValidationReport(datasetName, result) {
  const lines = [
    `── ${datasetName} ──`,
    `Status: ${result.valid ? "✓ VALID" : "✗ INVALID"}`,
  ];
  if (result.errors.length > 0) {
    lines.push(`Errors (${result.errors.length}):`);
    result.errors.forEach((e) => lines.push(`  • ${e}`));
  }
  return lines.join("\n");
}

/**
 * Known schemas for each dataset.
 * Used by the validation script.
 */
export const SCHEMAS = {
  veterans: {
    required: [
      "id", "name", "rank", "branch", "life", "nickname",
      "commands", "birth", "death", "image", "imageCredit",
    ],
    types: {
      id: "string",
      name: "string",
      rank: "string",
      branch: "string",
      life: "string",
      nickname: "string",
      image: "string",
    },
    nested: {
      fullBio: {
        earlyLife: "string",
        militaryCareer: "string",
        achievements: "string",
        laterLife: "string",
      },
    },
  },
  battles: {
    required: ["id", "title", "year", "description"],
    types: {
      id: "number",
      title: "string",
      year: "string",
    },
  },
};
