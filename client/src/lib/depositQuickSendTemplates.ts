// Pre-written "1,500 USDT Deposit — Quick Explanations" message bodies used by
// the admin dashboard's deposit quick-send panel. Extracted out of
// AdminDashboard.tsx (a plain data/logic module, no JSX) to keep that file
// under its Babel byte budget — see .agents/memory/admin-dashboard-size-budget.md.
export interface DepositQuickSendTemplate {
  category: "urgent" | "processing" | "resolved";
  title: string;
  body: string;
  tone: string;
}

export function buildDepositQuickSendTemplates(
  amount: string,
  fee: string,
  refundable: string,
): DepositQuickSendTemplate[] {
  return [
    {
      category: "urgent",
      tone: "red",
      title: `Why a ${amount} USDT Activation Deposit Is Required`,
      body: `To release the funds in your case, the IBCCF settlement system must verify a live, on-chain wallet under your control. This is done by an Activation Deposit of ${amount} USDT (TRC-20).\n\nThe deposit is split into two parts as set out in the Declaration of Compliance:\n  •  ${refundable} USDT — refundable activation balance, returned to your wallet on compliance approval.\n  •  ${fee} USDT — non-refundable processing fee covering review, on-chain verification, and regulatory record-keeping.\n\nWithout this verification step, the settlement bank cannot legally route the recovered funds to an unverified wallet. Once the deposit is confirmed on-chain (typically under 3 minutes), your case is moved to the Final Release queue and the ${refundable} USDT refundable portion is returned to the same wallet — together with the recovered amount.`,
    },
    {
      category: "resolved",
      tone: "emerald",
      title: `How the ${refundable} USDT Refundable Portion Is Returned`,
      body: `Of the ${amount} USDT activation deposit, ${refundable} USDT is the refundable portion that is returned to the same wallet you deposit from on compliance approval.\n\nOnce the on-chain confirmation is registered (under 3 minutes on TRON / TRC-20) and the declaration is approved, the settlement engine releases:\n  •  Your ${refundable} USDT refundable activation balance\n  •  The recovered amount from your case\n\nThe ${fee} USDT processing fee is retained by the institution and is non-refundable, as you accepted in Section 7 of the declaration. The same wallet address you sent from is the one that receives the refundable portion and the recovery — you can verify the inbound transaction on Tronscan after release.`,
    },
    {
      category: "processing",
      tone: "amber",
      title: `Breakdown: The ${fee} USDT Non-Refundable Processing Fee`,
      body: `The ${amount} USDT deposit is structured as follows so you have full transparency:\n\n  •  ${refundable} USDT — Refundable activation balance held in the verification escrow and returned to your wallet on compliance approval.\n  •  ${fee} USDT — Non-refundable processing fee covering cross-chain conversion, network gas, settlement-bank FX spread, AML compliance review, on-chain verification, and regulatory record-keeping.\n\nThe ${fee} USDT processing fee is retained and is not returned with the refund — this is the same wording you accepted in Section 7 of the Declaration of Compliance. Only the ${refundable} USDT activation balance is refundable.`,
    },
    {
      category: "processing",
      tone: "amber",
      title: "Step-by-Step: How Your Deposit Is Verified and Refunded",
      body: `Here is exactly what happens after you submit the deposit:\n\n  1.  You send ${amount} USDT (TRC-20) to the deposit address shown in your portal.\n  2.  The TRON network confirms the transaction (typically 1-3 minutes, 19+ block confirmations).\n  3.  Our settlement gateway whitelists your wallet address against the case ID and the compliance team reviews your declaration.\n  4.  Once approved, the case is advanced to "Final Release" queue.\n  5.  The settlement broadcasts back to the same wallet: the recovered amount plus the ${refundable} USDT refundable portion of the deposit.\n  6.  The ${fee} USDT processing fee is retained as the non-refundable review fee.\n\nThe declaration must be approved before any refund is released; no on-chain confirmation alone triggers a refund.`,
    },
    {
      category: "resolved",
      tone: "emerald",
      title: "Your Funds Are Held Under Regulatory Escrow & Audit Trail",
      body: `IBCCF operates under a regulated settlement framework. Your activation deposit is:\n\n  •  Held in a segregated, audited escrow account — NOT in a private wallet.\n  •  Logged in the IBCCF case audit trail with timestamp, txid, and amount.\n  •  Returned in part — the ${refundable} USDT refundable portion is released back to YOUR wallet (the same address you sent from) on compliance approval.\n  •  Subject to a ${fee} USDT non-refundable processing fee that is retained by the institution as set out in Section 7 of the declaration.\n\nIf the declaration is rejected, the refundable portion is forfeited as described in the regulatory terms; if it is approved, only the refundable ${refundable} USDT is released. The ${fee} USDT processing fee is non-refundable in either case.`,
    },
  ];
}
