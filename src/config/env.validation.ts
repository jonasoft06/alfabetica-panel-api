import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production')
    .default('development'),

  PORT: Joi.number().default(4000),

  DATABASE_URL: Joi.string().uri().required(),

  FIREBASE_SERVICE_ACCOUNT_B64: Joi.string().required(),

  ALLOWED_EMAIL_DOMAIN: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().min(64).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('1h'),

  JWT_REFRESH_SECRET: Joi.string().min(64).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('12h'),

  SUPERADMIN_FIREBASE_UID: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),

  SPACES_ACCESS_KEY_ID: Joi.string().required(),
  SPACES_SECRET_ACCESS_KEY: Joi.string().required(),
  SPACES_BUCKET: Joi.string().required(),
  SPACES_REGION: Joi.string().required(),
  SPACES_ENDPOINT: Joi.string().required(),
  SPACES_CDN_URL: Joi.string().required(),

  // Personal API token: sent as-is in the Authorization header (no Bearer).
  CLICKUP_API_TOKEN: Joi.string().required(),
  // Folder a list lives in decides the book type, or that it is finished.
  CLICKUP_FOLDER_ACADEMIC_ID: Joi.string().required(),
  CLICKUP_FOLDER_TEXTBOOK_ID: Joi.string().required(),
  CLICKUP_FOLDER_ARCHIVE_ID: Joi.string().required(),
});
