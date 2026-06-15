import { body, query } from "express-validator";

export const createCampaignValidator = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Title is required and must be under 500 characters."),
  body("summary")
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Summary must be under 2,000 characters."),
  body("content")
    .optional()
    .trim()
    .isLength({ max: 100000 })
    .withMessage("Content must be under 100,000 characters."),
  body("location")
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage("Location must be under 255 characters."),
  body("startDate")
    .optional()
    .isISO8601()
    .withMessage("startDate must be a valid ISO 8601 date."),
  body("endDate")
    .optional()
    .isISO8601()
    .withMessage("endDate must be a valid ISO 8601 date."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array of strings."),
];

export const updateCampaignValidator = [
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
  body("content")
    .optional()
    .trim()
    .isLength({ max: 100000 })
    .withMessage("Content must be under 100,000 characters."),
  body("location")
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage("Location must be under 255 characters."),
  body("startDate")
    .optional()
    .isISO8601()
    .withMessage("startDate must be a valid ISO 8601 date."),
  body("endDate")
    .optional()
    .isISO8601()
    .withMessage("endDate must be a valid ISO 8601 date."),
  body("tags")
    .optional()
    .isArray()
    .withMessage("Tags must be an array of strings."),
];

export const listCampaignsValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100."),
  query("theater").optional().isString(),
  query("search").optional().trim().isLength({ max: 200 }),
];
