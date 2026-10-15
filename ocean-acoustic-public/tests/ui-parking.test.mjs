import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/MascotDock.jsx", import.meta.url),
  "utf8",
);
const helpers = source.slice(
  source.indexOf("const POSITION_KEY"),
  source.indexOf("function safeSourceUrl"),
);
const fixtures = [
  {
    name: "desktop composer",
    width: 1289,
    height: 717,
    rect: [390, 559, 1249, 676],
    old: { x: 1174, y: 545 },
  },
  {
    name: "mobile composer",
    width: 390,
    height: 844,
    rect: [12, 681, 378, 801],
    old: { x: 275, y: 672 },
  },
  {
    name: "short mobile composer",
    width: 390,
    height: 500,
    rect: [12, 353, 378, 458],
    old: { x: 275, y: 328 },
  },
  {
    name: "legacy desktop position on mobile",
    width: 390,
    height: 844,
    rect: [12, 681, 378, 801],
    old: { x: 1174, y: 545 },
  },
];

for (const fixture of fixtures) {
  test(`assistant parking avoids ${fixture.name} using its current avatar size`, () => {
    let record = JSON.stringify(fixture.old);
    const [left, top, right, bottom] = fixture.rect;
    const rect = {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
    const context = vm.createContext({
      window: { innerWidth: fixture.width, innerHeight: fixture.height },
      document: {
        querySelectorAll(selector) {
          for (const protectedSelector of [
            ".composer-send",
            ".composer textarea",
            ".answer-evidence-chips",
            ".research-heading",
          ])
            assert(selector.includes(protectedSelector));
          return [{ closest: () => null, getBoundingClientRect: () => rect }];
        },
      },
      localStorage: {
        getItem: () => record,
        setItem: (_, value) => {
          record = value;
        },
      },
    });
    const result = vm.runInContext(
      `${helpers}\n({size:avatarSize(), initial:clearParking(readPosition()), reset:defaultPosition(), manual:clearParking({x:12,y:62})})`,
      context,
    );
    assert.equal(result.size.width, fixture.width <= 760 ? 56 : 92);
    assert.equal(result.size.height, fixture.width <= 760 ? 72 : 126);
    for (const parked of [result.initial, result.reset, result.manual]) {
      assert(
        parked.x >= 12 && parked.x + result.size.width <= fixture.width - 12,
      );
      assert(
        parked.y >= 62 && parked.y + result.size.height <= fixture.height - 40,
      );
      const overlaps =
        parked.x < right + 12 &&
        parked.x + result.size.width > left - 12 &&
        parked.y < bottom + 12 &&
        parked.y + result.size.height > top - 12;
      assert(
        !overlaps,
        "avatar must leave the composer and its safety gap clear",
      );
    }
    assert.deepEqual(JSON.parse(JSON.stringify(result.manual)), {
      x: 12,
      y: 62,
    });
    vm.runInContext(
      `storePosition(${JSON.stringify(result.initial)})`,
      context,
    );
    assert.equal(JSON.parse(record).viewport_width, fixture.width);
    assert.equal(JSON.parse(record).viewport_height, fixture.height);
  });
}
