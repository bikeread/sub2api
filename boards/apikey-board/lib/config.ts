const DEFAULT_BASE_PATH = '/boards/apikey';
const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_REFRESH_SECONDS = 30;

export const appConfig = {
  boardBasePath:
    process.env.NEXT_PUBLIC_BOARD_BASE_PATH ||
    process.env.BOARD_BASE_PATH ||
    DEFAULT_BASE_PATH,
  timezone: process.env.BOARD_TIMEZONE || DEFAULT_TIMEZONE,
  refreshSeconds: Math.max(
    10,
    Number.parseInt(
      process.env.NEXT_PUBLIC_REFRESH_DEFAULT_SECONDS ||
        process.env.REFRESH_DEFAULT_SECONDS ||
        `${DEFAULT_REFRESH_SECONDS}`,
      10,
    ) || DEFAULT_REFRESH_SECONDS,
  ),
  sub2apiBaseUrl: process.env.SUB2API_BASE_URL || '',
};

export function requireServerEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
