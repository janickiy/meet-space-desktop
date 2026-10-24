/** Numeric QR geometry with a four-module quiet zone on every side. */
export interface QrCodePath {
  size: number;
  path: string;
}

/** Encodes a non-empty payload of at most 2048 UTF-16 code units with medium ECC. */
export function qrCodePath(text: string): QrCodePath;
