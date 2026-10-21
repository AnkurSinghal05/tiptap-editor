// Vercel Function: forwards the editor's /kb-api/* calls to the Knowledge Base
// API and adds the server's token, so the token never reaches the browser
// (and the browser only talks to its own origin, so CORS doesn't apply).
// vercel.json rewrites /kb-api/:path* here, with the path as ?path=.
//
// Server environment (Vercel project settings):
//   KB_API_TOKEN (Secret)  session token, sent as "Authorization: Bearer …"
//   KB_API_BASE_URL or VITE_KB_API_BASE_URL (Config, optional)  defaults to staging
//   KB_API_PROJECT_CODES (Config, optional)  Project-Code values allowed through,
//     comma-separated; defaults to THRIWE_APP
//
// Anyone who can open the deployment can use this token through it, so the
// deployment must be behind Vercel Authentication (All Deployments).

declare const process: { env: Record<string, string | undefined> };

const DEFAULT_BASE_URL = "https://stag-pgm-mgmt-api.thriwe.com/api/v1";
const METHODS = new Set(["GET", "POST", "PATCH"]);
// Only these request headers are passed on; cookies, Origin and the caller's
// own Authorization never are.
const FORWARDED_HEADERS = ["project-code", "content-type", "accept"];
const TIMEOUT_MS = 25_000;
// Tells the editor which API URL a call was forwarded to (shown in its API
// log). Absent when the call wasn't forwarded.
const UPSTREAM_HEADER = "x-kb-upstream-url";

// Same envelope as the API's errors, so the editor shows the message.
const fail = (code: number, message: string, upstream?: string) =>
  Response.json(
    { message, code },
    { status: code, headers: { "cache-control": "no-store", ...(upstream && { [UPSTREAM_HEADER]: upstream }) } },
  );

export default {
  async fetch(request: Request): Promise<Response> {
    if (!METHODS.has(request.method)) return fail(405, `${request.method} isn't forwarded.`);

    const url = new URL(request.url);
    const segments = (url.searchParams.get("path") ?? "").split("/");
    if (segments[0] !== "knowledge-base" || segments.some((s) => s === "" || s === "." || s === "..")) {
      return fail(404, "Only Knowledge Base endpoints are forwarded.");
    }

    const allowedCodes = (process.env.KB_API_PROJECT_CODES ?? "THRIWE_APP").split(",").map((c) => c.trim());
    const projectCode = request.headers.get("project-code");
    if (projectCode && !allowedCodes.includes(projectCode)) {
      return fail(403, `Project-Code ${projectCode} isn't allowed through this deployment.`);
    }

    const token = process.env.KB_API_TOKEN?.trim().replace(/^Bearer\s+/i, "");
    if (!token) return fail(500, "KB_API_TOKEN isn't set for this deployment.");

    url.searchParams.delete("path");
    const base = (process.env.KB_API_BASE_URL || process.env.VITE_KB_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
    const target = `${base}/${segments.map(encodeURIComponent).join("/")}${url.search}`;

    const headers = new Headers({ authorization: `Bearer ${token}` });
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers,
        body: request.method === "GET" ? undefined : await request.arrayBuffer(),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return fail(502, "Couldn't reach the Knowledge Base API.", target);
    }

    // fetch has already decoded the body, so content-encoding and
    // content-length aren't passed back (nor any set-cookie).
    const out = new Headers({ "cache-control": "no-store", [UPSTREAM_HEADER]: target });
    const type = upstream.headers.get("content-type");
    if (type) out.set("content-type", type);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
