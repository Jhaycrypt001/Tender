/**
 * The Tender API client.
 *
 * ⚠️ Import from the specific module, not from here, in client components.
 * This barrel pulls in the merchant-authenticated modules, and a client
 * component that imports it drags the key-bearing code path into the browser
 * bundle. The buyer checkout should import `./public` directly.
 */

export * from "./types";
export { isApiConfigured, publicBase } from "./client";

export * as invoices from "./invoices";
export * as payments from "./payments";
export * as merchant from "./merchant";
export * as links from "./links";
export * as earn from "./earn";
export * as ramps from "./ramps";
export * as publicApi from "./public";
