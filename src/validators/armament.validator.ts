import { body, query } from "express-validator";

const ARMAMENT_CATEGORIES = ["panzer", "aircraft", "naval", "missiles", "wunderwaffen", "equipment"] as const;
const NATIONS = ["germany", "italy", "japan", "other"] as const;

export const createArmamentValidator = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title is required and must be under 500 characters."),
  body("content")
    .optional()
    .trim()
    .isLength({ max: 100000 })
    .withMessage("Content must be under 100,000 characters."),
  body("summary")
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Summary must be under 2,000 characters."),
  body("year")
    .optional()
    .isInt({ min: 1900, max: 1950 })
    .withMessage("Year must be between 1900 and 1950."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array of strings."),
];

export const updateArmamentValidator = [
  body("title")
    .optional()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title must be under 500 characters."),
  body("content")
    .optional()
    .trim()
    .isLength({ max: 100000 })
    .withMessage("Content must be under 100,000 characters."),
  body("summary")
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Summary must be under 2,000 characters."),
  body("year")
    .optional()
    .isInt({ min: 1900, max: 1950 })
    .withMessage("Year must be between 1900 and 1950."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array of strings."),
];

export const listArmamentsValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100."),
  query("category")
    .optional()
    .isIn(ARMAMENT_CATEGORIES)
    .withMessage(`Category must be one of: ${ARMAMENT_CATEGORIES.join(", ")}.`),
  query("nation")
    .optional()
    .isIn(NATIONS)
    .withMessage(`Nation must be one of: ${NATIONS.join(", ")}.`),
  query("search").optional().trim().isLength({ max: 200 }),
];
