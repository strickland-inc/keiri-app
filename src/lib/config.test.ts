import assert from "node:assert/strict";
import test from "node:test";
import { getTypesafeConfig, hasGeminiConfig } from "./config.ts";

test(".env.example のように空の値が並んでいても、未設定として読める", () => {
  process.env.GEMINI_API_KEY = "";
  process.env.TYPESAFE_API_KEY = "";
  process.env.TYPESAFE_MODEL = "";

  assert.equal(hasGeminiConfig(), false);
  assert.deepEqual(getTypesafeConfig(), {
    apiKey: undefined,
    model: undefined,
  });
});
