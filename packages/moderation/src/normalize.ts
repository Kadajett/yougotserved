/**
 * Text normalisation, which has to run before any matching.
 *
 * Every word list in the world is defeated by the same trick: write the word
 * with characters that look Latin and are not. `а` is Cyrillic, `а` is not `a`,
 * and a filter comparing code points sees two unrelated strings. So the order
 * is always normalise, then match. A filter that matches raw input is theatre.
 *
 * Nothing here decides anything. It only produces the string the checks read.
 */

/** Invisible characters, used to break a word in half without showing a break. */
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤﻿]/g;

/** Marks stacked onto a letter. Many of them is the "zalgo" look. */
const COMBINING = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃰︠-︯]/g;

/**
 * Non-Latin characters that read as Latin ones.
 *
 * NFKC already folds fullwidth and mathematical alphabets, so this covers what
 * it leaves behind: Cyrillic and Greek letters that share a shape with Latin.
 * It is not the whole Unicode confusables table, which is enormous. It is the
 * part an abusive submission actually reaches for.
 */
const CONFUSABLES: Record<string, string> = {
  а: 'a',
  ᴀ: 'a',
  ɑ: 'a',
  α: 'a',
  λ: 'a',
  ь: 'b',
  в: 'b',
  β: 'b',
  ƅ: 'b',
  с: 'c',
  ϲ: 'c',
  ς: 'c',
  ᴄ: 'c',
  ԁ: 'd',
  ᴅ: 'd',
  е: 'e',
  ё: 'e',
  є: 'e',
  ε: 'e',
  ᴇ: 'e',
  ƒ: 'f',
  ɡ: 'g',
  ց: 'g',
  һ: 'h',
  ʜ: 'h',
  η: 'h',
  і: 'i',
  ї: 'i',
  ι: 'i',
  ɩ: 'i',
  ⅰ: 'i',
  ј: 'j',
  ʝ: 'j',
  к: 'k',
  κ: 'k',
  ӏ: 'l',
  ⅼ: 'l',
  ʟ: 'l',
  м: 'm',
  ᴍ: 'm',
  μ: 'm',
  ⅿ: 'm',
  п: 'n',
  η_: 'n',
  ɴ: 'n',
  ν: 'n',
  о: 'o',
  ο: 'o',
  σ: 'o',
  ø: 'o',
  ᴏ: 'o',
  օ: 'o',
  р: 'p',
  ρ: 'p',
  ᴘ: 'p',
  ԛ: 'q',
  г: 'r',
  ʀ: 'r',
  ᴦ: 'r',
  ѕ: 's',
  ș: 's',
  ꜱ: 's',
  т: 't',
  τ: 't',
  ᴛ: 't',
  ᴜ: 'u',
  υ: 'u',
  ц: 'u',
  ս: 'u',
  ѵ: 'v',
  ν_: 'v',
  ᴠ: 'v',
  ԝ: 'w',
  ᴡ: 'w',
  ω: 'w',
  х: 'x',
  χ: 'x',
  ⅹ: 'x',
  у: 'y',
  γ: 'y',
  ʏ: 'y',
  ᴢ: 'z',
  ᴣ: 'z',
};

export interface Normalised {
  /** Lowercased, folded, invisible characters gone. What the checks read. */
  text: string;
  /** How many invisible characters were removed. */
  invisible: number;
  /** How many combining marks were removed. */
  combining: number;
  /** How many characters were swapped for a Latin lookalike. */
  confusables: number;
  /**
   * Share of letters that were capitals, from 0 to 1.
   *
   * Measured here because `text` is lowercased below. A caps check reading the
   * folded string always finds zero, which is a rule that cannot ever fire.
   */
  caps: number;
  /** Letters seen before folding, so a caller can ignore very short strings. */
  letters: number;
}

export function normalise(input: string): Normalised {
  const invisible = input.match(INVISIBLE)?.length ?? 0;
  const combining = input.match(COMBINING)?.length ?? 0;

  const letters = (input.match(/\p{L}/gu) ?? []).length;
  const upper = (input.match(/\p{Lu}/gu) ?? []).length;
  const caps = letters > 0 ? upper / letters : 0;

  // NFKC folds fullwidth, mathematical and ligature forms onto plain letters.
  // It does nothing about Cyrillic, which is why the map below exists.
  let text = input.normalize('NFKC').replace(INVISIBLE, '').replace(COMBINING, '');

  let confusables = 0;
  text = [...text.toLowerCase()]
    .map((character) => {
      const swap = CONFUSABLES[character];
      if (swap) confusables++;
      return swap ?? character;
    })
    .join('');

  return { text, invisible, combining, confusables, caps, letters };
}

/**
 * Collapses runs of the same character: `heeeeello` becomes `heello`.
 *
 * Two are kept rather than one, so real doubled letters survive. Used only for
 * matching, never for anything the submitter gets shown back.
 */
export function collapseRuns(text: string): string {
  return text.replace(/(.)\1{2,}/gu, '$1$1');
}
