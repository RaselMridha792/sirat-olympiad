/*
 * The demo marker domain, for the demo module. Payments' PR carries the one shared definition (DEMO_EMAIL_DOMAIN, without
 * '@', and isDemoEmail, in @sirat/shared registration.ts); until it is on main this file holds the same value, and then
 * becomes a re-export of it. The SQL in the *_demo_data_clear migration spells the same domain.
 */

export const DEMO_DOMAIN = 'demo.sirat.invalid';

/** The exact marker domain, any case. */
export const isDemoAddress = (email: string): boolean =>
  email.trim().toLowerCase().endsWith(`@${DEMO_DOMAIN}`);
