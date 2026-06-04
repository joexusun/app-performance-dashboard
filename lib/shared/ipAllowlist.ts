// Pure, edge-runtime-safe helpers for restricting access to a set of IPs/CIDRs
// (e.g. your home network). No Node-only APIs so it can be used from middleware.

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeIp(ip: string): string {
  let value = ip.trim();
  // Strip surrounding brackets from IPv6 literals: [::1] -> ::1
  if (value.startsWith("[") && value.includes("]")) {
    value = value.slice(1, value.indexOf("]"));
  }
  // IPv4-mapped IPv6: ::ffff:203.0.113.5 -> 203.0.113.5
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];
  return value.toLowerCase();
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) + octet;
  }
  return result >>> 0;
}

function matchesEntry(ip: string, entry: string): boolean {
  const normalizedIp = normalizeIp(ip);
  const normalizedEntry = normalizeIp(entry.split("/")[0]);

  if (!entry.includes("/")) {
    return normalizedIp === normalizedEntry;
  }

  // CIDR (IPv4 only; IPv6 ranges fall back to exact match above).
  const prefix = Number(entry.split("/")[1]);
  const ipInt = ipv4ToInt(normalizedIp);
  const baseInt = ipv4ToInt(normalizedEntry);
  if (ipInt === null || baseInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function isIpAllowed(ip: string | null | undefined, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true; // No allowlist configured -> do not restrict.
  if (!ip) return false;
  return allowlist.some((entry) => matchesEntry(ip, entry));
}

// Resolve the real client IP behind Azure App Service / proxies.
export function extractClientIp(headers: Headers): string | null {
  const azure = headers.get("x-azure-clientip");
  if (azure) return azure.split(",")[0].trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    // x-forwarded-for may include a port (ip:port); strip it for IPv4.
    if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(first)) return first.split(":")[0];
    return first;
  }

  return headers.get("x-real-ip") || headers.get("x-client-ip");
}
