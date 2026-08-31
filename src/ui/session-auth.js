export const MUTATION_SESSION_QUERY = "omc_session";
export const MUTATION_SESSION_STORAGE_KEY = "opencode-model-control.mutation-session";

const SESSION_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function readStoredSession(browser) {
  try {
    const value = browser.sessionStorage.getItem(MUTATION_SESSION_STORAGE_KEY);
    if (value && SESSION_SECRET_PATTERN.test(value)) return value;
    if (value) browser.sessionStorage.removeItem(MUTATION_SESSION_STORAGE_KEY);
  } catch {
    // The query-delivered value still authorizes this page load when storage is unavailable.
  }
  return null;
}

export function captureMutationSession(browser = globalThis.window) {
  if (!browser?.location?.href || !browser?.history?.replaceState) return null;

  const url = new URL(browser.location.href);
  const values = url.searchParams.getAll(MUTATION_SESSION_QUERY);
  if (values.length === 0) return readStoredSession(browser);

  url.searchParams.delete(MUTATION_SESSION_QUERY);
  browser.history.replaceState(
    browser.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );

  const sessionSecret = values.length === 1 && SESSION_SECRET_PATTERN.test(values[0])
    ? values[0]
    : null;
  try {
    if (sessionSecret) {
      browser.sessionStorage.setItem(MUTATION_SESSION_STORAGE_KEY, sessionSecret);
    } else {
      browser.sessionStorage.removeItem(MUTATION_SESSION_STORAGE_KEY);
    }
  } catch {
    // Keep the in-memory value for this page load when session storage is unavailable.
  }
  return sessionSecret;
}
