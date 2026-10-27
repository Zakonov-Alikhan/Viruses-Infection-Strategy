export function isPublicSupportCardNumber(value) {
  return typeof value === "string" && /^\d{13,19}$/.test(value);
}

export async function copySupportCardNumber(value, {
  clipboard = globalThis.navigator?.clipboard,
  document = globalThis.document
} = {}) {
  if (!isPublicSupportCardNumber(value)) throw new TypeError("invalid-support-card-number");
  if (typeof clipboard?.writeText === "function") {
    await clipboard.writeText(value);
    return;
  }
  if (!document?.body || typeof document.execCommand !== "function") {
    throw new Error("clipboard-unavailable");
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("clipboard-copy-failed");
}
