import { deploymentNetwork, readDeploymentManifest, ProtocolError } from "./config.ts";

export async function publicWalletNetwork(request: Request) {
  if (new URL(request.url).search) throw new ProtocolError("Invalid wallet network request.");
  return deploymentNetwork((await readDeploymentManifest()).chainId);
}
