import { body, query } from "express-validator";

export const createFormationValidator = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title is required and must be under 500 characters."),
  body("summary")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Summary must be under 2,000 characters."),
  body("content")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100000 })
    .withMessage("Content must be under 100,000 characters."),
  body("nationality")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage("Nationality must be under 200 characters."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array."),
  body("published")
    .optional()
    .isBoolean()
    .withMessage("published must be a boolean."),
  body("metadata")
    .optional({ nullable: true })
    .isObject()
    .withMessage("metadata must be an object."),
];

export const updateFormationValidator = [
  body("title")
    .optional()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title must be under 500 characters."),
  body("summary")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Summary must be under 2,000 characters."),
  body("content")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100000 })
    .withMessage("Content must be under 100,000 characters."),
  body("nationality")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 200 })
    .withMessage("Nationality must be under 200 characters."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array."),
  body("published")
    .optional()
    .isBoolean()
    .withMessage("published must be a boolean."),
  body("metadata")
    .optional({ nullable: true })
    .isObject()
    .withMessage("metadata must be an object."),
];

export const listFormationsValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100."),
  query("section").optional().trim().isLength({ max: 100 }),
  query("search").optional().trim().isLength({ max: 200 }),
];
