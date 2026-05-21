// Vercel Serverless Function — Teamwork proxy.
//
// Same job as the old Cloudflare Worker. Browsers can't call the
// Teamwork API directly (CORS), so the browser calls this endpoint
// at /api/proxy and we forward the request to Teamwork with the user's
// API key, then return the response with CORS headers added.
//
// This function does NOT store, log, or persist anything. The user's
// API key arrives in the x-tw-key header on each request and leaves
// the function as soon as the response is returned.

export const config = {
  runtime: "edge",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-tw-site, x-tw-key",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Extract Teamwork config from headers
  const twSite = req.headers.get("x-tw-site");
  const twKey = req.headers.get("x-tw-key");
  if (!twSite || !twKey) {
    return json({ error: "Missing x-tw-site or x-tw-key headers" }, 400);
  }

  // Extract target path from query string
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path || !path.startsWith("/")) {
    return json({ error: "Missing or invalid 'path' query param (must start with /)" }, 400);
  }

  // Build target URL — copy all query params except `path` itself
  url.searchParams.delete("path");
  const qs = url.searchParams.toString();
  const cleanSite = twSite.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const targetUrl = `https://${cleanSite}${path}${qs ? "?" + qs : ""}`;

  // Auth: Teamwork uses Basic with API key as username, "x" as password
  const auth = "Basic " + btoa(`${twKey}:x`);

  // Forward request
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await req.text();
  let resp: Response;
  try {
    resp = await fetch(targetUrl, {
      method: req.method,
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    });
  } catch (e) {
    return json({ error: `Upstream fetch failed: ${(e as Error).message}` }, 502);
  }

  const respBody = await resp.text();
  return new Response(respBody, {
    status: resp.status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": resp.headers.get("Content-Type") || "application/json",
    },
  });
}
