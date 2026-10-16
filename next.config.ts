import type { NextConfig } from "next";

// The Base44 preview proxy serves the app at https://3000-$BASE44_PUBLIC_HOST_SUFFIX.
// vinext's dev origin guard blocks that origin unless it is listed here. Allow it
// only inside the Base44 sandbox; unchanged elsewhere.
const base44DevOrigins =
  process.env.BASE44_PREVIEW_MODE === "1" && process.env.BASE44_PUBLIC_HOST_SUFFIX
    ? [`3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`]
    : [];

const nextConfig: NextConfig = {
  allowedDevOrigins: base44DevOrigins,
  async headers() {
    const securityHeaders=[
      {key:"X-Content-Type-Options",value:"nosniff"},
      {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
      {key:"X-Frame-Options",value:"DENY"},
      {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"},
      {key:"Content-Security-Policy",value:"default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://api.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'; upgrade-insecure-requests"},
      {key:"Strict-Transport-Security",value:"max-age=31536000; includeSubDomains"},
    ];
    return [{source:"/:path*",headers:securityHeaders}];
  },
};

export default nextConfig;
