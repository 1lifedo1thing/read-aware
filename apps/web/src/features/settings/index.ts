/**
 * The settings feature's public surface for other features (see the
 * `features-via-public-index` dependency rule). Only what another feature
 * legitimately shares is exported here.
 */

// Imperative motion (programmatic scrolling, deferred transitions) honors the
// in-app Motion setting as well as the OS preference.
export { prefersReducedMotion } from "./lib/app-settings";
