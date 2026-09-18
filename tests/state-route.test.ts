import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mock, test } from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as viem from "viem";
import * as config from "../src/server/protocol/config.ts";

const source = await readFile(new URL("../app/api/protocol/state/route.ts", import.meta.url), "utf8");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 } }).outputText;

/** Exercise the actual route with isolated readers; no node or external NFT API is needed. */
function stateRoute(local: boolean, unavailable = false) {
  const context = { local };
  const indexed = mock.fn(async () => ({ source: "local-chain" }));
  const wallet = mock.fn(async () => ({ source: "production-wallet" }));
  const snapshot = mock.fn(async () => ({ source: "production-snapshot" }));
  const dependencies: Record<string, unknown> = {
    viem,
    "@/src/server/protocol/config": { ...config, chainContext: async () => {
      if (unavailable) throw new config.ProtocolError("Protocol deployment is not configured.", 503);
      return context;
    } },
    "@/src/server/protocol/state": { readProtocolState: indexed },
    "@/src/server/protocol/wallet-read": { readWalletPortfolioState: wallet, readProtocolSnapshot: snapshot },
  };
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(name in dependencies, `Unexpected route dependency: ${name}`);
    return dependencies[name];
  }, routeModule, routeModule.exports);
  return { ...(routeModule.exports as { GET: (request: Request) => Promise<Response> }), indexed, wallet, snapshot };
}

test("Anvil state uses its chain index with or without a connected wallet", async () => {
  for (const query of ["", "?address=0x1111111111111111111111111111111111111111"]) {
    const route = stateRoute(true);
    const response = await route.GET(new Request(`http://localhost/api/protocol/state${query}`));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { source: "local-chain" });
    assert.equal(route.indexed.mock.callCount(), 1);
    assert.equal(route.wallet.mock.callCount(), 0);
    assert.equal(route.snapshot.mock.callCount(), 0);
  }
});

test("production state uses its snapshot and owner-specific NFT reader", async () => {
  const route = stateRoute(false);
  assert.deepEqual(await (await route.GET(new Request("http://localhost/api/protocol/state"))).json(), { source: "production-snapshot" });
  assert.deepEqual(await (await route.GET(new Request("http://localhost/api/protocol/state?address=0x1111111111111111111111111111111111111111"))).json(), { source: "production-wallet" });
  assert.equal(route.indexed.mock.callCount(), 0);
  assert.equal(route.wallet.mock.callCount(), 1);
  assert.equal(route.snapshot.mock.callCount(), 1);
});

test("missing deployment and invalid wallets never invoke a state reader", async () => {
  const route = stateRoute(false, true);
  assert.equal((await route.GET(new Request("http://localhost/api/protocol/state"))).status, 503);
  assert.equal((await route.GET(new Request("http://localhost/api/protocol/state?address=invalid"))).status, 400);
  assert.equal(route.indexed.mock.callCount(), 0);
  assert.equal(route.wallet.mock.callCount(), 0);
  assert.equal(route.snapshot.mock.callCount(), 0);
});
