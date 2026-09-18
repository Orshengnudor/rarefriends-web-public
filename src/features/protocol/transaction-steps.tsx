import { transactionContent as copy } from "@/src/content/transactions";
import type { PreparedPlan } from "./types";
import type { TransactionProgress } from "./transaction-client";

export function TransactionSteps({ plan, progress, selling = false }: { plan?: PreparedPlan; progress: TransactionProgress | null; selling?: boolean }) {
  const steps = [...(plan?.steps.map(step => step.label) ?? []), ...(selling && plan ? [copy.unwrap] : [])];
  return <div className="app-transaction-steps" aria-live="polite">
    {!plan ? <p>{copy.preparing}</p> : <ol>{steps.map((label, index) => <li key={`${index}-${label}`} data-active={progress?.step === index + 1 || undefined}><span>{index + 1}</span><strong>{label}</strong></li>)}</ol>}
    {progress && <p role="status">{progress.label}</p>}
  </div>;
}

