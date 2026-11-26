// Bungie's descriptions mark in-game glyphs in brackets; this turns them into plain words.
/**
 * Bungie's ability text marks in-game glyphs as "[Void]" or "[Grenade]". A glyph followed by its own
 * word ("[Void] Void shield") drops the glyph; a glyph used as a label ("[Super] : Create…") becomes
 * a bold label; any other glyph keeps its word without the brackets.
 */
export function gameText(text: string): { label?: string; text: string }[] {
  return text.split(/\n{2,}/).map((block) => {
    let t = block.trim().replace(/\[([A-Za-z][A-Za-z -]*)\]\s+(?=\1\b)/g, '');
    let label: string | undefined;
    const m = /^\[([A-Za-z][A-Za-z -]*)\]\s*:\s*/.exec(t);
    if (m) { label = m[1]; t = t.slice(m[0].length); }
    t = t.replace(/\[([A-Za-z][A-Za-z -]*)\]\s*:?\s*/g, (_, w: string, ) => `${w} `).replace(/ {2,}/g, ' ');
    return { label, text: t };
  }).filter((b) => b.text);
}
