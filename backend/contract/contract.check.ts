/**
 * Compile-time proof that the backend's schemas match the frontend's types.
 *
 * Nothing here runs. `npm run typecheck` fails if any pair below disagrees:
 * a renamed field, a missing field, a changed enum, a number where a string
 * belongs. Fix the drift by talking to the other half, not by editing this file.
 */
import type { z } from "zod";
import type * as Wire from "../../frontend/src/lib/api/types.js";
import type * as S from "./schemas.js";

/** Same set of top-level keys, and each type assignable to the other. */
type Matches<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? [A] extends [B]
      ? [B] extends [A]
        ? true
        : false
      : false
    : false
  : false;

type Assert<T extends true> = T;
type In<T extends z.ZodType> = z.input<T>;
type Out<T extends z.ZodType> = z.output<T>;

export type Checks = [
  Assert<Matches<Out<typeof S.InvoiceStatus>, Wire.InvoiceStatus>>,
  Assert<Matches<Out<typeof S.PaymentStatus>, Wire.PaymentStatus>>,
  Assert<Matches<Out<typeof S.InvoiceAddress>, Wire.InvoiceAddress>>,
  Assert<Matches<Out<typeof S.Invoice>, Wire.Invoice>>,
  Assert<Matches<In<typeof S.CreateInvoiceInput>, Wire.CreateInvoiceInput>>,
  Assert<Matches<Out<typeof S.Payment>, Wire.Payment>>,
  Assert<Matches<Out<typeof S.RecoveryTask>, Wire.RecoveryTask>>,
  Assert<Matches<Out<typeof S.PaymentDetail>, Wire.PaymentDetail>>,
  Assert<Matches<Out<typeof S.Merchant>, Wire.Merchant>>,
  Assert<Matches<In<typeof S.UpdateMerchantInput>, Wire.UpdateMerchantInput>>,
  Assert<Matches<Out<typeof S.Balance>, Wire.Balance>>,
  Assert<Matches<Out<typeof S.SettlementChallenge>, Wire.SettlementChallenge>>,
  Assert<Matches<Out<typeof S.PaymentLink>, Wire.PaymentLink>>,
  Assert<Matches<In<typeof S.CreateLinkInput>, Wire.CreateLinkInput>>,
  Assert<Matches<Out<typeof S.EarnPosition>, Wire.EarnPosition>>,
  Assert<Matches<Out<typeof S.RampCorridor>, Wire.RampCorridor>>,
  Assert<Matches<Out<typeof S.PublicInvoice>, Wire.PublicInvoice>>,
  Assert<Matches<Out<typeof S.Chain>, Wire.Chain>>,
  Assert<Matches<Out<typeof S.InvoiceEvent>, Wire.InvoiceEvent>>,
  Assert<Matches<Out<typeof S.ListInvoicesQuery>, Wire.ListInvoicesQuery>>,
  Assert<Matches<Out<typeof S.ListPaymentsQuery>, Wire.ListPaymentsQuery>>,
  // Added 2026-10-02: API keys, webhook deliveries, link preview.
  Assert<Matches<Out<typeof S.ApiKeySummary>, Wire.ApiKeySummary>>,
  // Added 2026-10-05: sending money out of the merchant's own wallet.
  Assert<Matches<Out<typeof S.TransferKind>, Wire.TransferKind>>,
  Assert<Matches<Out<typeof S.TransferStatus>, Wire.TransferStatus>>,
  Assert<Matches<Out<typeof S.TransferLine>, Wire.TransferLine>>,
  Assert<Matches<Out<typeof S.TransferAuthorization>, Wire.TransferAuthorization>>,
  Assert<Matches<Out<typeof S.Transfer>, Wire.Transfer>>,
  Assert<Matches<In<typeof S.PrepareTransferBody>, Wire.PrepareTransferInput>>,
  Assert<Matches<Out<typeof S.SubmitTransferBody>, Wire.SubmitTransferInput>>,
  Assert<Matches<Out<typeof S.WalletBalance>, Wire.WalletBalance>>,
  Assert<Matches<Out<typeof S.ApiKeyList>, Wire.ApiKeyList>>,
  Assert<Matches<Out<typeof S.CreatedApiKey>, Wire.CreatedApiKey>>,
  Assert<Matches<Out<typeof S.RotatedWebhookSecret>, Wire.RotatedWebhookSecret>>,
  Assert<Matches<Out<typeof S.WebhookDeliveryStatus>, Wire.WebhookDeliveryStatus>>,
  Assert<Matches<Out<typeof S.WebhookDelivery>, Wire.WebhookDelivery>>,
  Assert<Matches<Out<typeof S.WebhookDeliveryList>, Wire.WebhookDeliveryList>>,
  Assert<Matches<Out<typeof S.PublicLink>, Wire.PublicLink>>,
];
