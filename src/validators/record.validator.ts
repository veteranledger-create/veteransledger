import { body, query } from "express-validator";

export const createRecordValidator = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title is required and must be under 500 characters."),
  body("type")
    .isIn(["CAMPAIGN", "ARMAMENT", "LETTER", "ARTICLE", "TIMELINE_EVENT", "DOCUMENT"])
    .withMessage("Record type must be one of: CAMPAIGN, ARMAMENT, LETTER, ARTICLE, TIMELINE_EVENT, DOCUMENT."),
  body("content")
    .optional()
    .trim()
    .isLength({ max: 100000 })
    .withMessage("Content must be under 100,000 characters."),
  body("year")
    .optional()
    .isInt({ min: 1900, max: 1950 })
    .withMessage("Year must be between 1900 and 1950."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array of strings."),
];

export const updateRecordValidator = [
  body("title")
    .optional()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title must be under 500 characters."),
  body("type")
    .optional()
    .isIn(["CAMPAIGN", "ARMAMENT", "LETTER", "ARTICLE", "TIMELINE_EVENT", "DOCUMENT"])
    .withMessage("Record type must be one of: CAMPAIGN, ARMAMENT, LETTER, ARTICLE, TIMELINE_EVENT, DOCUMENT."),
  body("content")
    .optional()
    .trim()
    .isLength({ max: 100000 })
    .withMessage("Content must be under 100,000 characters."),
  body("year")
    .optional()
    .isInt({ min: 1900, max: 1950 })
    .withMessage("Year must be between 1900 and 1950."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array of strings."),
];

export const listRecordsValidator = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100."),
  query("type")
    .optional()
    .isIn(["CAMPAIGN", "ARMAMENT", "LETTER", "ARTICLE", "TIMELINE_EVENT", "DOCUMENT"])
    .withMessage("Invalid record type."),
];

export const searchValidator = [
  query("q")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Search query must be between 1 and 200 characters."),
  query("type")
    .optional()
    .isString(),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer."),
];
