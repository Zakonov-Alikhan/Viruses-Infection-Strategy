import assert from "node:assert/strict";
import test from "node:test";
import { copySupportCardNumber, isPublicSupportCardNumber } from "./support.js";
import { readFile } from "node:fs/promises";

test("public support card config accepts only digit-only card numbers", () => {
  assert.equal(isPublicSupportCardNumber("1234567890123"), true);
  assert.equal(isPublicSupportCardNumber("1234 5678 9012 3456"), false);
  assert.equal(isPublicSupportCardNumber("123456789012"), false);
  assert.equal(isPublicSupportCardNumber(undefined), false);
});

test("support copy uses the exact unformatted card number", async () => {
  let copied = null;
  await copySupportCardNumber("1234567890123456", {
    clipboard: { writeText: async (value) => { copied = value; } },
    document: null
  });
  assert.equal(copied, "1234567890123456");
});

test("support section has no hard-coded payment details and keeps a pending state", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /id="support-pending"/);
  assert.match(html, /id="support-copy-card"[^>]*hidden/);
  assert.doesNotMatch(html, /\b(?:\d[ -]*?){13,19}\b/);
});
