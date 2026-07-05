"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { LogOut, RefreshCw, Shield } from "lucide-react";
import type { ConfirmationResult } from "firebase/auth";
import ReceiptMessages from "@/app/components/ReceiptMessages";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { AppKey, AppMetrics, DailyMetricPoint, MetricsResponse, MetricWindow } from "@/lib/shared/types";

const windows: Array<{ key: MetricWindow; label: string }> = [
  { key: "today", label: "Today" },
  { key: "sevenDays", label: "7 days" },
  { key: "thirtyDays", label: "30 days" }
];

const dashboardBasePath = (() => {
  const value = process.env.NEXT_PUBLIC_DASHBOARD_BASE_PATH?.trim();
  if (!value || value === "/") return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
})();

function apiPath(path: string): string {
  return `${dashboardBasePath}${path}`;
}

function numberValue(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

function currencyValue(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function dateValue(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<{ status: number; ok: boolean; data: T | null }> {
  if (typeof window.fetch === "function") {
    const response = await window.fetch(url, options);
    return {
      status: response.status,
      ok: response.ok,
      data: response.ok ? ((await response.json()) as T) : null
    };
  }

  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open(options.method ?? "GET", url);
    request.withCredentials = true;

    const headers = new Headers(options.headers);
    headers.forEach((value, key) => request.setRequestHeader(key, value));

    request.onload = () => {
      let data: T | null = null;
      if (request.status >= 200 && request.status < 300 && request.responseText) {
        data = JSON.parse(request.responseText) as T;
      }
      resolve({ status: request.status, ok: request.status >= 200 && request.status < 300, data });
    };
    request.onerror = () => resolve({ status: 0, ok: false, data: null });
    request.send(typeof options.body === "string" ? options.body : null);
  });
}

function loginErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code?: unknown }).code);
    if (code === "auth/argument-error" || code === "auth/invalid-phone-number") {
      return "This phone number is not allowlisted.";
    }
  }

  return error instanceof Error ? error.message : fallback;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? "status statusOk" : "status statusWarn"}>{label}</span>;
}

function subscriberCount(app: AppMetrics): number | null {
  const monthly = app.values.subscriptions.monthly;
  const annual = app.values.subscriptions.annual;

  if (monthly === null && annual === null) return null;
  return (monthly ?? 0) + (annual ?? 0);
}

function shortDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function ChartShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="chartPanel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

type ChartPoint = DailyMetricPoint & {
  dateLabel: string;
};

type TooltipPayload = {
  color?: string;
  dataKey?: string;
  name?: string;
  value?: number | string | null;
};

function chartData(points: DailyMetricPoint[]): ChartPoint[] {
  return points.map((point) => ({
    ...point,
    users: point.users ?? 0,
    subscribers: point.subscribers ?? 0,
    activeUsers: point.activeUsers ?? 0,
    onboardedUsers: point.onboardedUsers ?? null,
    iapSalesUsd: point.iapSalesUsd ?? 0,
    adsEarningsUsd: point.adsEarningsUsd ?? 0,
    dateLabel: shortDate(point.date)
  }));
}

function tooltipPayload(payload: unknown): TooltipPayload[] {
  return Array.isArray(payload) ? (payload as TooltipPayload[]) : [];
}

function ChartTooltip({ active, label, payload }: { active?: boolean; label?: string; payload?: unknown }) {
  if (!active) return null;

  return (
    <div className="chartTooltip">
      <strong>{label}</strong>
      {tooltipPayload(payload).map((entry) => (
        <div className="chartTooltipRow" key={String(entry.dataKey)}>
          <span style={{ color: entry.color }}>{entry.name}</span>
          <b>
            {String(entry.dataKey).toLowerCase().includes("usd")
              ? currencyValue(typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0))
              : numberValue(typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0))}
          </b>
        </div>
      ))}
    </div>
  );
}

