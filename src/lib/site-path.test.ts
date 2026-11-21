import assert from "node:assert/strict";
import test from "node:test";
import { sitePath } from "./site-path.ts";

test("サイトの中のパスは、そのまま返す", () => {
  assert.equal(sitePath("/"), "/");
  assert.equal(
    sitePath("/documents/abc?tab=1#top"),
    "/documents/abc?tab=1#top",
  );
  assert.equal(sitePath("/expenses/import"), "/expenses/import");
});

test("別のサイトを指すものは、トップページにする", () => {
  for (const next of [
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "\\\\evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
  ]) {
    assert.equal(sitePath(next), "/", JSON.stringify(next));
  }
});

test("相対パスは、サイトの中のパスとして解決する", () => {
  assert.equal(sitePath("documents"), "/documents");
  // 同じ http の相対指定は、このサイトの中のパスになる（外へは出ない）
  assert.equal(sitePath("http:evil.example"), "/evil.example");
});
