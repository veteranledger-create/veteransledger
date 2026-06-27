import { param } from "express-validator";

// Onboarding a second type to the publish pipeline means adding it here
// (this is checked again, independently, by PublishService — see
// SUPPORTED_TYPES there) and shipping its generator + conformance validator.
const SUPPORTED_TYPES = ["letters", "armaments", "personnel", "campaigns", "articles"];

export const publishTypeValidator = [
  param("type")
    .isIn(SUPPORTED_TYPES)
    .withMessage(`type must be one of: ${SUPPORTED_TYPES.join(", ")}`),
];
