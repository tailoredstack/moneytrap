import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("browser entry", () => {
  test("index.html mounts the app into #root and loads main.tsx", async () => {
    const html = await Bun.file(join(import.meta.dir, "..", "index.html")).text();
    expect(html).toContain('id="root"');
    expect(html).toContain('src="/src/main.tsx"');
  });

  test("main.tsx loads the stylesheet that defines the theme tokens the UI uses", async () => {
    const main = await Bun.file(join(import.meta.dir, "main.tsx")).text();
    expect(main).toContain('import "./styles.css"');
    const css = await Bun.file(join(import.meta.dir, "styles.css")).text();
    expect(css).toContain('@import "tailwindcss"');
    for (const token of ["primary", "primary-foreground", "destructive", "muted-foreground", "input", "background"]) {
      expect(css).toContain(`--color-${token}:`);
    }
  });
});
