export type ReserveGates = {
  retired: boolean;
  conversionEnabled: boolean;
  marketSeeded: boolean;
  rfBalance: string;
  conversionPayout: string;
};

/** The deposit fee is forwarded to rewards; it cannot supply the RF payout backing. */
export function reserveAvailability(state: ReserveGates) {
  const reasons = [
    ...(state.retired ? ["This Reserve is permanently retired."] : []),
    ...(!state.conversionEnabled ? ["Genesis conversion is disabled."] : []),
    ...(!state.marketSeeded ? ["Market seeding is required."] : []),
    ...(BigInt(state.rfBalance) < BigInt(state.conversionPayout) ? ["Insufficient RF backing for the conversion payout."] : []),
  ];
  return {
    conversionAvailable: reasons.length === 0,
    conversionReasons: reasons,
    // NFT swaps have no RF payout and do not use the conversion switch.
    swapsAvailable: !state.retired && state.marketSeeded,
  };
}
