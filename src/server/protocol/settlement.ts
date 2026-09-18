import { encodeFunctionData, getAddress, isAddress, parseAbi, toHex, type Address, type Hex, type ContractFunctionReturnType, type GetLogsReturnType } from "viem";
import { ccaExitPlan, type CcaCheckpoint } from "@/src/lib/cca-lifecycle";
import { launchAbi } from "@/src/features/auction/abi";
import { contractRead, ProtocolError, type ChainContext } from "@/src/lib/protocol/chain-context";

const checkpointUpdated = parseAbi(["event CheckpointUpdated(uint256 blockNumber, uint256 clearingPriceQ96, uint24 cumulativeMps)"])[0];
const arbSys = "0x0000000000000000000000000000000000000064" as Address;
const arbSysAbi = parseAbi(["function arbBlockNumber() view returns (uint256)"]);
const MAX_LOG_RANGE = 10_000n;

export type SettlementPreparation = {
  chainId: number; auctionAddress: Address; owner: Address; bidId: string;
  block: string; blockHash: Hex; action: "checkpoint" | "exit" | "claim" | "done";
  to?: Address; data?: Hex; value?: Hex; gas?: string;
};

function input(value: unknown): { owner: Address; bidId: bigint } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProtocolError("Invalid settlement request.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["owner", "bidId"].includes(key)) || typeof body.owner !== "string" || !isAddress(body.owner)
    || typeof body.bidId !== "string" || !/^\d+$/.test(body.bidId)) throw new ProtocolError("A wallet address and bid ID are required.");
  return { owner: getAddress(body.owner), bidId: BigInt(body.bidId) };
}

async function logsInRange(context: ChainContext, event: typeof checkpointUpdated, fromBlock: bigint, toBlock: bigint) {
  const result: GetLogsReturnType<typeof checkpointUpdated> = [];
  for (let from = fromBlock; from <= toBlock;) {
    const to = from + MAX_LOG_RANGE - 1n < toBlock ? from + MAX_LOG_RANGE - 1n : toBlock;
    result.push(...await context.client.getLogs({ address: context.manifest.contracts.CCA.address, event, fromBlock: from, toBlock: to }));
    from = to + 1n;
  }
  return result;
}

export async function prepareSettlement(value: unknown, context: ChainContext): Promise<SettlementPreparation> {
  const { owner, bidId } = input(value);
  const cca = context.manifest.contracts.CCA;
  if (!cca) throw new ProtocolError("The auction is not configured.", 503);
  const head = await context.client.getBlock();
  if (head.number === null || !head.hash) throw new ProtocolError("A confirmed auction block is unavailable.", 503);
  const block = head.number;
  if (context.chainId === 4663) {
    const clock = await context.client.readContract({ address: arbSys, abi: arbSysAbi, functionName: "arbBlockNumber", blockNumber: block });
    if (clock !== block) throw new ProtocolError("The configured private RPC has an inconsistent Robinhood block clock.", 503);
  }
  const stored = await contractRead<ContractFunctionReturnType<typeof launchAbi, "view", "bids">>(context, "CCA", "bids", [bidId], block);
  if (!stored || stored.owner.toLowerCase() !== owner.toLowerCase()) throw new ProtocolError("This bid does not belong to the connected wallet.", 403);
  const base = { chainId: context.chainId, auctionAddress: cca.address, owner, bidId: bidId.toString(), block: block.toString(), blockHash: head.hash };
  if (stored.exitedBlock > 0n) {
    const [claim, graduated] = await Promise.all([
      contractRead<bigint>(context, "CCA", "claimBlock", [], block),
      contractRead<boolean>(context, "CCA", "isGraduated", [], block),
    ]);
    if (graduated && block >= claim && stored.tokensFilled > 0n) {
      const data = encodeFunctionData({ abi: launchAbi, functionName: "claimTokens", args: [bidId] });
      const gas = await context.client.estimateGas({ account: owner, to: cca.address, data, blockNumber: block });
      return { ...base, action: "claim", to: cca.address, data, value: toHex(0n), gas: gas.toString() };
    }
    return { ...base, action: "done" };
  }
  const [start, end, claim, graduated, checkpointBlock, point] = await Promise.all([
    contractRead<bigint>(context, "CCA", "startBlock", [], block),
    contractRead<bigint>(context, "CCA", "endBlock", [], block),
    contractRead<bigint>(context, "CCA", "claimBlock", [], block),
    contractRead<boolean>(context, "CCA", "isGraduated", [], block),
    contractRead<bigint>(context, "CCA", "lastCheckpointedBlock", [], block),
    contractRead<ContractFunctionReturnType<typeof launchAbi, "nonpayable", "checkpoint">>(context, "CCA", "checkpoint", [], block),
  ]);
  const checkpoints: CcaCheckpoint[] = (await logsInRange(context, checkpointUpdated, stored.startBlock, block)).map(log => ({ block: log.args.blockNumber!, price: log.args.clearingPriceQ96! }));
  const state = { block, start, end, claim, funded: true, graduated, finalized: checkpointBlock === end, price: point.clearingPrice };
  const bid = { id: bidId, startBlock: stored.startBlock, exitedBlock: stored.exitedBlock, maxPrice: stored.maxPrice, tokensFilled: stored.tokensFilled };
  const plan = ccaExitPlan(bid, state, checkpoints);
  if (plan.kind === "blocked") throw new ProtocolError(plan.reason, 409);
  if (plan.kind === "checkpoint") {
    const data = encodeFunctionData({ abi: launchAbi, functionName: "checkpoint" });
    const gas = await context.client.estimateGas({ account: owner, to: cca.address, data, blockNumber: block });
    return { ...base, action: "checkpoint", to: cca.address, data, value: toHex(0n), gas: gas.toString() };
  }
  if (plan.kind !== "exit") throw new ProtocolError("The bid settlement state changed. Refresh and try again.", 409);
  const data = encodeFunctionData({ abi: launchAbi, functionName: plan.functionName, args: plan.args });
  const gas = await context.client.estimateGas({ account: owner, to: cca.address, data, blockNumber: block });
  return { ...base, action: "exit", to: cca.address, data, value: toHex(0n), gas: gas.toString() };
}
