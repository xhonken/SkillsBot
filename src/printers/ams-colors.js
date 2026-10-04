import { PNG } from "pngjs";
import { safeText } from "../messages.js";

// Small bitmap labels keep rendering portable on a headless Raspberry Pi.
const FONT = {
  0: [14, 17, 19, 21, 25, 17, 14],
  1: [4, 12, 4, 4, 4, 4, 14],
  2: [14, 17, 1, 2, 4, 8, 31],
  3: [30, 1, 1, 14, 1, 1, 30],
  4: [2, 6, 10, 18, 31, 2, 2],
  5: [31, 16, 16, 30, 1, 1, 30],
  6: [14, 16, 16, 30, 17, 17, 14],
  7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 1, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  E: [31, 16, 16, 30, 16, 16, 31],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  Y: [17, 17, 10, 4, 4, 4, 4],
  "-": [0, 0, 0, 31, 0, 0, 0],
  "?": [14, 17, 1, 2, 4, 0, 4],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

export function parseFilamentColor(value) {
  if (typeof value !== "string") return null;
  const hex = value.replace(/^#/, "");
  if (!/^(?:[a-f0-9]{6}|[a-f0-9]{8})$/i.test(hex)) return null;
  return [0, 2, 4, 6].map((offset) =>
    offset === 6 && hex.length === 6
      ? 255
      : Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
}

export function describeFilamentColor(value) {
  const color = parseFilamentColor(value);
  if (!color) return "? Unknown";
  const [r, g, b, alpha] = color;
  if (alpha < 32) return "▫ Transparent";
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const delta = high - low;
  let description;
  if (high < 56) description = "⬛ Black";
  else if (low > 224 && delta < 25) description = "⬜ White";
  else if (delta < high * 0.07) description = "◻ Gray";
  else {
    let hue =
      high === r
        ? ((g - b) / delta) % 6
        : high === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
    const lightness = (high + low) / 510;
    // Group shades under a basic color symbol while retaining useful names.
    if (hue >= 15 && hue < 65 && lightness > 0.78) description = "⬜ Beige";
    else if (hue >= 15 && hue < 55 && lightness < 0.45)
      description = "🟫 Brown";
    else if (hue < 15 || hue >= 345) description = "🟥 Red";
    else if (hue < 45) description = "🟧 Orange";
    else if (hue < 70) description = "🟨 Yellow";
    else if (hue < 165) description = "🟩 Green";
    else if (hue < 195) description = "🟦 Turquoise";
    else if (hue < 255) description = "🟦 Blue";
    else if (hue < 290) description = "🟪 Purple";
    else description = "🟪 Pink";
  }
  return description + (alpha < 255 ? " (transparent)" : "");
}

function rectangle(png, x, y, width, height, color) {
  for (let row = y; row < y + height; row++) {
    for (let column = x; column < x + width; column++) {
      if (row < 0 || row >= png.height || column < 0 || column >= png.width)
        continue;
      const offset = (row * png.width + column) * 4;
      for (let channel = 0; channel < 4; channel++)
        png.data[offset + channel] = color[channel];
    }
  }
}

function label(png, value, x, y, scale = 2) {
  const color = [27, 34, 48, 255];
  for (const [index, char] of [...String(value).slice(0, 16)].entries()) {
    const glyph = FONT[char] || FONT["?"];
    for (let row = 0; row < 7; row++)
      for (let column = 0; column < 5; column++)
        if (glyph[row] & (1 << (4 - column)))
          rectangle(
            png,
            x + (index * 6 + column) * scale,
            y + row * scale,
            scale,
            scale,
            color,
          );
  }
}

export function renderAMSColors(status) {
  const units = status.ams;
  if (
    ["unavailable", "disabled"].includes(status.state) ||
    !Array.isArray(units) ||
    !units.length ||
    units.length > 32 ||
    units.some((unit) => !Array.isArray(unit.trays) || unit.trays.length > 4) ||
    !units.some((unit) =>
      unit.trays.some(
        (tray) => tray.present !== false && parseFilamentColor(tray.color),
      ),
    )
  )
    return null;

  const png = new PNG({ width: 640, height: 40 + units.length * 154 });
  rectangle(png, 0, 0, png.width, png.height, [245, 247, 250, 255]);
  for (const [row, unit] of units.entries()) {
    const top = 20 + row * 154;
    label(png, `AMS ${String(unit.id).slice(0, 8)}`, 24, top, 3);
    for (const [column, tray] of unit.trays.entries()) {
      const x = 24 + column * 148;
      const y = top + 32;
      rectangle(png, x, y, 128, 94, [151, 160, 176, 255]);
      rectangle(png, x + 2, y + 2, 124, 90, [255, 255, 255, 255]);
      const color =
        tray.present === false ? null : parseFilamentColor(tray.color);
      for (let dy = 0; dy < 62; dy++) {
        for (let dx = 0; dx < 124; dx++) {
          const background =
            (Math.floor(dx / 8) + Math.floor(dy / 8)) % 2 ? 220 : 242;
          const alpha = color ? color[3] / 255 : 0;
          const pixel = [0, 1, 2].map((channel) =>
            Math.round(
              (color?.[channel] ?? 0) * alpha + background * (1 - alpha),
            ),
          );
          rectangle(png, x + 2 + dx, y + 2 + dy, 1, 1, [...pixel, 255]);
        }
      }
      if (!color)
        label(png, tray.present === false ? "EMPTY" : "?", x + 34, y + 24, 3);
      label(png, `SLOT ${String(tray.id).slice(0, 3)}`, x + 10, y + 74, 2);
    }
  }
  return PNG.sync.write(png, { colorType: 2, deflateLevel: 6 });
}

export function amsColorAttachment(id, name, status) {
  const image = renderAMSColors(status);
  if (!image) return null;
  const filename =
    String(id)
      .replace(/[^a-z0-9_-]/gi, "")
      .slice(0, 48) || "printer";
  return {
    attachment: image,
    name: `ams-colors-${filename}.png`,
    description: `Filament colors for ${safeText(name)}, ordered by AMS ID and slot. EMPTY marks an empty slot and ? an unknown color. The checkerboard indicates reported transparency.`,
  };
}
