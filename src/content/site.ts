/** Shared brand, navigation, metadata, and application shell copy. */
export const siteContent = {
  name: "Rare Friends",
  wordmark: "rare friends",
  description: "Trade $RAREFRIENDS, manage your Rare Friends portfolio, and explore the protocol economy.",
  url: "https://rarefriends.com",
  pages: {
    home: { title: "Digital Friends with Crypto" },
    auction: { title: "Settle and claim $RAREFRIENDS" },
    portfolio: { title: "Your portfolio" },
  },
  links: { genesisMarket: "https://opensea.io/collection/rare-friends-genesis/" },
  navigation: [
    { href: "/", label: "swap" },
    { href: "/portfolio", label: "portfolio" },
    { href: "/launch", label: "auction & claims" },
    { href: "/docs", label: "docs" },
  ],
  footerNavigation: [{ href: "/docs/terms", label: "Terms" }],
  marketLink: { label: "OpenSea ↗", ariaLabel: "Genesis collection on OpenSea" },
  theme: { label: "dark mode", light: "Switch to light mode", dark: "Switch to dark mode" },
  wallet: { title: "your wallet", connect: "connect wallet", connecting: "connecting" },
  skipLink: "skip to content",
  errors: {
    title: "This page is temporarily unavailable.",
    description: "Please try again.",
    retry: "try again",
    notFoundTitle: "Nothing at that address.",
    notFoundDescription: "the page does not exist · check the link or start again",
    home: "go home",
  },
} as const;
