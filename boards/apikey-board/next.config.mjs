const basePath = process.env.BOARD_BASE_PATH || '/boards/apikey';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  basePath,
  env: {
    NEXT_PUBLIC_BOARD_BASE_PATH: basePath,
    NEXT_PUBLIC_REFRESH_DEFAULT_SECONDS:
      process.env.REFRESH_DEFAULT_SECONDS || '30',
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
