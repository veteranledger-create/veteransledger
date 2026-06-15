import { body } from "express-validator";

export const loginValidator = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("A valid email address is required.")
    .normalizeEmail(),
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters."),
];

export const registerValidator = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("A valid email address is required.")
    .normalizeEmail(),
  body("password")
    .isLength({ min: 12 })
    .withMessage("Password must be at least 12 characters.")
    .matches(/[A-Z]/)
    .withMessage("Password must contain at least one uppercase letter.")
    .matches(/[0-9]/)
    .withMessage("Password must contain at least one number."),
  body("name")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Name must be under 100 characters."),
];

export const changePasswordValidator = [
  body("currentPassword")
    .notEmpty()
    .withMessage("Current password is required."),
  body("newPassword")
    .isLength({ min: 12 })
    .withMessage("New password must be at least 12 characters."),
];
