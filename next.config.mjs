function dashboardBasePath() {
  const value = process.env.NEXT_PUBLIC_DASHBOARD_BASE_PATH?.trim();
  if (!value || value === "/") return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: dashboardBasePath(),
  reactStrictMode: true
};

export default nextConfig;
