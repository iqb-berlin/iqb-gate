import type { verifySolution } from 'altcha-lib';

type VerifyOptions = Parameters<typeof verifySolution>[0];

/** A solved challenge as the ALTCHA widget hands it over, ready for `verifySolution`. */
export interface AltchaPayload {
  challenge: { parameters: VerifyOptions['challenge']['parameters']; signature: string };
  solution: VerifyOptions['solution'];
}

/**
 * Reads the ALTCHA widget's payload: base64-encoded JSON of `{ challenge: { parameters, signature },
 * solution }`. `null` for anything else, including the widget's test mode, which hands over no
 * challenge at all. Whether the solution holds is `verifySolution`'s question, not this one.
 */
export function decodeAltchaPayload(payload: string): AltchaPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    const challenge = parsed?.challenge;
    const solution = parsed?.solution;
    if (!challenge?.parameters || typeof challenge.signature !== 'string' || !solution) return null;
    return { challenge, solution };
  } catch {
    return null;
  }
}
