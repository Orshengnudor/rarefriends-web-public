import { Progress } from "@/src/components/ui/progress";
import type { PortfolioFriend } from "../protocol/model";

export function FriendCapacity({ friend }: { friend: PortfolioFriend }) {
  if (friend.collection === "Genesis") return null;
  const tier = Math.max(0, Math.min(4, friend.tier));
  const tierSlots = tier + 1;

  return <div className="app-pf-capacity" aria-label={`${friend.collection} #${friend.id} capacity`}>
    <Progress size="lg" blocks={5} value={tierSlots / 5}
      label={`tier ${tier}`} meta={`${tierSlots}/5`}
      aria-label={`${friend.collection} #${friend.id} tier capacity`}
      aria-valuetext={`${tierSlots} of 5 segments filled, tier ${tier}${friend.activated ? "" : ", not earning"}`} />
  </div>;
}
