import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** H4: at least this many characters (code points), no rule on kinds of characters. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
const EMAIL_MAX = 254;
// N = 2^15, r = 8, p = 1: about 32 MiB and a few tens of ms per try on a Mac or a pod.
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_BYTES = 32;

/** Lower case without surrounding spaces, or null when it does not look like a mail address. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > EMAIL_MAX || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>".]+$/.test(email)) return null;
  return email;
}

/** The reason a new password is refused, or null when it may be used. */
export function passwordProblem(password: string, again: string): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상으로 정해주세요.`;
  if (length > PASSWORD_MAX) return `비밀번호는 ${PASSWORD_MAX}자 이하로 정해주세요.`;
  if (password !== again) return "비밀번호와 비밀번호 확인이 서로 다릅니다.";
  return null;
}

/** `scrypt$<log2 N>$<r>$<p>$<salt>$<key>`; the password itself is kept nowhere. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize("NFC"), salt, KEY_BYTES, SCRYPT);
  return ["scrypt", Math.log2(SCRYPT.N), SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

// Spent for a mail no member has, so an unknown mail takes as long as a wrong password.
const DUMMY = hashPassword(randomBytes(12).toString("base64url"));

/** True when `password` matches `stored`; null or a malformed `stored` never matches but takes as long. */
export function verifyPassword(password: string, stored: string | null): boolean {
  const parts = (stored ?? DUMMY).split("$");
  const ok = stored !== null && parts.length === 6 && parts[0] === "scrypt";
  const [, logN, r, p, salt, key] = ok ? parts : DUMMY.split("$");
  const want = Buffer.from(key, "base64url");
  let got: Buffer;
  try {
    got = scryptSync(password.normalize("NFC"), Buffer.from(salt, "base64url"), want.length, {
      N: 2 ** Number(logN), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
    });
  } catch {
    return false;
  }
  return ok && got.length === want.length && timingSafeEqual(got, want);
}

/** "Chrome · Mac" from a User-Agent, so a member can tell their sign-ins apart; "브라우저" when nothing is known. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Whale\//.test(ua)
      ? "Whale"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return [browser, os].filter(Boolean).join(" · ") || "브라우저";
}