function UsersSubscribersChart({ points }: { points: DailyMetricPoint[] }) {
  const data = chartData(points);

  return (
    <ChartShell title="Users and Subscribers">
      <div className="chartBox">
        <ResponsiveContainer height="100%" width="100%">
          <LineChart data={data} margin={{ bottom: 0, left: -24, right: 8, top: 8 }}>
            <CartesianGrid stroke="#d9ded9" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="dateLabel" interval="preserveStartEnd" minTickGap={24} tickLine={false} />
            <YAxis allowDecimals={false} tickLine={false} width={42} />
            <Tooltip content={<ChartTooltip />} />
            <Line dataKey="users" dot={false} name="Users" stroke="#2364d2" strokeWidth={2.4} type="monotone" />
            <Line dataKey="subscribers" dot={false} name="Subscribers" stroke="#1b8f4c" strokeWidth={2.4} type="monotone" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

function ActiveUsersChart({ points }: { points: DailyMetricPoint[] }) {
  const data = chartData(points);

  return (
    <ChartShell title="Active Users">
      <div className="chartBox">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={data} margin={{ bottom: 0, left: -24, right: 8, top: 8 }}>
            <CartesianGrid stroke="#d9ded9" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="dateLabel" interval="preserveStartEnd" minTickGap={24} tickLine={false} />
            <YAxis allowDecimals={false} tickLine={false} width={42} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="activeUsers" fill="#4f83d1" name="Active Users" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

function OnboardedUsersChart({ points }: { points: DailyMetricPoint[] }) {
  const data = chartData(points);

  return (
    <ChartShell title="Onboarded Users">
      <div className="chartBox">
        <ResponsiveContainer height="100%" width="100%">
          <LineChart data={data} margin={{ bottom: 0, left: -24, right: 8, top: 8 }}>
            <CartesianGrid stroke="#d9ded9" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="dateLabel" interval="preserveStartEnd" minTickGap={24} tickLine={false} />
            <YAxis allowDecimals={false} tickLine={false} width={42} />
            <Tooltip content={<ChartTooltip />} />
            <Line
              connectNulls={false}
              dataKey="onboardedUsers"
              dot={{ r: 2.5 }}
              name="Onboarded Users"
              stroke="#1b8f4c"
              strokeWidth={2.4}
              type="monotone"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

function IapSalesChart({ points }: { points: DailyMetricPoint[] }) {
  const data = chartData(points);

  return (
    <ChartShell title="IAP Sales">
      <div className="chartBox">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={data} margin={{ bottom: 0, left: -22, right: 8, top: 8 }}>
            <CartesianGrid stroke="#d9ded9" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="dateLabel" interval="preserveStartEnd" minTickGap={24} tickLine={false} />
            <YAxis tickFormatter={(value: number) => `$${value}`} tickLine={false} width={44} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="iapSalesUsd" fill="#d28a23" name="IAP Sales" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

function AdsEarningsChart({ points }: { points: DailyMetricPoint[] }) {
  const data = chartData(points);

  return (
    <ChartShell title="Ads Earnings">
      <div className="chartBox">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={data} margin={{ bottom: 0, left: -22, right: 8, top: 8 }}>
            <CartesianGrid stroke="#d9ded9" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="dateLabel" interval="preserveStartEnd" minTickGap={24} tickLine={false} />
            <YAxis tickFormatter={(value: number) => `$${value}`} tickLine={false} width={44} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="adsEarningsUsd" fill="#7a4fd0" name="Ads Earnings" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

function PuzzleCharts({ app }: { app: AppMetrics }) {
  const points = app.values.dailyMetrics ?? [];
  if (points.length === 0) return null;

  return (
    <div className="chartStack">
      <UsersSubscribersChart points={points} />
      <ActiveUsersChart points={points} />
      <OnboardedUsersChart points={points} />
      <AdsEarningsChart points={points} />
      <IapSalesChart points={points} />
    </div>
  );
}

function ReceiptCharts({ app }: { app: AppMetrics }) {
  const points = app.values.dailyMetrics ?? [];
  if (points.length === 0) return null;

  return (
    <div className="chartStack">
      <UsersSubscribersChart points={points} />
      <ActiveUsersChart points={points} />
      <IapSalesChart points={points} />
    </div>
  );
}

function SavoryCharts({ app }: { app: AppMetrics }) {
  const points = app.values.dailyMetrics ?? [];
  if (points.length === 0) return null;

  return (
    <div className="chartStack">
      <UsersSubscribersChart points={points} />
      <ActiveUsersChart points={points} />
      <IapSalesChart points={points} />
    </div>
  );
}

function AppPanel({ app }: { app: AppMetrics }) {
  const showsFirestoreUsers =
    app.appKey === "puzzle-canvas" || app.appKey === "receipt-cam" || app.appKey === "savory-advisor";
  const primaryLabel = showsFirestoreUsers ? "Users" : "Downloads";
  const primaryValue = showsFirestoreUsers ? app.values.users?.total ?? null : app.values.downloads.firstTime;
  const accumulatedSalesLabel = showsFirestoreUsers ? "Accumulated IAP Sales" : "Accumulated Sales";
  const showsSubscriptionTermSales = app.appKey === "receipt-cam" || app.appKey === "savory-advisor";
  const usesAppStore = !app.sourceStatuses.appStore.message.toLowerCase().includes("not used");
  const usesAds = app.sourceStatuses.ads?.ok || app.values.accumulatedAdsEarningsUsd?.total !== null;

  return (
    <article className="appPanel">
      <header className="appHeader">
        <div>
          <h2>{app.displayName}</h2>
          <p>Generated {dateValue(app.generatedAt)}</p>
        </div>
        <div className="statusRow">
          <StatusPill ok={app.sourceStatuses.firestore.ok} label="Firestore" />
          {usesAppStore ? <StatusPill ok={app.sourceStatuses.appStore.ok} label="App Store" /> : null}
          {usesAds ? <StatusPill ok={Boolean(app.sourceStatuses.ads?.ok)} label="AdMob" /> : null}
        </div>
      </header>

      <div className="metricTable">
        <div className="metricRow">
          <span>{primaryLabel}</span>
          <strong>{numberValue(primaryValue)}</strong>
        </div>
        <div className="metricRow">
          <span>Subscribers</span>
          <strong>{numberValue(subscriberCount(app))}</strong>
        </div>
        <div className="metricRow">
          <span>{accumulatedSalesLabel}</span>
          <strong>{currencyValue(app.values.accumulatedSalesUsd?.total ?? null)}</strong>
        </div>
        {app.appKey === "puzzle-canvas" ? (
          <div className="metricRow">
            <span>Accumulated Ads Earnings</span>
            <strong>{currencyValue(app.values.accumulatedAdsEarningsUsd?.total ?? null)}</strong>
          </div>
        ) : null}
      </div>

      {app.appKey === "puzzle-canvas" ? <PuzzleCharts app={app} /> : null}
      {app.appKey === "receipt-cam" ? <ReceiptCharts app={app} /> : null}
      {app.appKey === "receipt-cam" ? <ReceiptMessages /> : null}
      {app.appKey === "savory-advisor" ? <SavoryCharts app={app} /> : null}

      <div className="windowGrid">
        {windows.map((window) => (
          <div className="windowCard" key={window.key}>
            <span>{window.label}</span>
            <strong>{numberValue(app.values.activeUsers[window.key])}</strong>
            <small>active users</small>
            {app.appKey === "puzzle-canvas" ? (
              <>
                <div className="productSale">
                  <strong>{currencyValue(app.values.adsEarningsUsd?.[window.key] ?? null)}</strong>
                  <small>Ads Earnings</small>
                </div>
                <div className="productSale">
                  <strong>{currencyValue(app.values.adsEcpmUsd?.[window.key] ?? null)}</strong>
                  <small>eCPM</small>
                </div>
                <div className="productSale">
                  <strong>{currencyValue(app.values.subscriptionSalesUsd?.[window.key] ?? null)}</strong>
                  <small>Subscription sales</small>
                </div>
              </>
            ) : null}
            {showsSubscriptionTermSales ? (
              <>
                <div className="productSale">
                  <strong>{currencyValue(app.values.monthlySubscriptionSalesUsd?.[window.key] ?? null)}</strong>
                  <small>Monthly Subscription sales</small>
                </div>
                <div className="productSale">
                  <strong>{currencyValue(app.values.annualSubscriptionSalesUsd?.[window.key] ?? null)}</strong>
                  <small>Annual Subscription sales</small>
                </div>
              </>
            ) : null}
            {app.appKey === "savory-advisor"
              ? null
              : app.productSales.map((sale) => (
                  <div className="productSale" key={sale.key}>
                    <strong>{currencyValue(sale.values[window.key])}</strong>
                    <small>{sale.label}</small>
                  </div>
                ))}
          </div>
        ))}
      </div>
    </article>
  );
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { sendDashboardLoginCode } = await import("@/lib/client/firebaseAuth");
      const nextConfirmation = await sendDashboardLoginCode(phoneNumber, "recaptcha-container");
      setConfirmation(nextConfirmation);
    } catch (error) {
      setError(loginErrorMessage(error, "Could not send the login code."));
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmation) return;

    setLoading(true);
    setError("");

    try {
      const credential = await confirmation.confirm(code);
      const idToken = await credential.user.getIdToken();
      const response = await requestJson<{ ok: boolean; message?: string }>(apiPath("/api/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken })
      });

      if (!response.ok) {
        setError(response.data?.message ?? "That code did not work.");
        return;
      }
      onSuccess();
    } catch (error) {
      setError(error instanceof Error ? error.message : "That code did not work.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: React.FormEvent) {
    if (confirmation) {
      await verifyCode(event);
      return;
    }
    await sendCode(event);
  }

  async function changePhoneNumber() {
    setConfirmation(null);
    setCode("");
    setError("");
    const container = document.getElementById("recaptcha-container");
    if (container) container.innerHTML = "";
  }

  return (
    <main className="loginPage">
      <form className="loginPanel" onSubmit={submit}>
        <div className="loginBadge">
          <Shield size={22} />
        </div>
        <h1>App Performance</h1>
        <p>Admin view for Puzzle Canvas, Savory Advisor, and Receipt Cam.</p>
        {!confirmation ? (
          <>
            <label>
              Phone number
              <input
                autoComplete="tel"
                autoFocus
                inputMode="tel"
                placeholder="+1 555 123 4567"
                type="tel"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
              />
            </label>
            <div className="recaptchaBox" id="recaptcha-container" />
          </>
        ) : (
          <>
            <label>
              Verification code
              <input
                autoComplete="one-time-code"
                autoFocus
                inputMode="numeric"
                pattern="[0-9]*"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button className="textButton" type="button" onClick={changePhoneNumber} disabled={loading}>
              Use a different phone number
            </button>
          </>
        )}
        {error ? <div className="errorText">{error}</div> : null}
        <button disabled={loading || (!confirmation && !phoneNumber) || (Boolean(confirmation) && !code)} type="submit">
          {loading ? "Working..." : confirmation ? "Verify code" : "Send code"}
        </button>
      </form>
    </main>
  );
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authenticated, setAuthenticated] = useState(true);
  const [error, setError] = useState("");
  const [activeApp, setActiveApp] = useState<AppKey | null>(null);

  const hasNoData = useMemo(() => metrics?.apps.every((app) => !app.generatedAt) ?? false, [metrics]);

  const apps = metrics?.apps ?? [];
  const currentKey = activeApp ?? apps[0]?.appKey ?? null;
  const currentApp = apps.find((app) => app.appKey === currentKey) ?? null;

  async function load() {
    setLoading(true);
    setError("");
    const response = await requestJson<MetricsResponse>(apiPath("/api/metrics"));
    setLoading(false);

    if (response.status === 401) {
      setAuthenticated(false);
      return;
    }
    if (!response.ok) {
      setError("Could not load metrics.");
      return;
    }
    setAuthenticated(true);
    setMetrics(response.data);
  }

  async function refresh() {
    setRefreshing(true);
    setError("");
    const response = await requestJson<MetricsResponse>(apiPath("/api/refresh"), { method: "POST" });
    setRefreshing(false);

    if (response.status === 401) {
      setAuthenticated(false);
      return;
    }
    if (!response.ok) {
      setError("Could not refresh metrics.");
      return;
    }
    setMetrics(response.data);
  }

  async function logout() {
    await requestJson<{ ok: boolean }>(apiPath("/api/logout"), { method: "POST" });
    setAuthenticated(false);
    setMetrics(null);
  }

  useEffect(() => {
    void load();
  }, []);

  if (!authenticated) {
    return <Login onSuccess={load} />;
  }

  return (
    <main className="dashboardShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">Portfolio performance</p>
          <h1>App Performance</h1>
          <p className="subtle">Last updated {dateValue(metrics?.lastUpdatedAt ?? null)}</p>
        </div>
        <div className="actions">
          <button className="iconButton" type="button" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={18} />
            <span>{refreshing ? "Refreshing" : "Refresh"}</span>
          </button>
          <button className="iconButton ghost" type="button" onClick={logout} aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {error ? <div className="notice danger">{error}</div> : null}
      {metrics?.stale ? <div className="notice">Data is older than 12 hours. A refresh will run automatically on load.</div> : null}
      {metrics?.refreshStatus && !metrics.refreshStatus.ok ? <div className="notice danger">{metrics.refreshStatus.message}</div> : null}
      {hasNoData ? <div className="notice">No snapshots yet. Add credentials, then use Refresh to generate the first set.</div> : null}

      {loading ? (
        <section className="loadingState">Loading dashboard...</section>
      ) : metrics ? (
        <>
          <nav className="appTabs" role="tablist" aria-label="Apps">
            {apps.map((app) => (
              <button
                key={app.appKey}
                type="button"
                role="tab"
                aria-selected={app.appKey === currentKey}
                className={app.appKey === currentKey ? "appTab active" : "appTab"}
                onClick={() => setActiveApp(app.appKey)}
              >
                {app.displayName}
              </button>
            ))}
          </nav>
          {currentApp ? (
            <section className="appGrid" aria-label="App metrics">
              <AppPanel key={currentApp.appKey} app={currentApp} />
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
