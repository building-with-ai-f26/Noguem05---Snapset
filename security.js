// SnapSet's protections: rate limits, the cross-site check and security headers.
// Built-in Node modules only. The limits live in memory, which is enough for one
// server; they start over when the server restarts.

const crypto = require("crypto");
const net = require("net");

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const LIMITS = {
  photosPerMinute: 10, // per visitor IP
  writesPerMinute: 20, // per visitor IP
  photosPerDay: 300, // whole app, so many IPs together still can't run up the AI bill
};

// Returns a function: hit(key) -> 0 if allowed, or the seconds to wait if over the limit.
function createLimiter(max, windowMs, now = Date.now) {
  const visitors = new Map();
  let nextCleanup = 0;
  return function hit(key) {
    const time = now();
    if (time >= nextCleanup) {
      for (const [k, v] of visitors) if (time >= v.resetAt) visitors.delete(k);
      nextCleanup = time + windowMs;
    }
    let visitor = visitors.get(key);
    if (!visitor || time >= visitor.resetAt) {
      visitor = { count: 0, resetAt: time + windowMs };
      visitors.set(key, visitor);
    }
    visitor.count++;
    return visitor.count > max ? Math.ceil((visitor.resetAt - time) / 1000) : 0;
  };
}

// One key per visitor. An IPv6 home or phone gets billions of addresses that share
// their first 4 groups, so those 4 groups count as one visitor.
function limitKey(ip) {
  const address = ip.replace(/^::ffff:(?=\d+\.)/i, "");
  if (!net.isIPv6(address)) return address;
  const [start, end] = address.split("::");
  const groups = start ? start.split(":") : [];
  if (end !== undefined) {
    const tail = end ? end.split(":") : [];
    while (groups.length + tail.length < 8) groups.push("0");
    groups.push(...tail);
  }
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":");
}

// X-Forwarded-For can be typed in by the visitor, so it is never used. On Render every
// request comes through Cloudflare, which sets CF-Connecting-IP itself. Anywhere else
// that header is ignored too.
function clientIp(req) {
  const fromProxy = process.env.RENDER === "true" ? req.headers["cf-connecting-ip"] : "";
  return fromProxy && net.isIP(fromProxy) ? fromProxy : req.socket.remoteAddress || "unknown";
}

// Browsers say where a request came from. Another site may not use a visitor's browser to write.
function isCrossSite(req) {
  const site = req.headers["sec-fetch-site"];
  return site === "cross-site" || site === "same-site";
}

// Only the <script> blocks written in our own page may run, identified by their hash.
// Browsers hash with plain \n line endings, so Windows \r\n is converted first.
function buildHeaders(html) {
  const hashes = [...html.replace(/\r\n/g, "\n").matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    ([, code]) => `'sha256-${crypto.createHash("sha256").update(code).digest("base64")}'`
  );
  const posthog = "https://*.i.posthog.com";
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src 'self' ${hashes.join(" ")} ${posthog}`,
      `connect-src 'self' ${posthog}`,
      "style-src 'self' 'unsafe-inline'", // the page's CSS is inline
      "img-src 'self' blob: data:", // photo preview
      "worker-src 'self' blob:", // PostHog session replay compresses in a worker
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000",
  };
}

module.exports = { LIMITS, MINUTE, DAY, createLimiter, limitKey, clientIp, isCrossSite, buildHeaders };
