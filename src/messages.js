export function safeText(value) {
  return String(value)
    .replace(/[\r\n]+/g, " ")
    .replace(/[@*_`~<>|\\]/g, "")
    .slice(0, 350);
}

export function codeText(value) {
  return String(value ?? "–")
    .replace(/\r\n?/g, "\n")
    .replace(/[`@\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\t/g, " ");
}

export function wrapText(value, width = 64) {
  if (!Number.isInteger(width) || width < 1)
    throw new RangeError("Line width must be a positive integer.");
  const result = [];
  for (let line of codeText(value).split("\n")) {
    while (line.length > width) {
      const space = line.lastIndexOf(" ", width);
      const end = space > 0 ? space : width;
      result.push(line.slice(0, end));
      line = line.slice(end).trimStart();
    }
    result.push(line);
  }
  return result;
}

export function codeBox(title, body) {
  return `**${safeText(title)}**\n\`\`\`text\n${codeText(body).trimEnd()}\n\`\`\``;
}

export function table(columns, rows, { headings = true } = {}) {
  const values = rows.map((row) =>
    columns.map((_, index) => codeText(row[index])),
  );
  const widths = columns.map((column, index) =>
    Math.max(
      column.label.length,
      Math.min(
        column.maxWidth ?? 40,
        Math.max(
          1,
          ...values.flatMap((row) =>
            row[index].split("\n").map((line) => line.length),
          ),
        ),
      ),
    ),
  );
  const render = (row) => {
    const cells = row.map((value, index) => wrapText(value, widths[index]));
    return Array.from(
      { length: Math.max(...cells.map((cell) => cell.length)) },
      (_, line) =>
        cells
          .map((cell, index) => {
            const value = cell[line] ?? "";
            return columns[index].align === "right"
              ? value.padStart(widths[index])
              : value.padEnd(widths[index]);
          })
          .join("  ")
          .trimEnd(),
    );
  };
  return [
    ...(headings
      ? [
          ...render(columns.map((column) => column.label)),
          widths.map((width) => "─".repeat(width)).join("  "),
        ]
      : []),
    ...values.flatMap(render),
  ].join("\n");
}

export function fields(rows) {
  return table(
    [
      { label: "", maxWidth: 18 },
      { label: "", maxWidth: 48 },
    ],
    rows,
    { headings: false },
  );
}

export function chunks(content, limit = 1900) {
  if (!Number.isInteger(limit) || limit < 16)
    throw new RangeError("Message limit must be an integer of at least 16.");
  const result = [];
  let current = "";
  let fence = "";
  const append = (part) => {
    current += (current ? "\n" : "") + part;
  };
  const flush = () => {
    result.push(current + (fence ? "\n```" : ""));
    current = fence;
  };
  for (const line of content.split("\n")) {
    const nextFence =
      line === "```" && fence
        ? ""
        : !fence && /^```[\w-]*$/.test(line)
          ? line
          : fence;
    const reserve = nextFence ? 4 : 0;
    if (nextFence.length + reserve + 1 >= limit)
      throw new RangeError("Code fence is too long for the message limit.");
    const capacity = () => limit - (current ? current.length + 1 : 0) - reserve;
    if (current && current !== fence && line.length > capacity()) flush();
    let rest = line;
    while (rest.length > capacity()) {
      const size = capacity();
      append(rest.slice(0, size));
      rest = rest.slice(size);
      flush();
    }
    append(rest);
    fence = nextFence;
  }
  if (current) result.push(current + (fence ? "\n```" : ""));
  return result;
}

export async function reply(message, content, { files = [] } = {}) {
  if (!/^```/m.test(content))
    content = codeBox("SkillsBot", wrapText(content).join("\n"));
  for (const [index, part] of chunks(content).entries()) {
    await message.reply({
      content: part,
      allowedMentions: { parse: [], repliedUser: false },
      ...(index === 0 && files.length ? { files } : {}),
    });
  }
}
