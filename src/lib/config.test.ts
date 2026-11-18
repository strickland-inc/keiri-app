import assert from "node:assert/strict";
import test from "node:test";

test(".env.example のように空の値が並んでいても、未設定として読める", async () => {
  const empties = [
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
    "SHEETS_SPREADSHEET_ID",
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AGENT_READ_TOKEN",
    "AGENT_WRITE_TOKEN",
  ];
  for (const name of empties) process.env[name] = "";

  const { getConfig, hasGeminiConfig, hasSheetsConfig } =
    await import("./config.ts");
  const c = getConfig();
  assert.equal(c.GOOGLE_SERVICE_ACCOUNT_EMAIL, undefined);
  assert.equal(c.OPENAI_API_KEY, undefined);
  assert.equal(c.AGENT_READ_TOKEN, undefined);
  assert.equal(hasGeminiConfig(), false);
  assert.equal(hasSheetsConfig(), false);
});
