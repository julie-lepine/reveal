/**
 * Audit liens n°1 — un lien `com.reveal.partygames://…` ne doit ouvrir une session
 * que si ce téléphone a lancé la connexion peu avant, sur `auth/callback`.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();

const setSessionMock = mock.fn(async ({ access_token }) => ({
  data: { session: { access_token, user: { id: "u-1", email: "a@b.fr" } } },
  error: null,
}));
const exchangeMock = mock.fn(async () => ({ data: { session: null }, error: null }));
const verifyOtpMock = mock.fn(async () => ({ data: { session: null }, error: null }));

mock.module("../js/core/platform.js", {
  namedExports: {
    isNativeApp: () => true,
    getNativePlatform: () => "android",
    getCapacitor: () => null,
  },
});

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => true,
    supabase: {
      auth: {
        setSession: setSessionMock,
        exchangeCodeForSession: exchangeMock,
        verifyOtp: verifyOtpMock,
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from: () => ({}),
      rpc: async () => ({ data: null, error: null }),
    },
  },
});

const {
  NATIVE_AUTH_PENDING_KEY,
  RECOVERY_PENDING_MAX_MS,
  emailFromAccessToken,
  evaluateNativeAuthLink,
  isNativeAuthCallbackUrl,
  markNativeRecoveryPending,
  readNativeAuthPending,
} = await import("../js/core/nativeAuthLinkGuard.js");

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function jwt(payload) {
  return `${b64url({ alg: "HS256" })}.${b64url(payload)}.sig`;
}

const CALLBACK = "com.reveal.partygames://auth/callback";
const NOW = 10_000_000;
const PENDING = { kind: "recovery", at: NOW - 60_000, email: "moi@ex.fr" };

describe("nativeAuthLinkGuard — règles pures", () => {
  it("n'accepte que l'adresse auth/callback", () => {
    assert.equal(isNativeAuthCallbackUrl(`${CALLBACK}#access_token=x`), true);
    assert.equal(isNativeAuthCallbackUrl(`${CALLBACK}/?code=1`), true);
    assert.equal(isNativeAuthCallbackUrl("com.reveal.partygames://x#access_token=x"), false);
    assert.equal(isNativeAuthCallbackUrl("com.reveal.partygames://auth/callbackX#a"), false);
    assert.equal(isNativeAuthCallbackUrl("https://evil.example/auth/callback#a"), false);
  });

  it("lit l'email d'un jeton (accents compris)", () => {
    assert.equal(emailFromAccessToken(jwt({ email: "Moi@Ex.fr" })), "moi@ex.fr");
    assert.equal(emailFromAccessToken(jwt({ email: "élodie@ex.fr" })), "élodie@ex.fr");
    assert.equal(emailFromAccessToken("pas-un-jeton"), null);
  });

  it("accepte la réinitialisation demandée ici, pour le même compte, dans l'heure", () => {
    const v = evaluateNativeAuthLink({
      rawUrl: CALLBACK,
      isRecovery: true,
      accessToken: jwt({ email: "moi@ex.fr" }),
      pending: PENDING,
      now: NOW,
    });
    assert.deepEqual(v, { ok: true });
  });

  it("refuse tout le reste", () => {
    const token = jwt({ email: "moi@ex.fr" });
    const cases = [
      [{ isRecovery: false, accessToken: token, pending: PENDING }, "not_recovery"],
      [{ isRecovery: true, accessToken: null, pending: PENDING }, "unsupported_flow"],
      [{ isRecovery: true, accessToken: token, pending: null }, "no_pending_recovery"],
      [
        {
          isRecovery: true,
          accessToken: token,
          pending: { ...PENDING, at: NOW - RECOVERY_PENDING_MAX_MS - 1 },
        },
        "pending_expired",
      ],
      [
        { isRecovery: true, accessToken: jwt({ email: "autre@ex.fr" }), pending: PENDING },
        "recovery_email_mismatch",
      ],
    ];
    for (const [input, reason] of cases) {
      const v = evaluateNativeAuthLink({ rawUrl: CALLBACK, now: NOW, ...input });
      assert.equal(v.reason, reason);
    }
  });
});

describe("handleAuthRedirectUrl sur l'appli", () => {
  let handleAuthRedirectUrl;

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    setSessionMock.mock.resetCalls();
    exchangeMock.mock.resetCalls();
    verifyOtpMock.mock.resetCalls();
    ({ handleAuthRedirectUrl } = await import("../js/core/supabaseAuth.js"));
  });

  it("refuse des jetons non demandés (pas de changement de session)", async () => {
    const res = await handleAuthRedirectUrl(
      `${CALLBACK}#access_token=${jwt({ email: "attaquant@ex.fr" })}&refresh_token=r`
    );
    assert.equal(res.handled, false);
    assert.equal(res.rejected, true);
    assert.equal(setSessionMock.mock.callCount(), 0);
  });

  it("refuse un lien de réinitialisation d'un autre compte, sans ouvrir l'écran mot de passe", async () => {
    markNativeRecoveryPending({ email: "moi@ex.fr" });
    const res = await handleAuthRedirectUrl(
      `${CALLBACK}#access_token=${jwt({ email: "attaquant@ex.fr" })}&refresh_token=r&type=recovery`
    );
    assert.equal(res.rejected, true);
    assert.equal(setSessionMock.mock.callCount(), 0);
    assert.equal(sessionStorage.getItem("reveal-pending-password-reset"), null);
    assert.equal(localStorage.getItem("reveal-pending-password-reset"), null);
  });

  it("refuse code et token_hash sur l'appli", async () => {
    markNativeRecoveryPending({ email: "moi@ex.fr" });
    const a = await handleAuthRedirectUrl(`${CALLBACK}?code=abc&type=recovery`);
    const b = await handleAuthRedirectUrl(`${CALLBACK}?token_hash=abc&type=recovery`);
    assert.equal(a.rejected, true);
    assert.equal(b.rejected, true);
    assert.equal(exchangeMock.mock.callCount(), 0);
    assert.equal(verifyOtpMock.mock.callCount(), 0);
  });

  it("refuse un lien sur une autre adresse du schéma", async () => {
    markNativeRecoveryPending({ email: "moi@ex.fr" });
    const res = await handleAuthRedirectUrl(
      `com.reveal.partygames://x#access_token=${jwt({ email: "moi@ex.fr" })}&refresh_token=r&type=recovery`
    );
    assert.equal(res.rejected, true);
    assert.equal(setSessionMock.mock.callCount(), 0);
  });

  it("accepte la réinitialisation demandée ici, puis oublie la demande", async () => {
    markNativeRecoveryPending({ email: "moi@ex.fr" });
    const res = await handleAuthRedirectUrl(
      `${CALLBACK}#access_token=${jwt({ email: "moi@ex.fr" })}&refresh_token=r&type=recovery`
    );
    assert.equal(res.handled, true);
    assert.equal(res.recovery, true);
    assert.equal(setSessionMock.mock.callCount(), 1);
    assert.equal(localStorage.getItem(NATIVE_AUTH_PENDING_KEY), null);
    assert.equal(readNativeAuthPending(), null);
  });
});

describe("audit liens n°2 — lien périmé ou refusé", () => {
  let handleAuthRedirectUrl;
  let routeAfterAuthRedirect;

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    setSessionMock.mock.resetCalls();
    ({ handleAuthRedirectUrl } = await import("../js/core/supabaseAuth.js"));
    ({ routeAfterAuthRedirect } = await import("../js/core/deepLinks.js"));
  });

  it("lien d'erreur (périmé) : pas de session, pas d'écran mot de passe", async () => {
    const res = await handleAuthRedirectUrl(
      `${CALLBACK}#error=access_denied&error_code=otp_expired&error_description=expired&type=recovery`
    );
    assert.equal(res.handled, true);
    assert.equal(res.sessionApplied, false);
    assert.equal(res.linkError, true);
    assert.equal(sessionStorage.getItem("reveal-pending-password-reset"), null);
  });

  it("jetons acceptés mais refusés par Supabase : pas d'écran mot de passe", async () => {
    markNativeRecoveryPending({ email: "moi@ex.fr" });
    setSessionMock.mock.mockImplementationOnce(async () => ({
      data: { session: null },
      error: { message: "expired" },
    }));
    const res = await handleAuthRedirectUrl(
      `${CALLBACK}#access_token=${jwt({ email: "moi@ex.fr" })}&refresh_token=r&type=recovery`
    );
    assert.equal(res.sessionApplied, false);
    assert.equal(res.recovery, false);
    assert.equal(sessionStorage.getItem("reveal-pending-password-reset"), null);
  });

  it("sans session ouverte : on reste sur l'écran courant et on prévient", () => {
    const nav = mock.fn();
    const alert = mock.fn();
    const out = routeAfterAuthRedirect(
      { handled: true, recovery: true, sessionApplied: false, linkError: true },
      { navigateTo: nav, alert }
    );
    assert.equal(out, "stay");
    assert.equal(nav.mock.callCount(), 0);
    assert.equal(alert.mock.callCount(), 1);
  });

  it("lien refusé ou sans rapport : rien ne bouge, aucun message", () => {
    const nav = mock.fn();
    const alert = mock.fn();
    assert.equal(routeAfterAuthRedirect({ handled: false, rejected: true }, { navigateTo: nav, alert }), "ignored");
    assert.equal(nav.mock.callCount(), 0);
    assert.equal(alert.mock.callCount(), 0);
  });

  it("réinitialisation ouverte : écran nouveau mot de passe", () => {
    const nav = mock.fn();
    const out = routeAfterAuthRedirect(
      { handled: true, recovery: true, sessionApplied: true },
      { navigateTo: nav, alert: () => {} }
    );
    assert.equal(out, "reset-password");
    assert.equal(nav.mock.calls[0].arguments[0], "reset-password");
  });
});
