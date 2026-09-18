import { NextRequest, NextResponse } from "next/server";
import { allowedApiMethods, createNonce, isCacheableAsset, isProductionDebugPath, isUnsupportedApiMethod, securityHeaders } from "./src/server/security-headers";
import { walletConnectProjectId } from "./src/server/walletconnect-config";
import { googleAnalyticsId } from "./src/server/analytics-config";

export function proxy(request: NextRequest) {
  const development = process.env.NODE_ENV === "development";
  const nonce = createNonce();
  const headers = securityHeaders({ nonce, development, https: request.nextUrl.protocol === "https:",
    walletConnect: Boolean(walletConnectProjectId()),
    googleAnalytics: Boolean(googleAnalyticsId()),
    localWalletRpcUrl: process.env.PROTOCOL_PUBLIC_RPC_URL });
  const pathname = request.nextUrl.pathname;
  if (pathname === "/api/protocol/nft-image") {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  }
  let response: NextResponse;

  if (!development && isProductionDebugPath(pathname)) {
    response = new NextResponse("Not found", { status: 404 });
  } else if (isUnsupportedApiMethod(pathname, request.method)) {
    response = new NextResponse("Method not allowed", { status: 405, headers: { Allow: allowedApiMethods(pathname).join(", ") } });
  } else {
    const requestHeaders = new Headers(request.headers);
    // Overwrite untrusted values. Next reads this CSP to nonce its own SSR scripts.
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  // Keep each dynamic document's nonce paired with its response, including RSC requests.
  // Immutable JS, CSS, font and image caching is unaffected.
  // The public metadata route owns its CDN policy; it contains no document nonce.
  const publicMetadata = pathname === "/api/protocol/config" && ["GET", "HEAD"].includes(request.method);
  if (response.status !== 200 || (!isCacheableAsset(pathname) && !publicMetadata)) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  return response;
}

// Also cover APIs and static paths so debug files cannot bypass this guard.
export const config = { matcher: "/:path*" };
