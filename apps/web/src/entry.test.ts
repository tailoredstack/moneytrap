import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("browser entry", () => {
  test("index.html mounts the app into #root and loads main.tsx", async () => {
    const html = await Bun.file(join(import.meta.dir, "..", "index.html")).text();
    expect(html).toContain('id="root"');
    expect(html).toContain('src="/src/main.tsx"');
  });
});
