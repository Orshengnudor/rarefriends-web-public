import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as viem from "viem";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type * as Transactions from "../src/lib/protocol/transactions.ts";
import type { ChainContext } from "../src/lib/protocol/chain-context.ts";

const source = await readFile(new URL("../src/lib/protocol/transactions.ts", import.meta.url), "utf8");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 } }).outputText;
const owner = "0x1111111111111111111111111111111111111111";
const manager = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";
const cost = 100n * 10n ** 18n;

for (const allowance of [0n, cost - 1n, cost, viem.maxUint256]) {
  test(`hardwire with allowance ${allowance} uses or reuses unlimited approval`, async () => {
    const dependencies: Record<string, unknown> = {
      viem,
      "@/src/lib/protocol/chain-context": {
        ProtocolError: Error,
        contractRead: async (_context: unknown, _contract: string, method: string) => {
          if (method === "allowance") return allowance;
          if (method === "balanceOf" || method === "denomination") return cost;
          if (method === "temporaryFriend") return 7n;
          throw new Error(`Unexpected read: ${method}`);
        },
      },
      "./indexer": { supportsFriendRewards: () => true, units: (value: bigint) => Number(viem.formatUnits(value, 18)),
        mapBounded: (items: unknown[], fn: (item: unknown) => unknown) => Promise.all(items.map(fn)) },
      "./quotes": {},
      "./reserve": {},
    };
    const transactionModule = { exports: {} };
    new Function("require", "exports", compiled)((name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    }, transactionModule.exports);
    const { prepareProtocol } = transactionModule.exports as typeof Transactions;
    const context = { chainId: 1, client: { getBlock: async () => ({ number: 1n }), call: async () => ({ data: "0x" }) },
      manifest: { contracts: {
        RF: { address: token, abi: viem.erc20Abi },
        ActivationManager: { address: manager, abi: viem.parseAbi(["function hardwire(uint256 generation)"]) },
      } } } as unknown as ChainContext;
    const plan = await prepareProtocol({ address: owner, action: { kind: "hardwire", collection: "Generations", friendId: 7 } }, context);
    assert.equal(plan.quote.enabled, true);
    assert.equal(plan.steps.length, allowance >= cost ? 1 : 2);
    if (allowance < cost) {
      const approval = plan.steps[0];
      assert.equal(approval.transaction.to, token);
      const call = viem.decodeFunctionData({ abi: viem.erc20Abi, data: approval.transaction.data });
      assert.equal(call.functionName, "approve");
      assert.deepEqual(call.args, [manager, viem.maxUint256]);
      assert.match(approval.label, /unlimited/i);
    }
    assert.equal(plan.steps.at(-1)!.transaction.to, manager);
  });
}
