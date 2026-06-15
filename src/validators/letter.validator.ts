import { body, query } from "express-validator";

export const createLetterValidator = [
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
  body("date")
    .optional()
    .isISO8601()
    .withMessage("date must be a valid ISO 8601 date."),
  body("nationality")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Nationality must be under 100 characters."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array of strings."),
];

export const updateLetterValidator = [
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
  body("date")
    .optional()
    .isISO8601()
    .withMessage("date must be a valid ISO 8601 date."),
  body("nationality")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Nationality must be under 100 characters."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array of strings."),
];

export const listLettersValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100."),
  query("language").optional().isString(),
  query("search").optional().trim().isLength({ max: 200 }),
];
