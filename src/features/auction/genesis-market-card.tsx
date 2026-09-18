import { GenesisPortrait } from "@/src/components/art/hero-face";
import { Button } from "@/src/components/ui/button";
import { auctionContent as copy } from "@/src/content/auction";
import { siteContent } from "@/src/content/site";

export function GenesisMarketCard() {
  return <section className="app-launch-genesis" aria-labelledby="app-launch-genesis-title">
    <h2 id="app-launch-genesis-title">{copy.genesis.title}</h2>
    <div className="app-launch-genesis-faces" aria-hidden="true">
      {[2, 5, 8].map(portrait => <GenesisPortrait key={portrait} portrait={portrait} size={64} unframed />)}
    </div>
    <p>{copy.genesis.description}</p>
    <p>{copy.genesis.conversion}</p>
    <Button block preserveCase href={siteContent.links.genesisMarket}>{copy.genesis.action}</Button>
  </section>;
}

