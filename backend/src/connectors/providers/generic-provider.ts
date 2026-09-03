import type { OtaDefinition } from '@cm/shared';
import { BaseConnector } from '../base-connector';

/**
 * Stub connector for a real OTA. Extends BaseConnector, so every method throws a
 * clear NotImplementedError pointing at the provider docs until the integration
 * is built. Instantiated for every entry in the OTA catalogue that doesn't have
 * a dedicated implementation file yet.
 *
 * To implement a provider for real:
 *   1. copy this file to `<code>-provider.ts`
 *   2. override `testConnection`, `pushAri`, `fetchBookings` (+ `parseWebhook`)
 *      using `this.http(...)` and `ctx.credentials`
 *   3. register the class in `providers/index.ts`
 */
export class GenericProviderConnector extends BaseConnector {
  readonly definition: OtaDefinition;
  constructor(def: OtaDefinition) {
    super();
    this.definition = def;
  }
}
