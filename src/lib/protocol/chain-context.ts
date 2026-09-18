import type { Abi, Address, Hex, PublicClient } from "viem";

/** Transport-independent protocol inputs. No environment, filesystem or HTTP access. */
export interface DeploymentContract { address: Address; abi: Abi; transactionHash?: string; deploymentBlock?: string }
export interface Deployment {
  chainId: number; chainName?: string; explorerUrl?: string; rpcUrl?: string; deploymentBlock: string; local?: boolean;
  accounts?: unknown[]; contracts: Record<string, DeploymentContract>;
  protocolSnapshot?: { v: 1; blockNumber: string; blockHash: Hex; activatedGenesis: number; friendsPlaying: number; genesisWeight: string; generationsWeight: string; activationPaid: string; ammVolume: string; claimedRf: string; claimedWeth: string };
  auction?: { deploymentBlock?: string; [key: string]: unknown };
  settings?: { auction?: { deploymentBlock?: string }; [key: string]: unknown };
}
export interface ChainContext {
  manifest: Deployment;
  client: PublicClient;
  /** Cache identity only; wallet contexts use their provider/session identity, not a URL. */
  rpcUrl: string;
  chainId: number;
  local: boolean;
  accounts: Address[];
  fromBlock: bigint;
}

export class ProtocolError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export async function contractRead<T>(context: ChainContext, name: string, functionName: string, args: readonly unknown[] = [], blockNumber?: bigint): Promise<T> {
  const contract = context.manifest.contracts[name];
  if (!contract) throw new ProtocolError(`${name} is not deployed.`, 503);
  return context.client.readContract({ address: contract.address, abi: contract.abi, functionName, args,
    ...(blockNumber === undefined ? {} : { blockNumber }) }) as Promise<T>;
}
