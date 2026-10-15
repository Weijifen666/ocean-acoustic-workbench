import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("shared scientific answer renderer passes ten Markdown, math, evidence, identity and draft checks", async () => {
  const base = path.resolve(tmpdir()),
    directory = await mkdtemp(path.join(base, "ocean-renderer-"));
  try {
    const outfile = path.join(directory, "renderer.cjs");
    await build({
      entryPoints: [
        fileURLToPath(new URL("./renderer-fixture.jsx", import.meta.url)),
      ],
      outfile,
      bundle: true,
      platform: "node",
      format: "cjs",
      loader: { ".css": "empty", ".png": "dataurl" },
      logLevel: "silent",
    });
    const result = spawnSync(process.execPath, [outfile], {
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Renderer checks: 10 passed/);
  } finally {
    if (
      path.dirname(path.resolve(directory)) !== base ||
      !path.basename(directory).startsWith("ocean-renderer-")
    )
      throw new Error("Unexpected renderer test output path.");
    await rm(directory, { recursive: true, force: true });
  }
});
