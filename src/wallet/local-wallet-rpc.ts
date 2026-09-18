import { publicProtocolRpc } from "../lib/public-chain-rpc.ts";

const methods = new Set([
  "web3_clientVersion", "net_version", "eth_chainId", "eth_accounts", "eth_blockNumber", "eth_call", "eth_estimateGas",
  "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getLogs",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getTransactionCount", "eth_gasPrice", "eth_feeHistory",
  "eth_maxPriorityFeePerGas", "eth_sendTransaction",
]);

/** Verified local Anvil transport; no app server proxy or private keys. */
export async function verifiedLocalWalletRpc(rpcUrl: string) {
  const url = publicProtocolRpc(31337, rpcUrl);
  async function request(method: string, params: unknown[] = []): Promise<unknown> {
    if (!methods.has(method)) throw new Error("This local wallet RPC method is not available.");
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error?.message ?? "Local Anvil request failed.");
    return body.result;
  }
  async function verify() {
    const [chainId, version, accounts] = await Promise.all([
      request("eth_chainId"), request("web3_clientVersion"), request("eth_accounts"),
    ]);
    if (chainId !== "0x7a69" || typeof version !== "string" || !/anvil/i.test(version)
      || !Array.isArray(accounts) || accounts.some(account => typeof account !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(account))) {
      throw new Error("The direct wallet RPC is not a verified local Anvil node.");
    }
    return accounts as string[];
  }
  const accounts = await verify();
  return { accounts, async request(method: string, params: unknown[] = []) {
    if (method === "eth_sendTransaction") {
      const unlocked = await verify();
      const transaction = params[0] as { from?: string; chainId?: string } | undefined;
      if (!transaction?.from || !unlocked.some(account => account.toLowerCase() === transaction.from!.toLowerCase())
        || (transaction.chainId !== undefined && transaction.chainId !== "0x7a69")) throw new Error("Reconnect this verified Anvil account.");
    }
    return request(method, params);
  } };
}
