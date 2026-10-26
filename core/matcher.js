export function makeMatcher(options) {
  const query = options.query.normalize("NFC");
  let source = options.regex
    ? query
    : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (options.wholeWord)
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  const expression = new RegExp(source, options.caseSensitive ? "gu" : "giu");
  return (raw, limit = 200) => {
    const text = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
    expression.lastIndex = 0;
    const ranges = [];
    let match;
    while (ranges.length < limit && (match = expression.exec(text))) {
      if (match[0].length)
        ranges.push({ start: match.index, end: match.index + match[0].length });
      else {
        // Advance by a full code point for zero-length Unicode regex matches.
        const cp = text.codePointAt(expression.lastIndex);
        expression.lastIndex += cp > 0xffff ? 2 : 1;
      }
    }
    return { text, ranges };
  };
}

export function snippets(text, ranges, budget = 6) {
  const groups = [];
  for (const range of ranges) {
    const start = Math.max(0, range.start - 75);
    const end = Math.min(text.length, range.end + 110, start + 1200);
    const previous = groups.at(-1);
    if (previous && start <= previous.end)
      previous.end = Math.min(
        previous.start + 1200,
        Math.max(previous.end, end),
      );
    else if (groups.length < budget) groups.push({ start, end });
  }
  return groups.map((group) => ({
    text: text.slice(group.start, group.end),
    prefix: group.start > 0,
    suffix: group.end < text.length,
    ranges: ranges
      .filter((r) => r.start < group.end && r.end > group.start)
      .map((r) => ({
        start: Math.max(r.start, group.start) - group.start,
        end: Math.min(r.end, group.end) - group.start,
      })),
  }));
}
