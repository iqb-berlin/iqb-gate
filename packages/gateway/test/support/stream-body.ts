/**
 * What `fetch` needs to send a body as a stream. Spread into the options rather than written there:
 * vitest pulls in the DOM typings (through its optional jsdom types), which do not know `duplex`.
 */
export const STREAM_BODY = { duplex: 'half' } as const;
