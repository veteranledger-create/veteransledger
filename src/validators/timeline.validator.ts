import { body, query } from "express-validator";

export const createTimelineEventValidator = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title is required and must be under 500 characters."),
  body("year")
    .optional({ nullable: true })
    .isInt({ min: 1900, max: 1950 })
    .withMessage("Year must be between 1900 and 1950."),
  body("date")
    .optional({ nullable: true })
    .isISO8601()
    .withMessage("date must be a valid ISO 8601 date."),
  body("endDate")
    .optional({ nullable: true })
    .isISO8601()
    .withMessage("endDate must be a valid ISO 8601 date."),
  body("category")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage("Category must be under 100 characters."),
  body("location")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 300 })
    .withMessage("Location must be under 300 characters."),
  body("significance")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage("Significance must be under 500 characters."),
  body("published")
    .optional()
    .isBoolean()
    .withMessage("published must be a boolean."),
  body("metadata")
    .optional({ nullable: true })
    .isObject()
    .withMessage("metadata must be an object."),
];

export const updateTimelineEventValidator = [
  body("title")
    .optional()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title must be under 500 characters."),
  body("year")
    .optional({ nullable: true })
    .isInt({ min: 1900, max: 1950 })
    .withMessage("Year must be between 1900 and 1950."),
  body("date")
    .optional({ nullable: true })
    .isISO8601()
    .withMessage("date must be a valid ISO 8601 date."),
  body("endDate")
    .optional({ nullable: true })
    .isISO8601()
    .withMessage("endDate must be a valid ISO 8601 date."),
  body("category")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage("Category must be under 100 characters."),
  body("location")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 300 })
    .withMessage("Location must be under 300 characters."),
  body("significance")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage("Significance must be under 500 characters."),
  body("published")
    .optional()
    .isBoolean()
    .withMessage("published must be a boolean."),
  body("metadata")
    .optional({ nullable: true })
    .isObject()
    .withMessage("metadata must be an object."),
];

export const listTimelineValidator = [
  query("year")
    .optional()
    .isInt({ min: 1900, max: 1950 })
    .withMessage("Year must be between 1900 and 1950."),
  query("category")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Category must be under 100 characters."),
];
