/** auth-server.ts をメモリ版の Repository で通す。試用モード（KEIRI_DEMO_AUTH=1）の接続コード demo を使う。 */
import { after, before } from "node:test";
import {
  resetAuthMemory,
  authCounterCount,
  seedLegacyUser,
} from "../repositories/memory.ts";
import { defineAuthSuite } from "./auth-server.suite.ts";

const env = process.env as Record<string, string | undefined>;
const saved = {
  KEIRI_CONNECTION: env.KEIRI_CONNECTION,
  KEIRI_DEMO_AUTH: env.KEIRI_DEMO_AUTH,
  NODE_ENV: env.NODE_ENV,
};

before(() => {
  delete env.KEIRI_CONNECTION;
  env.KEIRI_DEMO_AUTH = "1";
  if (env.NODE_ENV === "production") env.NODE_ENV = "test";
});

after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

defineAuthSuite({
  async reset() {
    resetAuthMemory();
  },
  async seedLegacyUser(loginId, passwordHash) {
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();
    seedLegacyUser({
      id,
      loginId,
      passwordHash,
      role: "admin",
      createdAt: ts,
      updatedAt: ts,
    });
    return id;
  },
  connectionCode: () => "demo",
  counterRowCount: authCounterCount,
});
