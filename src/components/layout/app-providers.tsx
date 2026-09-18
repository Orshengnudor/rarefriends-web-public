import type { ReactNode } from "react";
import { ProtocolProvider } from "@/src/features/protocol/protocol-provider";
import { LocalWallets } from "@/src/wallet/local-wallets";
import { PublicWalletProvider } from "@/src/wallet/wallet-provider";
import { AppFrame } from "./app-frame";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PublicWalletProvider network={{ explorerUrl: "" }}>
      <LocalWallets />
      <ProtocolProvider>
        <AppFrame>{children}</AppFrame>
      </ProtocolProvider>
    </PublicWalletProvider>
  );
}
