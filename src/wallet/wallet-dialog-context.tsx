"use client";

import { createContext, useContext } from "react";

/** Pages open the dialog owned by their frame without creating a wallet session. */
export const WalletDialogContext = createContext<(() => void) | null>(null);

export function useOpenWalletDialog() {
  const openWallet = useContext(WalletDialogContext);
  if (!openWallet) throw new Error("Wallet dialog is unavailable.");
  return openWallet;
}
