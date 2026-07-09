import type { AppKey } from "@/lib/shared/types";

export type FirebaseCredentials = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export type FirestoreMapping = {
  users: {
    collection: string | null;
    createdAtField: string;
    sandboxField: string | null;
    sandboxValue: string | boolean | null;
    onboardedField: string | null;
    onboardedValue: string | boolean;
    totalEpisodesCompletedField: string | null;
  };
  activity: {
    collection: string;
    userField: string;
    timestampField: string;
    timestampType: "timestamp" | "pacific-string";
  };
  entitlements: {
    collection: string;
    statusField: string;
    productField: string;
    originalPurchaseDateField: string;
    expiryDateField: string;
    activeValue: string | boolean;
    monthlyProductIds: string[];
    annualProductIds: string[];
  };
  purchases: {
    collection: string;
    timestampField: string;
    timestampType: "timestamp" | "pacific-string";
    amountField: string;
    productField: string;
    productTypeField: string;
    consumableValue: string;
  };
};

export type ProductSalesConfig = {
  key: string;
  label: string;
  productIds: string[];
  unitPriceUsd: number | null;
  purchaseKind: string | null;
};

export type AppConfig = {
  key: AppKey;
  envPrefix: string;
  displayName: string;
  appleAppId: string;
  admobAppId: string | null;
  adsStartDate: string | null;
  downloadsSource: "app-store" | "firestore-users";
  monthlyPriceUsd: number | null;
  annualPriceUsd: number | null;
  // Optional per-product overrides ("id:price,id:price"). Takes precedence over
  // the term prices above — needed when grandfathered products renew at old prices.
  productPricesUsd: Record<string, number>;
  ga4PropertyId: string | null;
  // Meta ad account for this app's campaigns (format "act_<id>").
  metaAdAccountId: string | null;
  firebase: FirebaseCredentials | null;
  // Where the `feedback` collection lives, when not in the main Firebase project
  // (e.g. Puzzle Canvas feedback ships staging-first). Same service account, so the
  // SA needs datastore + storage read access granted on the override project.
  feedbackFirebase: FirebaseCredentials | null;
  mapping: FirestoreMapping;
  productSales: ProductSalesConfig[];
};

