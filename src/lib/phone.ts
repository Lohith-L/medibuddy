// Phone numbers are stored and sent to Supabase in E.164 format (+91XXXXXXXXXX).
// Mirrors public.normalize_phone() in the database.

const DEFAULT_COUNTRY_CODE = "91"; // India

/**
 * "98765 43210" | "098765-43210" | "+91 98765 43210" | "919876543210" -> "+919876543210".
 * Returns null when the input can't be a phone number.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+${DEFAULT_COUNTRY_CODE}${digits}`;
  else if (digits.length === 11 && digits.startsWith("0")) e164 = `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else e164 = `+${digits}`;

  // E.164: country code + subscriber number, 8 to 15 digits in total.
  const len = e164.length - 1;
  if (len < 8 || len > 15) return null;
  // Indian mobile numbers: +91 followed by 10 digits starting 6-9.
  if (e164.startsWith("+91") && !/^\+91[6-9]\d{9}$/.test(e164)) return null;
  return e164;
}

/** Supabase returns auth phones without the "+" ("919876543210"); this restores E.164. */
export function fromAuthPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

/** "+919876543210" -> "+91 98765 43210" for display. */
export function formatPhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return "";
  const e164 = phone.startsWith("+") ? phone : `+${phone.replace(/\D/g, "")}`;
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}
