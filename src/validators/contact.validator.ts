import { body } from "express-validator";

export const contactValidator = [
  body("name")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Name is required and must be under 100 characters."),
  body("email")
    .trim()
    .isEmail()
    .withMessage("A valid email address is required.")
    .normalizeEmail(),
  body("subject")
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Subject is required and must be under 200 characters."),
  body("message")
    .trim()
    .isLength({ min: 10, max: 5000 })
    .withMessage("Message must be between 10 and 5000 characters."),
];
