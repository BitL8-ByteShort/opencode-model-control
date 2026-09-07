// Subprocess-only HTTP seam. No production environment bypass or provider calls.
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) =>
  String(url) === "https://models.dev/api.json"
    ? Promise.resolve(new Response("{}", { status: 503 }))
    : originalFetch(url, options);
