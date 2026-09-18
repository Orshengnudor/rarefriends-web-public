import { erc20Abi, parseAbi, type Address } from "viem";
import type { ReserveStatus } from "@/src/features/protocol/types";
import { reserveAvailability } from "@/src/lib/reserve-policy";
import productionCca from "@/src/config/production-cca.json";
import { contractRead, ProtocolError, type ChainContext } from "@/src/lib/protocol/chain-context";

const marketAbi = parseAbi(["function seedComplete() view returns (bool)"]);

export async function readReserveStatus(context: ChainContext, blockNumber: bigint): Promise<ReserveStatus> {
  const address = context.manifest.contracts.Reserve.address;
  const [retired, conversionEnabled, marketAddress, rfAddress, genesisAddress, fee, payout, balance, inventory, decimals] = await Promise.all([
    contractRead<boolean>(context, "Reserve", "retired", [], blockNumber),
    contractRead<boolean>(context, "Reserve", "conversionEnabled", [], blockNumber),
    contractRead<Address>(context, "Reserve", "market", [], blockNumber),
    contractRead<Address>(context, "Reserve", "rf", [], blockNumber),
    contractRead<Address>(context, "Reserve", "genesis", [], blockNumber),
    contractRead<bigint>(context, "Reserve", "DEPOSIT_FEE", [], blockNumber),
    contractRead<bigint>(context, "Reserve", "RF_PER_GENESIS", [], blockNumber),
    contractRead<bigint>(context, "RF", "balanceOf", [address], blockNumber),
    contractRead<bigint>(context, "Reserve", "inventoryCount", [], blockNumber),
    context.client.readContract({ address: context.manifest.contracts.RF.address, abi: erc20Abi, functionName: "decimals", blockNumber }),
  ]);
  if (rfAddress.toLowerCase() !== context.manifest.contracts.RF.address.toLowerCase()
    || genesisAddress.toLowerCase() !== context.manifest.contracts.Genesis.address.toLowerCase()) {
    throw new ProtocolError("The Reserve does not match the configured RF and Genesis contracts.", 503);
  }
  // The Reserve can select a different market. Its own dependency controls deposit eligibility.
  const marketSeeded = await context.client.readContract({ address: marketAddress, abi: marketAbi, functionName: "seedComplete", blockNumber });
  const production = context.chainId === productionCca.chainId && address.toLowerCase() === productionCca.reserveAddress.toLowerCase();
  const state = { retired, conversionEnabled, marketSeeded, rfBalance: String(balance), conversionPayout: String(payout) };
  return { ...state, ...reserveAvailability(state), chainId: context.chainId, address, blockNumber: String(blockNumber),
    marketAddress, rfDecimals: decimals, conversionFee: String(fee), inventoryCount: String(inventory),
    plannedBacking: production ? productionCca.reserveSnapshot.plannedBacking : null,
    liquidityAllocation: production ? productionCca.reserveSnapshot.liquidityAllocation : null,
  };
}
