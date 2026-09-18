import { createPublicClient, custom } from "viem";

export type WalletRpc = {
  address?: string;
  chainId?: string;
  request(method: string, params?: unknown[]): Promise<unknown>;
  getSession(): number;
};

const providers = new WeakMap<WalletRpc["request"], number>();
const clients = new WeakMap<WalletRpc["request"], Map<number, { session: number; client: ReturnType<typeof createWalletRpcClient> }>>();
let nextProvider = 0;
const READ_METHODS = new Set([
  "eth_chainId", "eth_accounts", "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_getBalance",
  "eth_getCode", "eth_getStorageAt", "eth_getLogs", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getTransactionCount",
  "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
]);
const MAX_CONCURRENT_READS = 3;

/** Cache identities follow the selected provider and session, never an HTTP URL. */
export function walletRpcScope(wallet: WalletRpc) {
  let provider = providers.get(wallet.request);
  if (provider === undefined) { provider = ++nextProvider; providers.set(wallet.request, provider); }
  return `wallet:${provider}:${wallet.getSession()}`;
}

/** EIP-1193 only. No website proxy, direct HTTP fallback, or permission prompt. */
export type WalletRpcClientOptions = { multicall?: `0x${string}` };

export function walletRpcClient(wallet: WalletRpc, chainId: number, options: WalletRpcClientOptions = {}) {
  let scoped = clients.get(wallet.request);
  if (!scoped) { scoped = new Map(); clients.set(wallet.request, scoped); }
  const session = wallet.getSession();
  const cached = scoped.get(chainId);
  if (cached?.session === session) return cached.client;
  const client = createWalletRpcClient(wallet, chainId, options);
  scoped.set(chainId, { session, client });
  // Old clients still enforce their captured session, even after eviction.
  while (scoped.size > 4) scoped.delete(scoped.keys().next().value!);
  return client;
}

function createWalletRpcClient(wallet: WalletRpc, chainId: number, options: WalletRpcClientOptions = {}) {
  const session = wallet.getSession();
  let validated: Promise<void> | undefined;
  let activeReads = 0;
  const queuedReads: Array<() => void> = [];
  const pendingReads = new Map<string, Promise<unknown>>();
  function checkSession() {
    if (wallet.getSession() !== session) throw new Error("Your wallet or network changed. Reconnect to the intended network and refresh.");
  }
  async function execute(method: string, params?: unknown[]) {
    checkSession();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        wallet.request(method, params),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Your wallet RPC did not respond. Check the RPC configured in your wallet and try again.")), 30_000); }),
      ]);
      checkSession();
      return result;
    } finally { clearTimeout(timer); }
  }
  function request(method: string, params?: unknown[]): Promise<unknown> {
    checkSession();
    // Never coalesce, cache, or retry a signature or transaction submission.
    if (!READ_METHODS.has(method)) return execute(method, params);
    const key = JSON.stringify([method, params ?? []]);
    const existing = pendingReads.get(key);
    if (existing) return existing;
    const work = new Promise<unknown>((resolve, reject) => {
      const start = () => {
        activeReads++;
        void execute(method, params).then(resolve, reject).finally(() => {
          activeReads--;
          queuedReads.shift()?.();
        });
      };
      if (activeReads < MAX_CONCURRENT_READS) start();
      else queuedReads.push(start);
    });
    pendingReads.set(key, work);
    const clear = () => { if (pendingReads.get(key) === work) pendingReads.delete(key); };
    void work.then(clear, clear);
    // Only requests currently in flight are shared. Completed mutable reads
    // are never cached here, so pre-transaction reads always reach the wallet.
    return work;
  }
  async function validateChain() {
    const actual = await request("eth_chainId");
    if (typeof actual !== "string" || !/^0x[0-9a-f]+$/i.test(actual) || BigInt(actual) !== BigInt(chainId)) {
      throw new Error(`Switch your wallet to chain ${chainId} to read live data.`);
    }
  }
  return createPublicClient({
    cacheTime: 0,
    pollingInterval: 2_000,
    // Server workers opt in: reads issued together become one Multicall3 aggregate3 call at the same block.
    ...(options.multicall ? {
      batch: { multicall: { wait: 16, batchSize: 4_096 } },
      chain: { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [] } }, contracts: { multicall3: { address: options.multicall } } },
    } : {}),
    transport: custom({ request: async ({ method, params }) => {
      checkSession();
      if (!validated) {
        validated = validateChain().catch(error => { validated = undefined; throw error; });
      }
      await validated;
      const result = await request(method, params as unknown[] | undefined);
      if (method === "eth_chainId" && (typeof result !== "string" || BigInt(result) !== BigInt(chainId))) {
        throw new Error(`Switch your wallet to chain ${chainId} to read live data.`);
      }
      return result;
    } }, { retryCount: 0, name: "Connected wallet RPC" }),
  });
}
