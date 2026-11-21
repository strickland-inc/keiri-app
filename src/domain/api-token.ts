/**
 * API トークン。エージェントや外部のプログラムが `/api/v1` を呼ぶときに使う。
 * トークンそのものは発行した時に 1 度だけ見せ、保存するのは SHA-256 のハッシュだけ。
 */
export interface ApiToken {
  id: string;
  /** 何に使うトークンかを見分けるための名前。 */
  name: string;
  tokenHash: string;
  createdAt: string;
}

export type NewApiTokenInput = Pick<ApiToken, "name" | "tokenHash">;
