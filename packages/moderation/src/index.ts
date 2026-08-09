/**
 * Abuse checks for user-submitted text.
 *
 * Deterministic, dependency-light, and free to run. It works in a Worker, in
 * Node, and in a TanStack Start server function, because it touches nothing but
 * the string it was handed.
 *
 * It returns findings and a score, never a bare boolean. A moderation queue has
 * to tell a person why something was held, and an appeal has to be arguable.
 *
 * What this cannot do, stated here so nobody assumes otherwise: it does not
 * read intent, it does not know what a pack's steps do, and it will not stop a
 * patient human. It raises the cost of the cheap attacks, which is most of them.
 */

import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { collapseRuns, normalise } from './normalize.js';
import { scoreSpam, type Finding, type SpamOptions } from './spam.js';
import { reviewUrls } from './urls.js';

export { normalise, collapseRuns } from './normalize.js';
export { fingerprint, MIN_WORDS } from './fingerprint.js';
export { scoreSpam } from './spam.js';
export { reviewUrls, hostOf } from './urls.js';
export type { Finding } from './spam.js';
export type { Normalised } from './normalize.js';
export type { UrlVerdict } from './urls.js';

/**
 * `block` is refused outright. `review` is accepted and held for a person.
 *
 * The middle state matters. A filter with only two answers either loses real
 * submissions or lets real abuse through, and the author never finds out which.
 */
export type Severity = 'allow' | 'review' | 'block';

export interface Verdict {
  severity: Severity;
  /** Sum of finding weights. Shown to moderators, not to submitters. */
  score: number;
  findings: Finding[];
  /** The folded text the checks actually read. Useful when a result surprises you. */
  normalised: string;
}

export interface ReviewOptions extends SpamOptions {
  /** Score at which text is held for a person. */
  reviewAt?: number;
  /** Score at which text is refused. */
  blockAt?: number;
  /** Treat profanity as worth refusing rather than holding. */
  strictProfanity?: boolean;
}

// Built once. The matcher compiles its patterns, so rebuilding it per request
// would be the most expensive thing in this file.
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

/**
 * Runs every check over one piece of text.
 *
 * Order matters: normalise first, always. Matching raw input is how `аss` with
 * a Cyrillic first letter walks past a word list unchallenged.
 */
export function review(input: string, options: ReviewOptions = {}): Verdict {
  const reviewAt = options.reviewAt ?? 3;
  const blockAt = options.blockAt ?? 7;

  const source = normalise(input ?? '');
  const findings = scoreSpam(source, options);

  // Runs are collapsed only for the profanity pass, so `fuuuuck` is caught
  // without `heello` becoming a word nobody wrote.
  const matches = matcher.getAllMatches(collapseRuns(source.text));
  if (matches.length > 0) {
    const words = new Set<string>();
    for (const match of matches) {
      const word = englishDataset.getPayloadWithPhraseMetadata(match).phraseMetadata?.originalWord;
      if (typeof word === 'string') words.add(word);
    }
    findings.push({
      rule: 'profanity',
      detail: `${matches.length} match(es)${words.size ? `: ${[...words].join(', ')}` : ''}`,
      weight: options.strictProfanity ? blockAt : 4,
    });
  }

  // The spam rules count links. This looks at where they point, which is a
  // different question: one link to a redirector says more than five to a blog.
  // Read off the raw input, because normalisation folds the lookalikes that are
  // the whole signal for a host written to be misread.
  const links = input?.match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi) ?? [];
  if (links.length > 0) findings.push(...reviewUrls(links).findings);

  const score = findings.reduce((total, finding) => total + finding.weight, 0);
  const severity: Severity = score >= blockAt ? 'block' : score >= reviewAt ? 'review' : 'allow';

  return { severity, score, findings, normalised: source.text };
}

/**
 * Reviews several fields and returns the worst answer.
 *
 * A pack has a name, a description, and a description per tool. Judging them
 * one at a time lets a submission hide in the field nobody reads.
 */
export function reviewFields(
  fields: Record<string, string | undefined>,
  options: ReviewOptions = {},
): Verdict & { field?: string } {
  const rank: Record<Severity, number> = { allow: 0, review: 1, block: 2 };
  let worst: (Verdict & { field?: string }) | null = null;

  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    const verdict = review(value, options);
    const beats =
      !worst ||
      rank[verdict.severity] > rank[worst.severity] ||
      (rank[verdict.severity] === rank[worst.severity] && verdict.score > worst.score);
    if (beats) worst = { ...verdict, field };
  }

  return worst ?? { severity: 'allow', score: 0, findings: [], normalised: '' };
}
