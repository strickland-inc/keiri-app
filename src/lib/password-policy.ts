/** パスワードの規則と、回数の設定。 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export const DEFAULT_PASSWORD_ITERATIONS = 20_000;
export const MIN_PASSWORD_ITERATIONS = 20_000;
/** Cloudflare Workers は 100,000 回を超える PBKDF2 を拒否する。 */
export const MAX_PASSWORD_ITERATIONS = 100_000;

/** よくある弱いパスワード（12 文字以上のものだけ意味がある）。小文字で比べる。 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "password1234",
  "password12345",
  "passwordpassword",
  "123456789012",
  "1234567890123",
  "123412341234",
  "qwertyuiop12",
  "qwertyuiopas",
  "qwerty123456",
  "administrator",
  "adminadminadmin",
  "changemechangeme",
  "welcome12345",
  "letmein12345",
  "iloveyou1234",
  "abcdefghijkl",
  "abc123abc123",
  "pa$$w0rd1234",
  "p@ssw0rd1234",
  "keiri-app1234",
]);

/** 規則に合わなければ画面に出せる日本語の理由、合えば null。 */
export function validatePassword(
  password: string,
  loginId: string,
): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return `パスワードは ${PASSWORD_MIN_LENGTH} 文字以上にしてください`;
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return `パスワードは ${PASSWORD_MAX_LENGTH} 文字以内にしてください`;
  }
  const lower = password.toLowerCase();
  if (loginId && lower === loginId.trim().toLowerCase()) {
    return "パスワードにログイン ID と同じ文字列は使えません";
  }
  if (COMMON_PASSWORDS.has(lower) || new Set(lower).size === 1) {
    return "よく使われるパスワードのため使えません。別のものにしてください";
  }
  return null;
}

/**
 * PBKDF2 の回数。環境変数 KEIRI_PASSWORD_ITERATIONS（20,000〜100,000 の整数）で上げられる。
 * 範囲外や数字でない値は既定に戻す。
 */
export function passwordIterations(): number {
  const raw = process.env.KEIRI_PASSWORD_ITERATIONS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_PASSWORD_ITERATIONS;
  const n = Number(raw);
  return n >= MIN_PASSWORD_ITERATIONS && n <= MAX_PASSWORD_ITERATIONS
    ? n
    : DEFAULT_PASSWORD_ITERATIONS;
}

/** loginId（3〜64 文字、英数字と `._-@`）の規則。合わなければ理由、合えば null。 */
export function validateLoginId(loginId: string): string | null {
  if (!/^[A-Za-z0-9._@-]{3,64}$/.test(loginId.trim())) {
    return "ログイン ID は 3〜64 文字の英数字と . _ - @ だけで決めてください";
  }
  return null;
}

/** 表示名の規則。 */
export function validateDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "表示名を入力してください";
  if ([...trimmed].length > 50) return "表示名は 50 文字以内にしてください";
  return null;
}
