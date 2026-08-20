export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Thrown when a request never reached Overlay at all because the reverse
 * proxy's auth portal (Authelia, see docs/DEPLOYMENT.md section 9) answered
 * it instead — its own session expired, independently of Overlay's.
 * Distinct from ApiError so callers don't report "wrong password" for a
 * password the server never got to see.
 */
export class SsoExpiredError extends Error {
  constructor() {
    super("sso_expired");
  }
}

/** Guards against a reload loop if the reload comes back still unauthenticated. */
const SSO_RELOAD_FLAG = "overlay-sso-reload";

function isSsoInterception(res: Response): boolean {
  // Authelia redirects to its login portal, which lives on another port of
  // the same host — a different origin. fetch() can't follow that (both our
  // own CSP's connect-src 'self' and CORS stop the hop) and reports the
  // failure as an indistinguishable network error, so requests below ask for
  // redirect: "manual" and the redirect surfaces here instead.
  if (res.type === "opaqueredirect") return true;
  // Requests that don't look like a navigation get a bare 401 with an HTML
  // body rather than a redirect. Overlay's own 401s always carry JSON.
  if (res.status !== 401 && res.status !== 403) return false;
  return !(res.headers.get("content-type") ?? "").includes("application/json");
}

/**
 * Only a full navigation can reach the auth portal: it is the one request
 * whose redirect the *browser* follows. Reloading keeps the current URL, so
 * the portal sends the user back where they were after logging in.
 */
function handleSsoExpiry(): SsoExpiredError {
  if (sessionStorage.getItem(SSO_RELOAD_FLAG) !== "1") {
    sessionStorage.setItem(SSO_RELOAD_FLAG, "1");
    window.location.reload();
  }
  return new SsoExpiredError();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    redirect: "manual",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (isSsoInterception(res)) throw handleSsoExpiry();
  // Anything answered by Overlay itself proves the portal let us through, so
  // a later expiry gets its one reload again.
  sessionStorage.removeItem(SSO_RELOAD_FLAG);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return res.json();
  return res.text() as unknown as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
