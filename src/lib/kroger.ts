// Server-only client for the Kroger public Products API (free developer tier,
// https://developer.kroger.com). Used by the shopping list to suggest real
// store products as you type. Credentials live in env vars and never reach
// the browser; without them every search just returns [].

const TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token";
const API_BASE = "https://api.kroger.com/v1";

export type KrogerProduct = {
  name: string;
  brand: string | null;
  size: string | null;
  // Price at the store in KROGER_LOCATION_ID (promo price if on sale).
  // Null when no store is configured or the store doesn't carry it.
  price: number | null;
};

type KrogerApiProduct = {
  description?: string;
  brand?: string;
  items?: { size?: string; price?: { regular?: number; promo?: number } }[];
};

function credentials() {
  const id = process.env.KROGER_CLIENT_ID;
  const secret = process.env.KROGER_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

export function krogerConfigured(): boolean {
  return credentials() !== null;
}

// client_credentials tokens last ~30 min; cache per server instance and
// refresh 60s early.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  const creds = credentials();
  if (!creds) return null;
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${creds.id}:${creds.secret}`
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=product.compact",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// Search the Kroger catalog. Store-specific prices come from the store set
// in KROGER_LOCATION_ID; without it the search still works, just priceless.
export async function searchKrogerCatalog(
  term: string
): Promise<KrogerProduct[]> {
  const token = await getToken();
  if (!token) return [];

  const params = new URLSearchParams({
    "filter.term": term,
    "filter.limit": "8",
  });
  const locationId = process.env.KROGER_LOCATION_ID;
  if (locationId) params.set("filter.locationId", locationId);

  const res = await fetch(`${API_BASE}/products?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: KrogerApiProduct[] };

  return (data.data ?? [])
    .filter((p) => p.description)
    .map((p) => {
      const item = p.items?.[0];
      return {
        name: p.description as string,
        brand: p.brand || null,
        size: item?.size || null,
        price: item?.price?.promo || item?.price?.regular || null,
      };
    });
}