export type DashboardConfig = {
  authSecret: string;
  allowedPhoneNumbers: string[];
  refreshIntervalMs: number;
  timezone: string;
  dashboardFirebase: FirebaseCredentials | null;
  appStore: {
    keyId: string | null;
    issuerId: string | null;
    privateKey: string | null;
    vendorNumber: string | null;
  };
  admob: {
    clientId: string | null;
    clientSecret: string | null;
    refreshToken: string | null;
    publisherAccount: string | null;
  };
  metaAds: {
    // System-user token preferred (never expires); falls back to a user token.
    accessToken: string | null;
    appSecret: string | null;
  };
  apps: AppConfig[];
};

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function readEnv(name: string): string | null {
  let value = process.env[name]?.trim();
  if (value && value.length >= 2) {
    const quote = value[0];
    if ((quote === `"` || quote === `'`) && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
  }
  return value ? value : null;
}

function readPrivateKey(name: string): string | null {
  return readEnv(name)?.replace(/\\\\n/g, "\\n").replace(/\\n/g, "\n") ?? null;
}

function readCsv(name: string): string[] {
  return (readEnv(name) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readProductPrices(name: string): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const pair of readCsv(name)) {
    const index = pair.lastIndexOf(":");
    if (index <= 0) continue;
    const productId = pair.slice(0, index).trim();
    const price = Number(pair.slice(index + 1).trim());
    if (productId && Number.isFinite(price)) prices[productId] = price;
  }
  return prices;
}

function readBooleanish(name: string, fallback: string | boolean): string | boolean {
  const value = readEnv(name);
  if (value === null) return fallback;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return value;
}

function readOptionalBooleanish(name: string): string | boolean | null {
  const value = readEnv(name);
  if (value === null) return null;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return value;
}

function readTimestampType(name: string): "timestamp" | "pacific-string" {
  return readEnv(name) === "pacific-string" ? "pacific-string" : "timestamp";
}

function readNumber(name: string): number | null {
  const value = readEnv(name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readFirebase(prefix: string): FirebaseCredentials | null {
  const projectId = readEnv(`${prefix}_FIREBASE_PROJECT_ID`);
  const clientEmail = readEnv(`${prefix}_FIREBASE_CLIENT_EMAIL`);
  const privateKey = readPrivateKey(`${prefix}_FIREBASE_PRIVATE_KEY`);

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return { projectId, clientEmail, privateKey };
}

function productSales(prefix: string, key: AppKey): ProductSalesConfig[] {
  if (key === "puzzle-canvas") {
    return [
      {
        key: "goldPack",
        label: "Gold Pack sales",
        productIds: readCsv(`${prefix}_GOLD_PACK_PRODUCT_IDS`),
        unitPriceUsd: readNumber(`${prefix}_GOLD_PACK_PRICE_USD`),
        purchaseKind: readEnv(`${prefix}_GOLD_PACK_KIND`)
      },
      {
        key: "newCanvas",
        label: "New Canvas sales",
        productIds: readCsv(`${prefix}_NEW_CANVAS_PRODUCT_IDS`),
        unitPriceUsd: readNumber(`${prefix}_NEW_CANVAS_PRICE_USD`),
        purchaseKind: readEnv(`${prefix}_NEW_CANVAS_KIND`)
      }
    ];
  }

  if (key === "savory-advisor") {
    return [
      {
        key: "assistRefillMembers",
        label: "Assist Refill for Members sales",
        productIds: readCsv(`${prefix}_ASSIST_REFILL_MEMBER_PRODUCT_IDS`),
        unitPriceUsd: readNumber(`${prefix}_ASSIST_REFILL_MEMBER_PRICE_USD`),
        purchaseKind: readEnv(`${prefix}_ASSIST_REFILL_MEMBER_KIND`)
      },
      {
        key: "assistRefillNonMembers",
        label: "Assist Refill for Non-Members sales",
        productIds: readCsv(`${prefix}_ASSIST_REFILL_NON_MEMBER_PRODUCT_IDS`),
        unitPriceUsd: readNumber(`${prefix}_ASSIST_REFILL_NON_MEMBER_PRICE_USD`),
        purchaseKind: readEnv(`${prefix}_ASSIST_REFILL_NON_MEMBER_KIND`)
      }
    ];
  }

  return [];
}

function app(prefix: string, key: AppKey, displayName: string): AppConfig {
  const firebase = readFirebase(prefix);
  const feedbackProjectId = readEnv(`${prefix}_FEEDBACK_FIREBASE_PROJECT_ID`);
  const downloadsSource = readEnv(`${prefix}_DOWNLOADS_SOURCE`);
  const defaultDownloadsSource =
    key === "puzzle-canvas" || key === "receipt-cam" || key === "savory-advisor" ? "firestore-users" : "app-store";

  return {
    key,
    envPrefix: prefix,
    displayName,
    appleAppId: readEnv(`${prefix}_APPLE_APP_ID`) ?? "",
    admobAppId: readEnv(`${prefix}_ADMOB_APP_ID`),
    adsStartDate: readEnv(`${prefix}_ADS_START_DATE`),
    downloadsSource: downloadsSource === "app-store" || downloadsSource === "firestore-users" ? downloadsSource : defaultDownloadsSource,
    monthlyPriceUsd: readNumber(`${prefix}_MONTHLY_PRICE_USD`),
    annualPriceUsd: readNumber(`${prefix}_ANNUAL_PRICE_USD`),
    productPricesUsd: readProductPrices(`${prefix}_PRODUCT_PRICES_USD`),
    ga4PropertyId: readEnv(`${prefix}_GA4_PROPERTY_ID`),
    metaAdAccountId: readEnv(`${prefix}_META_AD_ACCOUNT_ID`),
    firebase,
    feedbackFirebase: feedbackProjectId && firebase ? { ...firebase, projectId: feedbackProjectId } : null,
    mapping: {
      users: {
        collection: readEnv(`${prefix}_USERS_COLLECTION`),
        createdAtField: readEnv(`${prefix}_USER_CREATED_AT_FIELD`) ?? "createdAt",
        sandboxField: readEnv(`${prefix}_USER_SANDBOX_FIELD`),
        sandboxValue: readOptionalBooleanish(`${prefix}_USER_SANDBOX_VALUE`),
        onboardedField: readEnv(`${prefix}_USER_ONBOARDED_FIELD`) ?? (key === "puzzle-canvas" ? "tutorialPassed" : null),
        onboardedValue: readBooleanish(`${prefix}_USER_ONBOARDED_VALUE`, true),
        totalEpisodesCompletedField:
          readEnv(`${prefix}_USER_TOTAL_EPISODES_COMPLETED_FIELD`) ?? (key === "puzzle-canvas" ? "totalEpisodesCompleted" : null)
      },
      activity: {
        collection: readEnv(`${prefix}_ACTIVITY_COLLECTION`) ?? "userActivity",
        userField: readEnv(`${prefix}_ACTIVITY_USER_FIELD`) ?? "userId",
        timestampField: readEnv(`${prefix}_ACTIVITY_TIMESTAMP_FIELD`) ?? "lastActiveAt",
        timestampType: readTimestampType(`${prefix}_ACTIVITY_TIMESTAMP_TYPE`)
      },
      entitlements: {
        collection: readEnv(`${prefix}_ENTITLEMENTS_COLLECTION`) ?? "entitlements",
        statusField: readEnv(`${prefix}_ENTITLEMENT_STATUS_FIELD`) ?? "status",
        productField: readEnv(`${prefix}_ENTITLEMENT_PRODUCT_FIELD`) ?? "productId",
        originalPurchaseDateField: readEnv(`${prefix}_ENTITLEMENT_ORIGINAL_PURCHASE_DATE_FIELD`) ?? "subscriptionDetails.originalPurchaseDate",
        expiryDateField: readEnv(`${prefix}_ENTITLEMENT_EXPIRY_DATE_FIELD`) ?? "subscriptionDetails.expiryDate",
        activeValue: readBooleanish(`${prefix}_ENTITLEMENT_ACTIVE_VALUE`, "active"),
        monthlyProductIds: readCsv(`${prefix}_MONTHLY_PRODUCT_IDS`),
        annualProductIds: readCsv(`${prefix}_ANNUAL_PRODUCT_IDS`)
      },
      purchases: {
        collection: readEnv(`${prefix}_PURCHASES_COLLECTION`) ?? "purchases",
        timestampField: readEnv(`${prefix}_PURCHASE_TIMESTAMP_FIELD`) ?? "purchasedAt",
        timestampType: readTimestampType(`${prefix}_PURCHASE_TIMESTAMP_TYPE`),
        amountField: readEnv(`${prefix}_PURCHASE_AMOUNT_FIELD`) ?? "priceUsd",
        productField: readEnv(`${prefix}_PURCHASE_PRODUCT_FIELD`) ?? "productId",
        productTypeField: readEnv(`${prefix}_PURCHASE_PRODUCT_TYPE_FIELD`) ?? "productType",
        consumableValue: readEnv(`${prefix}_PURCHASE_CONSUMABLE_VALUE`) ?? "consumable"
      }
    },
    productSales: productSales(prefix, key)
  };
}

export function getDashboardConfig(): DashboardConfig {
  return {
    authSecret: readEnv("AUTH_SECRET") ?? "local-development-secret",
    allowedPhoneNumbers: readCsv("DASHBOARD_ALLOWED_PHONE_NUMBERS"),
    refreshIntervalMs: TWELVE_HOURS_MS,
    timezone: DEFAULT_TIMEZONE,
    dashboardFirebase: readFirebase("DASHBOARD"),
    appStore: {
      keyId: readEnv("APP_STORE_CONNECT_KEY_ID"),
      issuerId: readEnv("APP_STORE_CONNECT_ISSUER_ID"),
      privateKey: readPrivateKey("APP_STORE_CONNECT_PRIVATE_KEY"),
      vendorNumber: readEnv("APP_STORE_CONNECT_VENDOR_NUMBER")
    },
    admob: {
      clientId: readEnv("GOOGLE_ADMOB_CLIENT_ID"),
      clientSecret: readEnv("GOOGLE_ADMOB_CLIENT_SECRET"),
      refreshToken: readEnv("GOOGLE_ADMOB_REFRESH_TOKEN"),
      publisherAccount: readEnv("GOOGLE_ADMOB_PUBLISHER_ACCOUNT")
    },
    metaAds: {
      accessToken: readEnv("META_SYSTEM_USER_TOKEN") ?? readEnv("META_ACCESS_TOKEN"),
      appSecret: readEnv("META_APP_SECRET")
    },
    apps: [
      app("PUZZLE_CANVAS", "puzzle-canvas", "Puzzle Canvas"),
      app("SAVORY_ADVISOR", "savory-advisor", "Savory Advisor"),
      app("RECEIPT_CAM", "receipt-cam", "Receipt Cam")
    ]
  };
}
