// Playwright propagates FORCE_COLOR to its workers. Preserve a requested
// colorless run through that variable alone, avoiding Node's conflicting-env warning.
if (Object.hasOwn(process.env, "NO_COLOR")) {
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR = "0";
}
