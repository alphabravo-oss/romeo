/** Product build version exposed by Romeo-owned APIs and protocol clients. */
export const ROMEO_PRODUCT_VERSION = "0.1.0";

/** Compatibility protocol version used in Romeo-owned user-agent strings. */
export const ROMEO_PROTOCOL_VERSION = "0.1";

export function romeoUserAgent(component: string): string {
  return `Romeo-${component}/${ROMEO_PROTOCOL_VERSION}`;
}
