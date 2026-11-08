import type { CheckoutGateway } from '@sirat/shared';

/*
 * Which checkout URL the browser may follow (pure, for node --test). goToCheckout in registration-api.ts is the only
 * caller.
 */

/** A checkout to send the browser to: the API's answer from start, retry or resume. */
export type Checkout = { paymentUrl: string; gateway?: CheckoutGateway };

/**
 * The checkout URL the browser may follow, or null. The URL comes from our API, but a page never navigates to a scheme
 * it did not expect:
 * - 'paystation': https only, in every build;
 * - 'fake' (the dev/CI fake server; the API sends it only in fake mode, which it refuses in production): https or http;
 * - never a relative URL, javascript:, data: or any other scheme, and never an unknown gateway. An answer without a
 *   gateway (an older API during a deploy) counts as 'paystation', the strict case.
 */
export function checkoutUrl(paymentUrl: string, gateway: unknown = 'paystation'): string | null {
  let url: URL;
  try {
    url = new URL(paymentUrl);
  } catch {
    return null;
  }
  if (gateway === 'paystation') return url.protocol === 'https:' ? url.toString() : null;
  if (gateway === 'fake')
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  return null;
}
