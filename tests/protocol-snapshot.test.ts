import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { ProtocolError } from "../src/lib/protocol/chain-context.ts";
import { readProtocolTotals, type SnapshotPublication } from "../src/server/protocol/snapshot.ts";

const context = { chainId: 4663, local: false, fromBlock: 62624268n };
let originalUrl: string | undefined;
beforeEach(() => { originalUrl = process.env.PROTOCOL_SNAPSHOT_URL; delete process.env.PROTOCOL_SNAPSHOT_URL; });
afterEach(() => {
  if (originalUrl === undefined) delete process.env.PROTOCOL_SNAPSHOT_URL;
  else process.env.PROTOCOL_SNAPSHOT_URL = originalUrl;
});

function publication(): SnapshotPublication {
  return {
    chainId: 4663, generatedAt: new Date().toISOString(), blockTimestamp: Math.floor(Date.now() / 1000), finalizedBlock: "66073950", stale: false,
    protocolSnapshot: {
      v: 1, blockNumber: "66073955", blockHash: `0x${"ab".repeat(32)}`, activatedGenesis: 12, friendsPlaying: 20,
      genesisWeight: "24000000000000000000000000", generationsWeight: "987187500000000000000000",
      activationPaid: "1200000000000000000000000", ammVolume: "123456789012345678901234",
      claimedRf: "12345678901234567890", claimedWeth: "123456789012345678",
    },
  };
}

function response(body: unknown, init?: ResponseInit): typeof fetch {
  return async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });
}

function unavailable(error: unknown) {
  assert.ok(error instanceof ProtocolError);
  assert.equal(error.status, 503);
  assert.equal(error.message, "Protocol snapshot is unavailable. Please try again shortly.");
  return true;
}

test("fresh production snapshot preserves exact integers and uses bounded cached fetching", async () => {
  const body = publication();
  let request: { url: string; options?: RequestInit } | undefined;
  const value = await readProtocolTotals(context, async (input, init) => {
    request = { url: String(input), options: init };
    return new Response(JSON.stringify(body));
  });
  assert.deepEqual(value, body);
  assert.equal(value.protocolSnapshot.ammVolume, "123456789012345678901234");
  assert.equal(request?.url, "https://rarefriends-snapshot.rarefriends-protocol.workers.dev/snapshot.json");
  assert.equal(new Headers(request?.options?.headers).get("accept"), "application/json");
  assert.equal(request?.options?.next?.revalidate, 60);
  assert.equal(request?.options?.redirect, "error");
  assert.ok(request?.options?.signal instanceof AbortSignal);
});

test("configured HTTPS endpoint works without requiring the optional stale flag", async () => {
  process.env.PROTOCOL_SNAPSHOT_URL = "https://snapshots.example.com/protocol.json";
  const body = publication();
  delete body.stale;
  const value = await readProtocolTotals(context, async input => {
    assert.equal(String(input), process.env.PROTOCOL_SNAPSHOT_URL);
    return new Response(JSON.stringify(body));
  });
  assert.deepEqual(value, body);
});

test("unsupported contexts and unsafe URLs fail before making a request", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response(JSON.stringify(publication())); };
  for (const invalid of [{ ...context, local: true }, { ...context, chainId: 31337 }, { ...context, chainId: 1 }]) {
    await assert.rejects(readProtocolTotals(invalid, fetcher), unavailable);
  }
  for (const url of ["http://example.com/snapshot.json", "https://user:secret@example.com/snapshot.json", "https://example.com/snapshot.json#secret", "invalid"]) {
    process.env.PROTOCOL_SNAPSHOT_URL = url;
    await assert.rejects(readProtocolTotals(context, fetcher), unavailable);
  }
  assert.equal(calls, 0);
});

test("HTTP errors, invalid JSON, and thrown failures return only the generic 503", async () => {
  await assert.rejects(readProtocolTotals(context, response({ error: "private RPC URL" }, { status: 502 })), unavailable);
  await assert.rejects(readProtocolTotals(context, async () => new Response("not JSON")), unavailable);
  await assert.rejects(readProtocolTotals(context, async () => { throw new Error("https://private.example.com/secret-token"); }), unavailable);
});

test("stale publications and old or future generation/block timestamps are rejected", async () => {
  const mutations: ((body: Record<string, unknown>) => void)[] = [
    body => { body.stale = true; },
    body => { body.stale = "false"; },
    body => { body.generatedAt = new Date(Date.now() - 16 * 60_000).toISOString(); },
    body => { body.generatedAt = new Date(Date.now() + 60_000).toISOString(); },
    body => { body.generatedAt = "invalid"; },
    body => { body.blockTimestamp = Math.floor(Date.now() / 1000) - 16 * 60; },
    body => { body.blockTimestamp = Math.floor(Date.now() / 1000) + 60; },
    body => { body.blockTimestamp = -1; },
  ];
  for (const mutate of mutations) {
    const body = publication() as unknown as Record<string, unknown>;
    mutate(body);
    await assert.rejects(readProtocolTotals(context, response(body)), unavailable);
  }
});

test("snapshot shape, chain, version, counts, and exact unsigned counters are validated", async () => {
  for (const body of [null, [], {}, { ...publication(), chainId: 1 }, { ...publication(), protocolSnapshot: [] }]) {
    await assert.rejects(readProtocolTotals(context, response(body)), unavailable);
  }
  const invalidFields = [
    ["v", 2], ["blockHash", "0x1234"], ["activatedGenesis", -1], ["activatedGenesis", 21], ["friendsPlaying", 1.5],
    ["friendsPlaying", Number.MAX_SAFE_INTEGER + 1], ["genesisWeight", -1], ["generationsWeight", "-1"],
    ["activationPaid", "01"], ["ammVolume", "1e18"], ["claimedRf", "0x123"], ["claimedWeth", (1n << 256n).toString()],
  ] as const;
  for (const [key, invalid] of invalidFields) {
    const body = publication();
    (body.protocolSnapshot as unknown as Record<string, unknown>)[key] = invalid;
    await assert.rejects(readProtocolTotals(context, response(body)), unavailable);
  }
});

test("snapshot block cannot precede deployment or be lower than finality", async () => {
  for (const [blockNumber, finalizedBlock] of [["62624267", "62624266"], ["66073955", "66073956"], ["-1", "0"], ["66073955", "1e6"]]) {
    const body = publication();
    body.protocolSnapshot.blockNumber = blockNumber;
    body.finalizedBlock = finalizedBlock;
    await assert.rejects(readProtocolTotals(context, response(body)), unavailable);
  }
});

test("oversized responses are canceled even without a content-length header", async () => {
  await assert.rejects(readProtocolTotals(context, response(publication(), { headers: { "content-length": "16385" } })), unavailable);
  let canceled = false;
  const fetcher: typeof fetch = async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(8192)); },
    cancel() { canceled = true; },
  }));
  await assert.rejects(readProtocolTotals(context, fetcher), unavailable);
  assert.equal(canceled, true);
});
