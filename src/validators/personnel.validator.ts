import { body, query } from "express-validator";

export const createPersonnelValidator = [
  body("name")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Name is required and must be under 500 characters."),
  body("nationality")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Nationality must be under 100 characters."),
  body("birthDate")
    .optional()
    .isISO8601()
    .withMessage("birthDate must be a valid ISO 8601 date."),
  body("deathDate")
    .optional()
    .isISO8601()
    .withMessage("deathDate must be a valid ISO 8601 date."),
  body("summary")
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Summary must be under 2,000 characters."),
  body("biography")
    .optional()
    .trim()
    .isLength({ max: 100000 })
    .withMessage("Biography must be under 100,000 characters."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array of strings."),
];

export const updatePersonnelValidator = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Name must be under 500 characters."),
  body("nationality")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Nationality must be under 100 characters."),
  body("birthDate")
    .optional()
    .isISO8601()
    .withMessage("birthDate must be a valid ISO 8601 date."),
  body("deathDate")
    .optional()
    .isISO8601()
    .withMessage("deathDate must be a valid ISO 8601 date."),
  body("summary")
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Summary must be under 2,000 characters."),
  body("biography")
    .optional()
    .trim()
    .isLength({ max: 100000 })
    .withMessage("Biography must be under 100,000 characters."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array of strings."),
];

export const listPersonnelValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100."),
  query("branch").optional().isString(),
  query("nation").optional().isString(),
  query("search").optional().trim().isLength({ max: 200 }),
];
