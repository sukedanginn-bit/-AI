const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const base64Url = (value) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

const pemToBytes = (pem) => {
  const body = String(pem).replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  if (!body) throw new Error("GOOGLE_PRIVATE_KEY が空です");
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export async function createServiceAccountJwt({ email, privateKey, now = () => Date.now() }) {
  if (!String(email || "").trim()) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL がありません");
  const issuedAt = Math.floor(now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToBytes(privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(signature)}`;
}

export function createGoogleTokenProvider({ email, privateKey, fetchImpl = fetch, now = () => Date.now() }) {
  let cached = null;
  return async ({ forceRefresh = false } = {}) => {
    if (!forceRefresh && cached && cached.expiresAt - 60_000 > now()) return cached.accessToken;
    const assertion = await createServiceAccountJwt({ email, privateKey, now });
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion,
      }),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!response.ok || !data?.access_token) {
      throw new Error(`Google OAuth token error (${response.status}): ${text.slice(0, 300)}`);
    }
    cached = {
      accessToken: data.access_token,
      expiresAt: now() + Math.max(0, Number(data.expires_in || 3600)) * 1000,
    };
    return cached.accessToken;
  };
}

export { SCOPE, TOKEN_URL };
