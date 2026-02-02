import fs from "node:fs";

export const JWT_SECRET = process.env.JWT_SECRET!;
export const PORT = process.env.PORT || 8000;

// Cloudinary
export const CLOUDINARY_CONFIG = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
};

// Biteship Configuration
const readSecretFile = (path: string) => {
  try {
    if (!path) return "";
    if (!fs.existsSync(path)) return "";
    return fs.readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
};

const BITESHIP_API_KEY_FROM_FILE = readSecretFile(
  process.env.BITESHIP_API_KEY_FILE || "/run/secrets/biteship_api_key"
);

export const BITESHIP_API_KEY =
  process.env.BITESHIP_API_KEY ||
  BITESHIP_API_KEY_FROM_FILE ||
  "your_biteship_api_key_here";
export const BITESHIP_BASE_URL = process.env.BITESHIP_BASE_URL || "https://api.biteship.com";

// Origin Location
export const ORIGIN_POSTAL_CODE = process.env.ORIGIN_POSTAL_CODE || "11220";
export const ORIGIN_CITY_NAME = process.env.ORIGIN_CITY_NAME || "Jakarta Barat";
export const ORIGIN_PROVINCE = process.env.ORIGIN_PROVINCE || "DKI Jakarta";

// Packaging Fee
export const PACKAGING_FEE = parseInt(process.env.PACKAGING_FEE || "2500");
