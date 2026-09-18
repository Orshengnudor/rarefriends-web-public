import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, toHex, type Address, type Hex } from "viem";
import { contractRead, ProtocolError, type ChainContext } from "@/src/lib/protocol/chain-context";

type Token = "RF" | "WETH";
type TokenLayout = { balance: bigint; allowance: bigint };
const openZeppelinLayout: TokenLayout = { balance: 0n, allowance: 1n };
const weth9Layout: TokenLayout = { balance: 3n, allowance: 4n };
// OpenZeppelin v4 ERC20Upgradeable behind a proxy: Initializable plus a 50-slot gap precede the balances.
// Robinhood Chain WETH (0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73) verified via debug_traceCall on 2026-09-16.
const openZeppelinUpgradeableLayout: TokenLayout = { balance: 51n, allowance: 52n };

function tokenStateOverride(owner: Address, spender: Address, balance: bigint, allowance: bigint, layout: TokenLayout) {
  const balanceKey = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner, layout.balance]));
  const ownerAllowance = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner, layout.allowance]));
  const allowanceKey = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, ownerAllowance]));
  return { stateDiff: { [balanceKey]: toHex(balance, { size: 32 }), [allowanceKey]: toHex(allowance, { size: 32 }) } };
}

async function verifiedTokenLayout(context: ChainContext, token: Token, owner: Address, spender: Address, block: bigint): Promise<TokenLayout> {
  const contract = context.manifest.contracts[token];
  // Distinct values prove both getters actually read the proposed storage keys.
  // A node that ignores overrides or a token with another layout fails closed.
  const probeBalance = (1n << 128n) + 73_591n;
  const probeAllowance = (1n << 127n) + 19_837n;
  const candidates = token === "RF" ? [openZeppelinLayout] : [openZeppelinUpgradeableLayout, weth9Layout, openZeppelinLayout];
  let completedProbe = false;
  for (const layout of candidates) {
    const override = { [contract.address]: tokenStateOverride(owner, spender, probeBalance, probeAllowance, layout) };
    try {
      const values = await Promise.all([
        ["balanceOf", [owner]], ["allowance", [owner, spender]],
      ].map(async ([functionName, args]) => {
        const name = functionName as string;
        const result = await context.client.request({ method: "eth_call", params: [
          { to: contract.address, data: encodeFunctionData({ abi: contract.abi, functionName: name, args: args as Address[] }) },
          toHex(block), override,
        ] });
        return decodeFunctionResult({ abi: contract.abi, functionName: name, data: result as Hex }) as bigint;
      }));
      completedProbe = true;
      if (values[0] === probeBalance && values[1] === probeAllowance) return layout;
    } catch {
      // Another known layout may be valid. Nothing is written to the chain.
    }
  }
  throw new ProtocolError(completedProbe
    ? `The ${token} storage layout could not be verified for a swap quote. Your wallet's node must apply eth_call overrides, and the token must use a supported balance and allowance layout.`
    : "Your wallet's RPC could not run verified eth_call state overrides. Use a wallet RPC that supports state overrides to quote before wrapping or approving tokens.", 503);
}

export async function callSwapQuote(context: ChainContext, token: Token, sender: Address, amount: bigint, block: bigint, data: Hex): Promise<Hex> {
  const market = context.manifest.contracts.Market.address;
  const call = { from: sender, to: market, data, gas: "0x989680" as const };
  let layout: TokenLayout | undefined;
  if (context.local) {
    // Verified development artifacts directly inherit OpenZeppelin ERC20.
    layout = openZeppelinLayout;
  } else {
    const [balance, allowance] = await Promise.all([
      contractRead<bigint>(context, token, "balanceOf", [sender], block),
      contractRead<bigint>(context, token, "allowance", [sender, market], block),
    ]);
    // An already funded and approved wallet also works on nodes without overrides.
    if (balance < amount || allowance < amount) layout = await verifiedTokenLayout(context, token, sender, market, block);
  }
  // State overrides exist only during this eth_call. Actual wallet balances,
  // allowances and the subsequently prepared transactions remain unchanged.
  return await context.client.request({ method: "eth_call", params: layout
    ? [call, toHex(block), { [context.manifest.contracts[token].address]: tokenStateOverride(sender, market, amount, amount, layout) }]
    : [call, toHex(block)] }) as Hex;
}
