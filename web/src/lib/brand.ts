/**
 * Single source of truth for app-wide brand defaults. Anywhere we'd
 * previously hard-code "TTNAWA" or the logo path, import from here so
 * a future rebrand only needs one edit.
 */

export const BRAND_DEFAULT_ORG_NAME = "TTNAWA";
export const BRAND_DEFAULT_ORG_LONG_NAME =
  "Tamil Nadu Arm Wrestling Association";
export const BRAND_DEFAULT_LOGO_SRC = "/brand/logo.jpg";
