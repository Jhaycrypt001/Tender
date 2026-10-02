import type { z } from "zod";
import type * as S from "../../contract/schemas.js";
import type { Db } from "../db/client.js";
import type { PaymentLink } from "../generated/prisma/client.js";
import { notFound, validation } from "../lib/errors.js";
import { linkId, linkToken } from "../lib/ids.js";
import { isAmount } from "../lib/money.js";
import { createInvoice, type InvoiceDeps } from "./invoice.service.js";
import { amount } from "./serialize.js";

/**
 * Reusable payment links. One link, many buyers: each buyer who opens it gets
 * a fresh invoice — and so fresh deposit addresses — which keeps every
 * payment attributable to exactly one invoice.
 */

export async function createLink(db: Db, merchantId: string, input: z.output<typeof S.CreateLinkInput>) {
  const currency = input.currency.toUpperCase();
  if (currency !== "USD" && currency !== "USDC") throw validation({ currency: "must be USD or USDC" });
  return db.paymentLink.create({
    data: {
      id: linkId(),
      token: linkToken(),
      merchantId,
      label: input.label,
      amount: input.amount ?? null,
      currency,
    },
  });
}

export async function listLinks(db: Db, merchantId: string, cursor: string | undefined, limit = 20) {
  const rows = await db.paymentLink.findMany({
    where: { merchantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return { page, hasMore, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
}

const LINK_TOKEN = /^pl_[0-9A-Za-z]{27}$/;

/**
 * What the buyer may see before opening a link. Read-only: it creates no
 * invoice and does not touch `uses`. An inactive link is still returned, with
 * `active: false`, so the page can say it was turned off rather than 404.
 */
export async function getPublicLink(db: Db, token: string): Promise<z.output<typeof S.PublicLink>> {
  if (!LINK_TOKEN.test(token)) throw notFound("Payment link");
  const link = await db.paymentLink.findUnique({ where: { token }, include: { merchant: { select: { name: true } } } });
  if (!link) throw notFound("Payment link");
  return {
    label: link.label,
    amount: link.amount ? amount(link.amount) : null,
    currency: link.currency,
    merchant_name: link.merchant.name,
    active: link.active,
  };
}

/**
 * A buyer opens a link: create their invoice. The link's fixed amount wins;
 * an open-amount link takes the buyer's.
 */
export async function openLink(deps: InvoiceDeps, token: string, buyerAmount: string | undefined) {
  if (!LINK_TOKEN.test(token)) throw notFound("Payment link");
  const link = await deps.db.paymentLink.findUnique({ where: { token }, include: { merchant: true } });
  if (!link || !link.active) throw notFound("Payment link");

  const value = link.amount ? link.amount.toString() : buyerAmount;
  if (!value || !isAmount(value) || /^0(\.0+)?$/.test(value)) {
    throw validation({ amount: "this link needs an amount greater than zero, e.g. \"25.00\"" });
  }

  // Count the use first: the new count names this invoice's reference, so two
  // buyers opening the link at the same moment get distinct invoices.
  const { uses } = await deps.db.paymentLink.update({ where: { id: link.id }, data: { uses: { increment: 1 } }, select: { uses: true } });
  const { invoice } = await createInvoice(deps, link.merchant, {
    amount_expected: value,
    currency: link.currency,
    reference: `link:${link.id}:${uses}`,
    metadata: { payment_link: link.id },
  });
  return invoice;
}

export function toLink(l: PaymentLink): z.output<typeof S.PaymentLink> {
  return {
    id: l.id,
    token: l.token,
    label: l.label,
    amount: l.amount ? amount(l.amount) : null,
    currency: l.currency,
    active: l.active,
    uses: l.uses,
    created_at: l.createdAt.toISOString(),
  };
}

