// Money is stored as integer paise to avoid float drift.
// API accepts amount as a string in INR (e.g. "12.50") or a number; we parse
// strictly and reject anything we can't represent exactly.

export const MAX_AMOUNT_PAISE = 1_000_000_000_00; // ₹1,000 Cr — sanity ceiling

export function parseAmountToPaise(input: unknown): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error("amount must be finite");
    // Force string round-trip so we don't silently accept 0.1 + 0.2 = 0.30000000000000004
    input = input.toFixed(2);
  }
  if (typeof input !== "string") throw new Error("amount must be a string or number");

  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("amount must be a positive decimal with up to 2 places");
  }

  const [whole, frac = ""] = trimmed.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));

  if (!Number.isInteger(paise) || paise <= 0) throw new Error("amount must be > 0");
  if (paise > MAX_AMOUNT_PAISE) throw new Error("amount exceeds maximum");
  return paise;
}

export function paiseToRupeeString(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, "0");
  return `${sign}${rupees}.${fraction}`;
}
