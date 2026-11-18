import assert from "node:assert/strict";
import test from "node:test";
import { authorizeAgentRead } from "./agent-read-auth.ts";

test("正しいBearerトークンだけを許可する", () => {
  assert.equal(
    authorizeAgentRead("Bearer test-read-token", "test-read-token"),
    true,
  );
  assert.equal(authorizeAgentRead("Bearer wrong", "test-read-token"), false);
  assert.equal(authorizeAgentRead(null, "test-read-token"), false);
});

test("サーバー側トークンが未設定なら閉じる", () => {
  assert.equal(authorizeAgentRead("Bearer anything", undefined), false);
});
