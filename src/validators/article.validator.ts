import { body, query } from "express-validator";

const ARTICLE_CATEGORIES = ["military", "political", "economy", "legal"] as const;

export const createArticleValidator = [
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

export const updateArticleValidator = [
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

export const listArticlesValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100."),
  query("category")
    .optional()
    .isIn(ARTICLE_CATEGORIES)
    .withMessage(`Category must be one of: ${ARTICLE_CATEGORIES.join(", ")}.`),
  query("search").optional().trim().isLength({ max: 200 }),
];
