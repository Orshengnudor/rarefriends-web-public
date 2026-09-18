"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProtocolConfig } from "./types";
import { metadataReadPolicy } from "./query-policy";

/** The wallet picker and app share one small, RPC-free manifest for this session. */
export function useProtocolConfig() {
  return useQuery({
    queryKey: ["protocol-config"],
    queryFn: async (): Promise<ProtocolConfig> => {
      // Do not abort on an observer unmount: the same static request can serve
      // the next page (and React's development remount) without starting over.
      const response = await fetch("/api/protocol/config", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : "Deployment metadata is unavailable.");
      return value;
    },
    ...metadataReadPolicy,
  });
}
