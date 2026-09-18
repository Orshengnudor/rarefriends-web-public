/**
 * Protocol handbook covering token mechanics, NFT ownership, and rewards.
 * Artwork source: protocol artwork integration and renderer metadata/trait sources.
 */
export const docsNav = [
  ["overview", "Overview"],
  ["rarefriends", "$RAREFRIENDS"],
  ["genesis", "Genesis"],
  ["generations", "Generations"],
  ["economy", "Economy"],
  ["terms", "Terms"],
] as const;

export type DocSlug = typeof docsNav[number][0];
export type DocChapterHeading = { title: string; intro: string };
export type DocTable = { caption: string; columns: string[]; rows: string[][] };
export type DocSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  items?: { title: string; text: string }[];
  table?: DocTable;
  note?: string;
  artwork?: "genesis" | "generations";
  details?: { title: string; paragraphs?: string[]; table?: DocTable }[];
  link?: { href: string; label: string };
};
export type DocChapter = DocChapterHeading & {
  takeaway: string;
  facts: [string, string][];
  sections: DocSection[];
};
export type DocTerms = DocChapterHeading & { format: "terms" };

export function docHref(slug: string) {
  return slug === "overview" ? "/docs" : `/docs/${slug}`;
}

export function docSlugForPath(path: string): DocSlug | null {
  return docsNav.find(([slug]) => docHref(slug) === path)?.[0] ?? null;
}

export const docsModelNote = "These pages describe protocol mechanics. Current contract state determines market and reserve availability, balances, and claimable rewards.";

