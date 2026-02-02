import { customAlphabet } from "nanoid";

/**
 * Generate unique order number
 * Format: ORD-YYYYMMDD-<NANOID>
 * Example: ORD-20250116-3J8T2H9QK7VW
 */
const nanoid = customAlphabet("0123456789ABCDEFGHJKMNPQRSTVWXYZ", 12);

export const generateOrderNumber = async (): Promise<string> => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const datePrefix = `ORD-${year}${month}${day}`;

  return `${datePrefix}-${nanoid()}`;
};
