// Each deployment supplies its own public Reown application identifier.
export function walletConnectProjectId(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.WALLETCONNECT_PROJECT_ID?.trim() ?? "";
  return /^[a-f0-9]{32}$/i.test(value) ? value : null;
}
