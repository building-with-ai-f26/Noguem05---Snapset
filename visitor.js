// Who a log belongs to, without sign-in. Each browser gets a random code in a cookie.
// Typing that code on another device opens the same log, so the code works like a
// password: it never goes in a URL or a log line, and the database only stores its hash.

const crypto = require("crypto");

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 characters, no I, L, O or U
const LENGTH = 20; // 100 random bits: not guessable
const VALID = new RegExp(`^[${ALPHABET}]{${LENGTH}}$`);
const MAX_AGE = 400 * 24 * 60 * 60; // the longest browsers allow

const newCode = () => [...crypto.randomBytes(LENGTH)].map((byte) => ALPHABET[byte % 32]).join("");

// Forgives lower case, spaces, dashes, O for 0 and I or L for 1. null if it isn't a code.
function parseCode(typed) {
  if (typeof typed !== "string" || typed.length > 100) return null;
  const code = typed.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return VALID.test(code) ? code : null;
}

const formatCode = (code) => code.match(/.{4}/g).join("-");
const hashCode = (code) => crypto.createHash("sha256").update(code).digest("hex");

// The __Host- prefix stops any other site from setting this cookie. It needs HTTPS, so Render only.
const onRender = () => process.env.RENDER === "true";
const cookieName = () => (onRender() ? "__Host-snapset_log" : "snapset_log");

function readCode(req) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === cookieName()) return parseCode(value);
  }
  return null;
}

// HttpOnly: scripts on the page (including analytics) can't read it
function saveCode(res, code) {
  const secure = onRender() ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${cookieName()}=${code}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secure}`);
}

module.exports = { newCode, parseCode, formatCode, hashCode, readCode, saveCode };
