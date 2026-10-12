/**
 * API client for the Django backend. Same surface the app used to get from the previous hosted SDK
 * (api.entities.X.list/filter/get/create/update/delete/..., api.auth.*, api.integrations.Core.*),
 * so pages only had to swap the import.
 *
 * VITE_API_URL: leave empty to call the same origin (the Vite dev server proxies /api and /media to
 * Django, and production should put both behind one reverse proxy). Set it when the API lives elsewhere.
 */
const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "access_token";

// --- token storage ---------------------------------------------------------------------------------------
const storage = {
  get: () => { try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { window.localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } },
  clear: () => { try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function request(method, path, { body, query, form } = {}) {
  const url = new URL(`${API_URL}${path}`, window.location.origin);
  Object.entries(query || {}).forEach(([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, v));
  const headers = {};
  const token = storage.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form; // browser sets the multipart boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, null);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) storage.clear(); // expired/revoked session
    throw new ApiError(data?.message || data?.detail || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

// --- entities --------------------------------------------------------------------------------------------
const POLL_MS = 3000;

function entityClient(name) {
  const base = `/api/entities/${name}/`;
  return {
    list: (sort, limit, skip) => request("GET", base, { query: { sort, limit, skip } }),
    filter: (q = {}, sort, limit, skip) => request("POST", `${base}query/`, { body: { q, sort, limit, skip } }),
    get: (id) => request("GET", `${base}${id}/`),
    create: (data) => request("POST", base, { body: data }),
    update: (id, data) => request("PATCH", `${base}${id}/`, { body: data }),
    delete: (id) => request("DELETE", `${base}${id}/`),
    deleteMany: (q) => request("POST", `${base}delete-many/`, { body: { q } }),
    bulkCreate: (items) => request("POST", `${base}bulk-create/`, { body: { items } }),
    bulkUpdate: (items) => request("POST", `${base}bulk-update/`, { body: { items } }),
    /**
     * Calls `callback({type: "create", id, data})` for records created after this call. Implemented by
     * polling (no websocket server needed); returns an unsubscribe function.
     */
    subscribe(callback) {
      let since = null;
      let stopped = false;
      let timer;
      const tick = async () => {
        try {
          if (since === null) {
            const latest = await this.list("-created_date", 1);
            since = latest[0]?.created_date ?? new Date(0).toISOString();
          } else {
            const fresh = await this.filter({ created_date: { $gt: since } }, "created_date", 200);
            for (const record of fresh) {
              since = record.created_date;
              if (!stopped) callback({ type: "create", id: record.id, data: record });
            }
          }
        } catch { /* transient network/auth error: try again next tick */ }
        if (!stopped) timer = setTimeout(tick, POLL_MS);
      };
      tick();
      return () => { stopped = true; clearTimeout(timer); };
    },
  };
}

const entities = new Proxy({}, { get: (cache, name) => (cache[name] ??= entityClient(String(name))) });

// --- auth ------------------------------------------------------------------------------------------------
const auth = {
  me: () => request("GET", "/api/auth/me/"),
  updateMe: (data) => request("PATCH", "/api/auth/me/", { body: data }),
  isAuthenticated: async () => Boolean(storage.get()),
  setToken: (token) => storage.set(token),

  async loginViaEmailPassword(email, password) {
    const data = await request("POST", "/api/auth/login/", { body: { email, password } });
    storage.set(data.access_token);
    return data;
  },
  register: ({ email, password, full_name }) => request("POST", "/api/auth/register/", { body: { email, password, full_name } }),
  verifyOtp: ({ email, otpCode }) => request("POST", "/api/auth/verify-otp/", { body: { email, otp_code: otpCode } }),
  resendOtp: (email) => request("POST", "/api/auth/resend-otp/", { body: { email } }),
  resetPasswordRequest: (email) => request("POST", "/api/auth/reset-password-request/", { body: { email } }),
  resetPassword: ({ resetToken, newPassword }) =>
    request("POST", "/api/auth/reset-password/", { body: { reset_token: resetToken, new_password: newPassword } }),

  /** Full-page redirect to Google; the backend sends the browser back to /auth/callback with a token. */
  loginWithProvider(provider, returnTo = "/") {
    if (provider !== "google") throw new Error(`Unsupported provider: ${provider}`);
    window.location.href = `${API_URL}/api/auth/google/start/?returnTo=${encodeURIComponent(returnTo)}`;
  },

  async logout(redirect = true) {
    try { await request("POST", "/api/auth/logout/"); } catch { /* already signed out */ }
    storage.clear();
    if (redirect) window.location.href = "/login";
  },
  redirectToLogin(returnTo = window.location.pathname + window.location.search) {
    window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  },
};

const users = {
  inviteUser: (email, role = "user") => request("POST", "/api/auth/invite-user/", { body: { email, role } }),
  inviteEmployee: ({ email, employee_name, role }) =>
    request("POST", "/api/auth/invite-employee/", { body: { email, employee_name, role } }),
};

// --- integrations ----------------------------------------------------------------------------------------
async function upload(file, isPrivate) {
  const form = new FormData();
  form.append("file", file);
  if (isPrivate) form.append("private", "true");
  return request("POST", "/api/files/upload/", { form });
}

const integrations = {
  Finance: {
    AccrueMonthlyInterest: (financingRequestId) =>
      request("POST", `/api/entities/FinancingRequest/${financingRequestId}/accrue-interest/`, { body: {} }),
    InterestPortfolio: () => request("GET", "/api/finance/interest-portfolio/"),
    AccruePortfolioInterest: () => request("POST", "/api/finance/interest-portfolio/", { body: {} }),
  },
  Core: {
    /** -> { file_url } */
    UploadPublicFile: ({ file }) => upload(file, false),
    /** -> { file_uri }; store it on a record and the API returns a short-lived signed link to authorised readers. */
    UploadPrivateFile: ({ file }) => upload(file, true),
    SendEmail: ({ to, subject, html, body }) => request("POST", "/api/integrations/send-email/", { body: { to, subject, html: html ?? body } }),
  },
};

const messaging = {
  searchRecipients: (query) => request("GET", "/api/messaging/recipients/", { query: { q: query } }),
  startConversation: (recipientId) =>
    request("POST", "/api/messaging/start/", { body: { recipient_id: recipientId } }),
  connect(onEvent, onStatus = () => {}) {
    let stopped = false;
    let socket = null;
    let reconnectTimer = null;
    let attempts = 0;

    const open = () => {
      if (stopped) return;
      onStatus("connecting");
      const url = new URL(API_URL || window.location.origin, window.location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/ws/messages/";
      url.search = "";
      socket = new WebSocket(url);

      socket.onopen = () => {
        const token = storage.get();
        if (!token) {
          socket.close(4401);
          return;
        }
        socket.send(JSON.stringify({ type: "authenticate", token }));
      };
      socket.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); }
        catch { return; }
        if (data.type === "authenticated") {
          attempts = 0;
          onStatus("connected");
        } else {
          onEvent(data);
        }
      };
      socket.onclose = (event) => {
        onStatus("disconnected");
        if (stopped || event.code === 4401) return;
        const delay = Math.min(1000 * (2 ** attempts), 15000);
        attempts += 1;
        reconnectTimer = setTimeout(open, delay);
      };
    };

    open();
    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      socket?.close(1000);
    };
  },
};

export const api = { entities, auth, users, integrations, messaging };
export default api;
