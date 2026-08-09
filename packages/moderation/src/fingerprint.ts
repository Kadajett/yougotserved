/**
 * Content fingerprints, for banning the message instead of the sender.
 *
 * An address ban is a speed bump to anyone renting a proxy pool, and there is
 * no free control that makes it otherwise. What a rotating sender cannot rotate
 * is the thing being sent: the same pitch, the same link, the same wallet, over
 * and over, because sending it is the point. Fingerprinting the text gives a
 * ban that survives rotation, since it refuses the payload wherever it arrives
 * from.
 *
 * The digest is deliberately lossy. Word order is dropped, runs are folded, and
 * lookalike characters are already normalised away, so a reordered and repadded
 * version of the same message lands on the same value. That costs precision,
 * which is exactly why a fingerprint ban has to be a person's decision and never
 * an automatic one. Two unrelated submissions can collide, and the cheapest way
 * to be wrong here is to ban a word list.
 */

import { normalise } from './normalize.js';

/** Below this, a fingerprint describes a phrase rather than a submission. */
export const MIN_WORDS = 5;

/**
 * Squeezes every run to one character, unlike `collapseRuns`, which keeps two.
 *
 * The profanity pass keeps doubles so `heello` does not become a word nobody
 * wrote. Here the opposite is wanted: `cheeeap` and `cheap` have to land on the
 * same token, and the cost is that `followers` folds to `folowers` on both
 * sides of the comparison, which changes nothing.
 */
function squeeze(text: string): string {
  return text.replace(/(.)\1+/gu, '$1');
}

/**
 * Returns a stable digest for a body of text, or null when it is too short to
 * fingerprint safely.
 *
 * Short text is refused rather than hashed. A five-word minimum is not a strong
 * guarantee, but hashing "great tool thanks" would ban a sentiment.
 */
export async function fingerprint(input: string): Promise<string | null> {
  const words = new Set(squeeze(normalise(input ?? '').text).match(/[a-z0-9]{3,}/g) ?? []);
  if (words.size < MIN_WORDS) return null;

  const canonical = [...words].sort().join(' ');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
