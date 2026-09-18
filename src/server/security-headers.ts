import { randomBytes } from "node:crypto";
import { publicProtocolRpc } from "../lib/public-chain-rpc.ts";

type SecurityOptions = { nonce: string; development: boolean; https: boolean; walletConnect?: boolean; googleAnalytics?: boolean; localWalletRpcUrl?: string };

/** Never accept a nonce from a client request or reuse one across rendered responses. */
export function createNonce() {
  return randomBytes(18).toString("base64");
}

export function securityHeaders({ nonce, development, https, walletConnect = false, googleAnalytics = false, localWalletRpcUrl }: SecurityOptions) {
  if (!/^[A-Za-z0-9+/]{24}$/.test(nonce)) throw new Error("Invalid CSP nonce");
  let localWalletOrigin = "";
  if (localWalletRpcUrl) {
    try { localWalletOrigin = ` ${new URL(publicProtocolRpc(31337, localWalletRpcUrl)).origin}`; }
    catch { /* Invalid or non-local endpoints never widen browser permissions. */ }
  }
  // GA4's regional collection endpoints; the tag itself still requires the document nonce.
  // https://developers.google.com/tag-platform/security/guides/csp#google_analytics
  const analyticsImages = googleAnalytics ? " https://google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com" : "";
  const analyticsConnections = googleAnalytics ? `${analyticsImages} https://analytics.google.com https://*.analytics.google.com` : "";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    `style-src 'self' ${development ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // AppKit creates theme/scroll-lock style elements without a nonce. Scripts retain the strict nonce policy.
    ...(walletConnect ? ["style-src-elem 'self' 'unsafe-inline'"] : []),
    // The design system uses style attributes for icons, art position, and live values.
    // This exception does not permit arbitrary inline scripts or <style> elements.
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: https://api.iconify.design${walletConnect ? " https://api.web3modal.org https://api.web3modal.com https://explorer-api.walletconnect.com https://explorer-api.walletconnect.org" : ""}${analyticsImages}`,
    "font-src 'self'",
    `connect-src 'self'${walletConnect ? " https://rpc.mainnet.chain.robinhood.com" : ""} https://api.iconify.design${walletConnect ? " https://relay.walletconnect.com https://relay.walletconnect.org wss://relay.walletconnect.com wss://relay.walletconnect.org https://rpc.walletconnect.org https://rpc.walletconnect.com https://api.web3modal.org https://api.web3modal.com https://pulse.walletconnect.org https://pulse.walletconnect.com https://explorer-api.walletconnect.com https://explorer-api.walletconnect.org" : ""}${development ? " ws: wss: http://127.0.0.1:8545" : ""}${localWalletOrigin}${analyticsConnections}`,
    "object-src 'none'",
    walletConnect ? "frame-src https://verify.walletconnect.com https://verify.walletconnect.org" : "frame-src 'none'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "media-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(!development && https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const headers: Record<string, string> = {
    "Content-Security-Policy": policy,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), display-capture=(), clipboard-read=(), clipboard-write=(self)",
  };
  // Do not force HTTPS on local HTTP or unrelated subdomains that may not have TLS.
  if (!development && https) headers["Strict-Transport-Security"] = "max-age=31536000";
  return headers;
}

/** Production never serves debug files, maps, or the retired shared asset namespace. */
export function isProductionDebugPath(pathname: string) {
  let path: string;
  try { path = decodeURIComponent(pathname).toLowerCase(); } catch { return true; }
  return path.startsWith("/__nextjs")
    || path === "/_next/static/immutable" || path.startsWith("/_next/static/immutable/")
    || path.startsWith("/_next/webpack-hmr")
    || path.startsWith("/_next/development")
    || path.startsWith("/_next/static/development/")
    || path.startsWith("/_next/trace")
    || /\.map(?:\/|$)/.test(path)
    || /(?:^|\/)\.(?:env(?:[./]|$)|git(?:\/|$)|next(?:-prod|-full)?(?:\/|$))/.test(path);
}

/** Preparation validates an explicit wallet action without signing or sending it. */
export function allowedApiMethods(pathname: string) {
  return ["/api/protocol/prepare", "/api/protocol/settlement"].includes(pathname) ? ["POST", "OPTIONS"] : ["GET", "HEAD", "OPTIONS"];
}

/** Only the exact preparation endpoint accepts a POST body. */
export function isUnsupportedApiMethod(pathname: string, method: string) {
  return (pathname === "/api" || pathname.startsWith("/api/"))
    && !allowedApiMethods(pathname).includes(method.toUpperCase());
}

export function isCacheableAsset(pathname: string) {
  return pathname.startsWith("/_next/static/") || pathname === "/_next/image"
    || /\.(?:css|js|woff2?|png|jpe?g|gif|svg|ico|webp|avif)$/.test(pathname);
}
