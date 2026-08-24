/** Barcode helpers: validation and checksum computation. */

export interface BarcodeInfo {
  valid: boolean;
  format: "EAN-13" | "EAN-8" | "UPC-A" | "UPC-E" | "Code128" | "Unknown";
  /** Normalized 12-13 digit GTIN when the code is a product barcode. */
  gtin?: string;
}

/** Computes the EAN/UPC check digit for a payload. */
export function computeCheckDigit(payload: string): number {
  // EAN-13 / UPC-A: sum of digits with weights 1,3 alternating from the right.
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const digit = payload.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return -1;
    const positionFromRight = payload.length - i;
    sum += digit * (positionFromRight % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** Validates a barcode string. Supports EAN-13, EAN-8, UPC-A, UPC-E and Code 128. */
export function validateBarcode(raw: string): BarcodeInfo {
  const code = raw.trim();
  if (!code) return { valid: false, format: "Unknown" };

  const isDigits = /^\d+$/.test(code);

  // UPC-E: 6 digits, optionally "0"+"UPC-E" or "0"+code+"0"
  if (isDigits && code.length === 6 && /^(0|1)/.test(code)) {
    return { valid: true, format: "UPC-E", gtin: expandUpcE(code) };
  }
  // UPC-E with leading zero marker: 0 + 6 digits
  if (isDigits && code.length === 7 && code[0] === "0" && /^[01]/.test(code.slice(1))) {
    return { valid: true, format: "UPC-E", gtin: expandUpcE(code.slice(1)) };
  }
  // EAN-8
  if (isDigits && code.length === 8) {
    const check = Number(code[7]);
    return { valid: computeCheckDigit(code.slice(0, 7)) === check, format: "EAN-8", gtin: code };
  }
  // UPC-A (12 digits) or EAN-13 (13 digits)
  if (isDigits && (code.length === 12 || code.length === 13)) {
    const check = Number(code[code.length - 1]);
    const valid = computeCheckDigit(code.slice(0, code.length - 1)) === check;
    return { valid, format: code.length === 12 ? "UPC-A" : "EAN-13", gtin: code };
  }
  // Code 128: printable characters, no strict checksum validation here.
  if (/^[\x20-\x7E]+$/.test(code) && code.length >= 4) {
    return { valid: true, format: "Code128" };
  }
  return { valid: false, format: "Unknown" };
}

/**
 * Expands a UPC-E code to a full 12-digit UPC-A (number system 0).
 * GS1 conversion: the trailing digit d6 determines where the zero-padding
 * goes in the manufacturer/product fields.
 */
export function expandUpcE(upcE: string): string {
  if (upcE.length !== 6) return upcE;
  const [x1, x2, x3, x4, x5, x6] = upcE.split("").map(Number);
  let body: string;
  if (x6 <= 2) {
    body = `0${x1}${x2}${x6}0000${x3}${x4}${x5}`;
  } else if (x6 === 3) {
    body = `0${x1}${x2}${x3}00000${x4}${x5}`;
  } else if (x6 === 4) {
    body = `0${x1}${x2}${x3}${x4}0000${x5}`;
  } else {
    body = `0${x1}${x2}${x3}${x4}${x5}00000`;
  }
  const check = computeCheckDigit(body);
  return `${body}${check}`;
}

/** Sanitizes scanner output into a canonical barcode string. */
export function normalizeBarcode(raw: string): string {
  return raw.trim().replace(/^0+(?=\d{6,})/, "");
}