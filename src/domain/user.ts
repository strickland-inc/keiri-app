/** アプリのログインユーザー。パスワードはハッシュで保存する。 */
export type UserRole = "admin" | "user";

export interface User {
  id: string;
  loginId: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export type NewUserInput = Omit<User, "id" | "createdAt" | "updatedAt">;
