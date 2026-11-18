import { timingSafeEqual } from "node:crypto";

/** Authorization ヘッダーの Bearer トークンが、サーバー側のトークンと一致するか。未設定なら常に false。 */
export function authorizeAgentRead(
  authorization: string | null,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken || !authorization?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
