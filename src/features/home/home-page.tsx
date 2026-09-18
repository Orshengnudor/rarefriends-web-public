"use client";

import Link from "next/link";
import { Button } from "@/src/components/ui/button";
import { Icon } from "@/src/components/ui/icon";
import { GenesisPortrait } from "@/src/components/art/hero-face";
import { homeContent as copy } from "@/src/content/home";
import { FriendSprite } from "../../components/art/friend-sprite";
import { useProtocol } from "../protocol/protocol-provider";
import { RF_SYMBOL } from "../protocol/model";
import { ProtocolMetrics } from "./protocol-metrics";
import { SwapCard } from "./swap-card";

export function Homepage() {
  const { config } = useProtocol();
  return <div className="app-home">
    <section className="app-hero" aria-labelledby="app-hero-title">
      <div className="app-hero-heading"><div className="app-contract"><span>{RF_SYMBOL} CA</span><span className="app-contract-address">{config?.contracts.RF ?? copy.contractUnavailable}</span></div>
        <h1 id="app-hero-title">{copy.headline[0]}<br />{copy.headline[1]}</h1>
      </div>
      <div className="app-hero-companion app-hero-companion-left" aria-hidden="true"><FriendSprite specimen={4} size={96} /><span className="app-art-cross">+</span></div>
      <div className="app-hero-companion app-hero-companion-right" aria-hidden="true"><FriendSprite specimen={7} size={80} /><span className="app-art-cross">+</span></div>
      <SwapCard />
      <Link className="app-scroll" href="#protocol-stats">{copy.metricsLink} <Icon name="arrow-down" size={12} /></Link>
    </section>
    <ProtocolMetrics />
    <section id="how-it-works" className="app-journey">
      <div className="app-section-heading"><h2>{copy.howItWorks}</h2></div>
      <div className="app-steps">{copy.steps.map(step => <article className="app-step" key={step.title}><div className="app-step-top"><FriendSprite specimen={step.specimen} size={80} /></div><h3>{step.title}</h3><p>{step.body}</p><span className="app-step-label">{step.label}</span></article>)}</div>
      <div className="app-journey-link"><Button href="/portfolio" iconRight="arrow-right">{copy.portfolioLink}</Button></div>
    </section>
    <section className="app-collections">
      <article className="app-collection-story"><div className="app-story-copy"><h2>{copy.collections.genesis.title}</h2><p>{copy.collections.genesis.description}</p><Button href="/portfolio?collection=Genesis" iconRight="arrow-right" preserveCase>{copy.collections.genesis.action}</Button></div><div className="app-story-art app-story-genesis"><GenesisPortrait portrait={8} size={128} unframed /></div></article>
      <article className="app-collection-story" data-theme="invert"><div className="app-story-copy"><h2>{copy.collections.generations.title}</h2><p>{copy.collections.generations.description}</p><Button href="/portfolio?collection=Generations" iconRight="arrow-right" preserveCase>{copy.collections.generations.action}</Button></div><div className="app-story-art app-story-generations"><FriendSprite specimen={3} size={128} /><FriendSprite specimen={7} size={80} /></div></article>
    </section>
    <section className="app-faq"><div><h2>{copy.detailsHeading}</h2></div><div className="app-faq-items">{copy.faq.map(item => <details key={item.question}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div></section>
  </div>;
}

