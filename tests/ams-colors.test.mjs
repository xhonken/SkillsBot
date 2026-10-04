import test from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import {
  parseFilamentColor,
  describeFilamentColor,
  renderAMSColors,
} from "../src/printers/ams-colors.js";
import { status } from "../src/printers/status.js";

function report() {
  return status({
    state: "idle",
    ams: [
      {
        id: "0",
        trays: [
          { id: "0", color: "FF0000FF" },
          { id: "1", color: "000000FF" },
          { id: "2", color: "FFFFFFFF" },
          { id: "3", color: "00FF00FF", present: false },
        ],
      },
      {
        id: "1",
        trays: [
          { id: "0", color: "0000FFFF" },
          { id: "1", color: "not-a-color" },
          { id: "2", color: "FF000080" },
        ],
      },
    ],
  });
}

function pixel(png, x, y) {
  const offset = (y * png.width + x) * 4;
  return [...png.data.subarray(offset, offset + 4)];
}

test("filament colors accept RGB and RGBA and reject arbitrary values", () => {
  assert.deepEqual(parseFilamentColor("#c12e1f"), [193, 46, 31, 255]);
  assert.deepEqual(parseFilamentColor("FF000080"), [255, 0, 0, 128]);
  for (const value of [null, 123, "red", "FFF", "0000000000", "<script>"])
    assert.equal(parseFilamentColor(value), null);
});

test("text colors group shades under basic symbols and preserve unknown or transparent telemetry", () => {
  assert.equal(describeFilamentColor("000000FF"), "⬛ Svart");
  assert.equal(describeFilamentColor("FFFFFFFF"), "⬜ Vit");
  assert.equal(describeFilamentColor("A6A9AAFF"), "◻ Grå");
  assert.equal(describeFilamentColor("F7E6DEFF"), "⬜ Beige");
  assert.equal(describeFilamentColor("C12E1FFF"), "🟥 Röd");
  assert.equal(describeFilamentColor("9B111EFF"), "🟥 Röd");
  assert.equal(describeFilamentColor("001489FF"), "🟦 Blå");
  assert.equal(describeFilamentColor(null), "? Okänd");
  assert.equal(describeFilamentColor("FF000000"), "▫ Transparent");
  assert.match(describeFilamentColor("FF000080"), /Röd \(transparent\)/);
});

test("encoded PNG preserves reported colors across both AMS units, including black and white", () => {
  const image = PNG.sync.read(renderAMSColors(report()));
  assert.equal(image.width, 640);
  assert.equal(image.height, 348);
  assert.deepEqual(pixel(image, 50, 65), [255, 0, 0, 255]);
  assert.deepEqual(pixel(image, 198, 65), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 346, 65), [255, 255, 255, 255]);
  assert.deepEqual(pixel(image, 50, 219), [0, 0, 255, 255]);
  // A physically empty slot must not display its stale green metadata.
  assert.notDeepEqual(pixel(image, 494, 65), [0, 255, 0, 255]);
});

test("transparent colors blend over a checkerboard and unknown values remain neutral", () => {
  const image = PNG.sync.read(renderAMSColors(report()));
  const transparent = pixel(image, 346, 219);
  assert.equal(transparent[0], 249);
  assert.equal(transparent[1], 121);
  assert.equal(transparent[2], 121);
  const unknown = pixel(image, 198, 219);
  assert.equal(unknown[0], unknown[1]);
  assert.equal(unknown[1], unknown[2]);
});

test("missing telemetry and oversized reports fall back to text without allocating an image", () => {
  assert.equal(renderAMSColors(status({ state: "unavailable" })), null);
  assert.equal(renderAMSColors(status({ state: "idle", ams: [] })), null);
  const tooMany = report();
  tooMany.ams = Array.from({ length: 33 }, () => tooMany.ams[0]);
  assert.equal(renderAMSColors(tooMany), null);
  const tooWide = report();
  tooWide.ams[0].trays.push({ id: "4", color: "FF0000FF" });
  assert.equal(renderAMSColors(tooWide), null);
});
