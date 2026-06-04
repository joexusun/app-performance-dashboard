import { createSign } from "crypto";
import { gunzipSync } from "zlib";
import type { DashboardConfig, AppConfig } from "@/lib/server/config";
import { appleReportDate } from "@/lib/server/dateWindows";

type AppStoreConfig = DashboardConfig["appStore"];

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function derToJose(signature: Buffer): Buffer {
  let offset = 0;
  if (signature[offset++] !== 0x30) throw new Error("Invalid ECDSA signature.");
  const sequenceLength = signature[offset++];
  if (sequenceLength + offset !== signature.length) throw new Error("Invalid ECDSA signature length.");

  function readInteger(): Buffer {
    if (signature[offset++] !== 0x02) throw new Error("Invalid ECDSA integer.");
    const length = signature[offset++];
    const value = signature.subarray(offset, offset + length);
    offset += length;
    const trimmed = value[0] === 0 ? value.subarray(1) : value;
    if (trimmed.length > 32) return trimmed.subarray(trimmed.length - 32);
    return Buffer.concat([Buffer.alloc(32 - trimmed.length), trimmed]);
  }

  return Buffer.concat([readInteger(), readInteger()]);
}

export function createAppStoreJwt(config: AppStoreConfig, now = Math.floor(Date.now() / 1000)): string | null {
  if (!config.keyId || !config.issuerId || !config.privateKey) return null;

  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: config.issuerId,
      iat: now,
      exp: now + 20 * 60,
      aud: "appstoreconnect-v1"
    })
  );
  const signingInput = `${header}.${payload}`;
  const derSignature = createSign("SHA256").update(signingInput).sign(config.privateKey);
  return `${signingInput}.${derToJose(derSignature).toString("base64url")}`;
}

export function parseSalesReportTsv(text: string, appleAppId: string): number {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return 0;

  const headers = lines[0].split("\t");
  const index = (name: string) => headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
  const unitsIndex = index("Units");
  const appleIdIndex = index("Apple Identifier");
  const productTypeIndex = index("Product Type Identifier");

  if (unitsIndex === -1 || appleIdIndex === -1 || productTypeIndex === -1) return 0;

  return lines.slice(1).reduce((total, line) => {
    const cells = line.split("\t");
    const matchesApp = String(cells[appleIdIndex] ?? "") === appleAppId;
    const productType = String(cells[productTypeIndex] ?? "");
    const isFirstDownload = productType === "1" || productType === "1F";
    const units = Number(cells[unitsIndex] ?? 0);

    return matchesApp && isFirstDownload && Number.isFinite(units) ? total + units : total;
  }, 0);
}

export async function fetchFirstTimeDownloads(config: DashboardConfig, app: AppConfig, date = new Date()): Promise<number> {
  const token = createAppStoreJwt(config.appStore);
  if (!token || !config.appStore.vendorNumber) {
    throw new Error("App Store Connect credentials or vendor number are missing.");
  }
  if (!app.appleAppId) {
    throw new Error(`${app.displayName} is missing its Apple app ID.`);
  }

  const params = new URLSearchParams({
    "filter[frequency]": "DAILY",
    "filter[reportDate]": appleReportDate(date),
    "filter[reportSubType]": "SUMMARY",
    "filter[reportType]": "SALES",
    "filter[vendorNumber]": config.appStore.vendorNumber
  });

  const response = await fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/a-gzip"
    }
  });

  if (!response.ok) {
    throw new Error(`App Store Connect returned ${response.status} for ${app.displayName}.`);
  }

  const compressed = Buffer.from(await response.arrayBuffer());
  return parseSalesReportTsv(gunzipSync(compressed).toString("utf8"), app.appleAppId);
}
