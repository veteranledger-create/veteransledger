import { body, query } from "express-validator";

const ARMAMENT_CATEGORIES = ["panzer", "aircraft", "naval", "missiles", "wunderwaffen", "equipment"] as const;

// No nation enum — confirmed real archive data includes compound values
// ("Hungary / Romania / Bulgaria") that a strict isIn([...]) check would
// always reject. Accept any non-empty string; "other-axis" folder-derived
// fallbacks and free-text real nations both pass through unchanged.
const nationField = (optional: boolean) => {
  const validator = body("nation");
  return (optional ? validator.optional() : validator)
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Nation must be a non-empty string under 200 characters.");
};

export const createArmamentValidator = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title is required and must be under 500 characters."),
  body("summary")
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Summary must be under 2,000 characters."),
  body("category")
    .isIn(ARMAMENT_CATEGORIES)
    .withMessage(`Category must be one of: ${ARMAMENT_CATEGORIES.join(", ")}.`),
  nationField(false),
  body("specs")
    .optional()
    .isObject()
    .withMessage("Specs must be an object."),
  body("sources")
    .optional()
    .isArray()
    .withMessage("Sources must be an array."),
  body("related_records")
    .optional()
    .isArray()
    .withMessage("Related records must be an array."),
  body("gallery")
    .optional()
    .isArray()
    .withMessage("Gallery must be an array."),
  body("blueprints")
    .optional()
    .isArray()
    .withMessage("Blueprints must be an array."),
  body("videos")
    .optional()
    .isArray()
    .withMessage("Videos must be an array."),
  body("documents")
    .optional()
    .isArray()
    .withMessage("Documents must be an array."),
  body("published")
    .optional()
    .isBoolean()
    .withMessage("Published must be a boolean."),
];

export const updateArmamentValidator = [
  body("title")
    .optional()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title must be under 500 characters."),
  body("summary")
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Summary must be under 2,000 characters."),
  body("category")
    .optional()
    .isIn(ARMAMENT_CATEGORIES)
    .withMessage(`Category must be one of: ${ARMAMENT_CATEGORIES.join(", ")}.`),
  nationField(true),
  body("specs")
    .optional()
    .isObject()
    .withMessage("Specs must be an object."),
  body("sources")
    .optional()
    .isArray()
    .withMessage("Sources must be an array."),
  body("related_records")
    .optional()
    .isArray()
    .withMessage("Related records must be an array."),
  body("gallery")
    .optional()
    .isArray()
    .withMessage("Gallery must be an array."),
  body("blueprints")
    .optional()
    .isArray()
    .withMessage("Blueprints must be an array."),
  body("videos")
    .optional()
    .isArray()
    .withMessage("Videos must be an array."),
  body("documents")
    .optional()
    .isArray()
    .withMessage("Documents must be an array."),
  body("published")
    .optional()
    .isBoolean()
    .withMessage("Published must be a boolean."),
];

export const listArmamentsValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100."),
  query("category")
    .optional()
    .isIn(ARMAMENT_CATEGORIES)
    .withMessage(`Category must be one of: ${ARMAMENT_CATEGORIES.join(", ")}.`),
  query("nation").optional().trim().isLength({ max: 200 }),
  query("search").optional().trim().isLength({ max: 200 }),
];