export const docChapters: Record<DocSlug, DocChapter | DocTerms> = {
  overview: {
    title: "Rare Friends Economy",
    intro: "One token. Two NFT collections. Rewards funded by what people do in the virtual-pet economy.",
    takeaway: "The token powers the economy. Active NFTs share its rewards.",
    facts: [["NFT collections", "2"], ["Genesis cap", "1,024"], ["Reward assets", "RF + WETH"]],
    sections: [
      {
        id: "what-you-own", title: "What you own",
        items: [
          { title: "$RAREFRIENDS", text: "The tradable token used for activation, hardwiring, promotion and upgrades. RF is shorthand for $RAREFRIENDS in these docs." },
          { title: "Rare Friends Genesis", text: "The founding collection, capped at 1,024 NFTs. Activate a Genesis for a fixed reward weight." },
          { title: "Generations by Rare Friends", text: "The expanding collection. Hardwire a Friend, then promote or upgrade it to increase its reward weight." },
        ],
      },
      {
        id: "the-loop", title: "Where the rewards come from",
        table: {
          caption: "Activity → reward funding → active NFTs",
          columns: ["Activity", "Where the payment goes"],
          rows: [
            ["Activate, hardwire, promote, upgrade", "50% RF burned · 50% RF rewards"],
            ["Trade RF in the protocol market", "5% WETH-side fee → WETH rewards"],
            ["Use the Genesis reserve", "100% of the RF fee → RF rewards"],
          ],
        },
        note: "RF and WETH (wrapped ETH) go to active NFTs in proportion to their reward weight. Holding tokens alone earns no share.",
      },
      {
        id: "the-nft-wallet", title: "The NFT has its own wallet",
        paragraphs: ["Rewards belong to the Friend. Selling its NFT transfers control of its wallet assets and unclaimed rewards. A direct transfer also stops future earnings until the new owner reactivates it."],
        link: { href: "/docs/economy#reward-share", label: "See how reward shares work" },
      },
    ],
  },
  rarefriends: {
    title: "$RAREFRIENDS",
    intro: "The token you trade, spend and earn across Rare Friends.",
    takeaway: "Gameplay burns supply. Rewards redistribute tokens that already exist.",
    facts: [["Initial supply", "1.024B"], ["Later issuance", "None"], ["Gameplay burn", "50%"]],
    sections: [
      {
        id: "supply", title: "Supply only goes down",
        paragraphs: ["RF starts with 1,024,000,000 tokens and has no path to mint more."],
        note: "For a 100 RF gameplay payment: 50 RF leaves supply and 50 RF enters rewards. A burn reduces supply; market demand still determines price.",
      },
      {
        id: "utility", title: "What the token does",
        items: [
          { title: "Hold", text: "At least 1 RF makes a temporary Generations Friend appear. It has no reward weight and disappears if the balance falls below 1 RF." },
          { title: "Spend", text: "Activate Genesis, hardwire Generations, or improve a permanent Friend. Payments are spent, not locked as a refundable deposit." },
          { title: "Earn", text: "Active NFTs share RF rewards and WETH market fees. Owning RF by itself does not earn those rewards." },
        ],
      },
      {
        id: "market", title: "Trading and liquidity",
        paragraphs: ["The RF and WETH market charges 5% on the WETH side of buys and sells. All of that fee funds WETH rewards. The pool has permanent liquidity and no additional liquidity-provider swap fee.", "A buy with 100 WETH pays 5 WETH to rewards and swaps the remaining 95 WETH. A sale producing 100 WETH before the protocol fee pays the seller 95 WETH."],
      },
    ],
  },
  genesis: {
    title: "Genesis",
    intro: "The founding collection: 1,024 on-chain Rare Friends, each with its own wallet.",
    takeaway: "Activate and get a fixed 2,000,000 reward weight with no need to upgrade.",
    facts: [["Maximum NFTs", "1,024"], ["Activation cost · RF", "100,000"], ["Active reward weight", "2,000,000"]],
    sections: [
      {
        id: "activation", title: "Activation",
        paragraphs: ["Pay 100,000 RF to make your Genesis eligible for RF and WETH rewards. Of that payment, 50,000 RF is burned and 50,000 RF funds rewards. Activation is separate from buying the NFT."],
        note: "An active Genesis has about 2.03× the weight of a maxed-out Generation 1 at tier 4. That compares reward shares, not investment returns.",
      },
      {
        id: "transfers", title: "Buying or selling a Genesis",
        paragraphs: ["A direct sale or transfer clears activation. The new owner pays 100,000 RF to restore its full weight. Genesis has no hardwire action, promotions or upgrades.", "Wallet balances and already-earned rewards stay with the NFT. Withdraw assets before selling if you intend to keep them."],
      },
      {
        id: "artwork", title: "On-chain artwork & aspects", artwork: "genesis",
        paragraphs: ["The artwork system creates each Rare Friend and its attributes on-chain. Genesis uses fixed, static 8×8 portraits."],
        items: [
          { title: "Aspects", text: "Traits include lineage, stature, crown, jaw, eyes, ears and mouth. Expressions also describe brows and cheeks." },
          { title: "Identity", text: "Activation and transfers preserve your Rare Friend. Visual traits do not change its fixed reward weight." },
        ],
      },
      {
        id: "reserve", title: "Genesis and the reserve",
        paragraphs: ["When conversion is enabled, deposit a Genesis and pay a 100,000 RF fee to receive 1,000,000 RF. Your net token gain is 900,000 RF, and the reserve takes ownership of the NFT."],
        note: "The NFT enters reserve inventory; it's now removed from the circulating supply and can only be swapped for another Genesis you provide in addition to the fee.",
        link: { href: "/docs/economy#reserve", label: "Read the reserve terms" },
      },
    ],
  },
  generations: {
    title: "Generations",
    intro: "A Friend can start with 1 RF. Hardwire it, then choose how far to go.",
    takeaway: "Hardwire makes it permanent. Promote changes generation. Upgrade raises its tier.",
    facts: [["Generations", "6"], ["Tiers per generation", "0–4"], ["Minimum hardwire · RF", "1"]],
    sections: [
      {
        id: "hardwire", title: "Hardwire",
        paragraphs: ["Holding at least 1 RF creates one temporary Friend. Hardwiring spends RF to make it permanent and active at tier 0. Your live wallet balance selects the highest generation you can afford; Generation 1 is the highest."],
        table: {
          caption: "Hardwire costs and starting reward weight · RF amounts",
          columns: ["Generation", "Hardwire", "Base weight", "Reactivate"],
          rows: [["1", "100,000", "175,000", "10,000"], ["2", "10,000", "16,000", "1,000"], ["3", "1,000", "1,450", "100"], ["4", "100", "130", "10"], ["5", "10", "12", "1"], ["6", "1", "1.1", "0.1"]],
        },
        note: "Example: a 2,500 RF balance selects Generation 3 and spends 1,000 RF. Another temporary Friend appears if at least 1 RF remains. Temporary Friends cannot transfer or earn rewards.",
      },
      {
        id: "promote", title: "Promote",
        paragraphs: ["Move up one generation by paying the difference between hardwire prices. Your Friend keeps its identity and resets to tier 0 of the new generation."],
        table: {
          caption: "Adjacent promotions · payment in RF",
          columns: ["Promotion", "Payment"],
          rows: [["6 → 5", "9"], ["5 → 4", "90"], ["4 → 3", "900"], ["3 → 2", "9,000"], ["2 → 1", "90,000"]],
        },
        note: "Starting at Generation 6 and promoting all the way to 1 costs 100,000 RF in total, before any upgrades. Generations cannot promote into Genesis.",
      },
      {
        id: "upgrade", title: "Upgrade",
        paragraphs: ["Raise an active Friend through four sequential upgrades within its generation. Each tier increases its reward weight. Every payment splits 50% burn and 50% RF rewards."],
        details: [
          {
            title: "All upgrade prices",
            table: {
              caption: "Each step’s additional payment · RF",
              columns: ["Gen", "0 → 1", "1 → 2", "2 → 3", "3 → 4"],
              rows: [["1", "50,000", "75,000", "112,500", "168,750"], ["2", "5,000", "7,500", "11,250", "16,875"], ["3", "500", "750", "1,125", "1,687.5"], ["4", "50", "75", "112.5", "168.75"], ["5", "5", "7.5", "11.25", "16.875"], ["6", "0.5", "0.75", "1.125", "1.6875"]],
            },
          },
          {
            title: "Reward weight at every tier",
            table: {
              caption: "Allocation weight · not tokens or returns",
              columns: ["Gen", "Tier 0", "Tier 1", "Tier 2", "Tier 3", "Tier 4"],
              rows: [["1", "175,000", "270,000", "416,250", "641,250", "987,187.5"], ["2", "16,000", "24,375", "37,125", "56,531.25", "86,062.5"], ["3", "1,450", "2,212.5", "3,375", "5,146.875", "7,846.875"], ["4", "130", "198.75", "303.75", "464.0625", "708.75"], ["5", "12", "18.375", "28.125", "43.03125", "65.8125"], ["6", "1.1", "1.6875", "2.5875", "3.965625", "6.075"]],
            },
          },
        ],
        note: "Promotion resets upgrades. A direct transfer clears activation and upgrades; reactivation costs 10% of that generation’s hardwire price and starts at tier 0. Previous upgrade payments are not refunded or credited.",
      },
      {
        id: "artwork", title: "On-chain artwork & aspects", artwork: "generations",
        paragraphs: ["Generations uses 16×16 characters across nine families, four floor types and six worlds. Temporary or inactive Friends show a still portrait. Activated Friends live in animated isometric worlds. The characters, scenery and SVG animations are generated fully on-chain."],
        items: [
          { title: "Hardwire", text: "Allows your Rare Friend to start collecting crypto." },
          { title: "Promote", text: "Gives your Rare Friend more land to collect crypto." },
          { title: "Upgrade", text: "Changes the reward tier, not the character’s appearance. Weight comes from generation and tier, not visual rarity." },
        ],
        details: [{
          title: "Character families & rarity",
          table: {
            caption: "Designed family distribution · the actual minted mix can vary",
            columns: ["Families", "Share per family"],
            rows: [["Skeleton, Mask, Family, Cellular, Asymmetry", "18% each"], ["Hoverer, Colossus, Sparkling, Hollow", "2.5% each"]],
          },
        }],
      },
    ],
  },
  terms: {
    title: "Terms",
    intro: "Terms of Use for software and interfaces provided by Tool 33, LLC.",
    format: "terms",
  },
  economy: {
    title: "Economy",
    intro: "Follow the payments, the reward shares and what stays with your NFT.",
    takeaway: "Rewards depend on funded activity and your share of active weight.",
    facts: [["Gameplay burn + rewards", "50% each"], ["WETH market fee", "5%"], ["Reward stream", "7 days"]],
    sections: [
      {
        id: "reward-share", title: "Your share of rewards",
        paragraphs: ["Each active Friend earns its weight divided by the total active weight across Genesis and Generations. Both collections share the same allocation method; there is no fixed equal split between collections."],
        note: "Example: 2,000,000 weight out of 20,000,000 is 10%. If 1,000 RF and 1 WETH stream while that share stays constant, the Friend earns 100 RF and 0.1 WETH.",
        items: [
          { title: "Funding", text: "Gameplay and reserve fees fund RF rewards. Protocol market fees fund WETH rewards. Rewards never mint new RF." },
          { title: "Timing", text: "RF and WETH stream separately over seven days. New funding waits for a later stream; someone must start it after the previous one ends, with funding and active weight available." },
          { title: "Competition", text: "More active weight reduces your percentage unless your weight also grows. Activation earns from that point forward, not rewards streamed before activation." },
        ],
      },
      {
        id: "claims", title: "Rewards stay with the Friend",
        paragraphs: ["Claims pay the NFT’s own wallet. Its owner controls those assets. Already-earned rewards remain claimable after deactivation and follow the NFT when it is sold.", "Claimed rewards are not automatically reinvested. Withdraw funds you want to keep before transferring the NFT."],
      },
      {
        id: "reserve", title: "The Genesis reserve",
        paragraphs: ["The reserve exchanges Genesis for existing RF and lets holders swap one Genesis for another in inventory. Reserve fees go entirely to RF rewards; none is burned."],
        table: {
          caption: "Reserve actions · RF amounts",
          columns: ["Action", "You provide", "You receive"],
          rows: [["Convert", "1 Genesis + 100,000 RF", "1,000,000 RF"], ["Oldest-inventory swap", "1 Genesis + 50,000 RF", "Oldest available Genesis"], ["Choose an NFT", "1 Genesis + 100,000 RF", "Chosen available Genesis"]],
        },
      },
    ],
  },
};

/** Shared documentation navigation and gallery labels. */
export const docsContent = {
  title: "docs",
  tagline: ["Tokens, Friends", "and the economy."],
  chapters: "Documentation chapters",
  takeaway: "how it works",
  onPage: "on this page",
  previous: "← previous",
  next: "next →",
  start: "back to start ↗",
  overview: "Overview",
  play: "play animations",
  pause: "pause animations",
} as const;
