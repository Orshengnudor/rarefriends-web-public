"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { readLaunchBlock, readLaunchDetails, readLaunchSnapshot, type LaunchConfig } from "./chain";
import { launchRefreshPolicy, launchSnapshotKey, LIVE_AUCTION_REFRESH_MS } from "./query-policy";
import type { WalletRpc } from "../../wallet/wallet-rpc";

export function useLaunchAuction(config: LaunchConfig | null | undefined, wallet: WalletRpc, bidder = false, paused = false) {
  const stableConfig = JSON.stringify(config ?? null);
  const launch = useMemo<LaunchConfig | null>(() => JSON.parse(stableConfig), [stableConfig]);
  const { address, chainId, request, getSession } = wallet;
  const readWallet = useMemo(() => ({ address, chainId, request, getSession }), [address, chainId, request, getSession]);
  const ready = !!launch && !!address && !!chainId && BigInt(chainId) === BigInt(launch.chainId);
  const queryKey = launchSnapshotKey(launch, readWallet);
  const snapshot = useQuery({
    queryKey,
    queryFn: () => readLaunchSnapshot(launch!, readWallet),
    enabled: ready && !paused,
    // The header observes the same query but never refreshes it independently.
    staleTime: bidder ? LIVE_AUCTION_REFRESH_MS : Infinity,
    gcTime: Infinity,
    refetchOnMount: bidder,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const { data: clock, dataUpdatedAt, refetch } = snapshot;
  const detailsClock = clock;
  const details = useQuery({
    queryKey: ["launch-bidder", ...queryKey.slice(1), address?.toLowerCase(), detailsClock?.head.hash],
    queryFn: () => readLaunchDetails(launch!, readWallet, detailsClock!, address as Address | undefined),
    enabled: bidder && ready && !!detailsClock && !snapshot.isError && !paused,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    refetchOnMount: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const reading = snapshot.isFetching || details.isFetching;
  const refetchDetails = details.refetch;

  useEffect(() => {
    if (!bidder || paused || !ready || reading
      || (!snapshot.isError && !details.isError)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(() => {
        if (snapshot.isError) void refetch({ cancelRefetch: false });
        else void refetchDetails({ cancelRefetch: false });
      }, LIVE_AUCTION_REFRESH_MS + Math.random() * 5_000);
    };
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [bidder, paused, ready, reading, snapshot.isError, details.isError, refetch, refetchDetails]);

  useEffect(() => {
    // A slow wallet must finish this snapshot AND its bidder/event reads before
    // another head is requested; 15 seconds is a minimum idle gap, not a queue.
    if (!bidder || paused || reading || !ready || !launch || !clock || snapshot.isError || details.isError) return;
    let stopped = false;
    let updating = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastBlock = clock.block;
    let lastRead = dataUpdatedAt;
    const schedule = () => {
      if (stopped || document.visibilityState === "hidden") return;
      const policy = launchRefreshPolicy({ ...clock, block: lastBlock }, launch.chainId, lastRead);
      if (!policy) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void update(policy), policy.delay);
    };
    const update = async (policy = launchRefreshPolicy({ ...clock, block: lastBlock }, launch.chainId, lastRead)) => {
      if (stopped || updating || document.visibilityState === "hidden" || !policy) return;
      updating = true;
      try {
        if (policy.mode === "snapshot") {
          await refetch({ cancelRefetch: false });
        } else {
          const block = await readLaunchBlock(launch, readWallet);
          if (stopped) return;
          if (block >= policy.target! || block < lastBlock) await refetch({ cancelRefetch: false });
          else { lastBlock = block; lastRead = Date.now(); }
        }
      } catch { /* A failed boundary check retains the last verified snapshot. */ }
      updating = false;
      schedule();
    };
    const visibility = () => {
      if (timer) clearTimeout(timer);
      if (document.visibilityState !== "hidden") void update();
    };
    document.addEventListener("visibilitychange", visibility);
    schedule();
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [bidder, paused, reading, ready, launch, clock, dataUpdatedAt, refetch, readWallet, snapshot.isError, details.isError]);

  async function refresh() {
    if (ready) {
      if (details.isFetching) await details.refetch({ cancelRefetch: false });
      if (snapshot.isFetching) await snapshot.refetch({ cancelRefetch: false });
      const next = await snapshot.refetch({ cancelRefetch: false });
      if (next.data?.head.hash === clock?.head.hash && bidder) await details.refetch({ cancelRefetch: false });
    }
  }
  return {
    snapshot, details, ready, source: "wallet" as const, refresh,
    accountError: null, bidsLoading: bidder && ready && details.isPending,
    historyTruncated: false,
  };
}
