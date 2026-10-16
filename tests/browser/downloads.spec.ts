import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Mock only the native bridge and audio/file saver; exercise the real UI,
  // helper event routing, pagination and download orchestration in the browser.
  await page.addInitScript(() => {
    const host = window as any;
    host.__packSaves = [];
    const callbacks = new Map();
    const listeners = new Map();
    let next = 1;
    const pack = { uuid: "pack", name: "Download Test Pack", files: [] };
    host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_: string, id: number) => listeners.delete(id) };
    host.__TAURI_INTERNALS__ = {
      transformCallback: (callback: Function) => { const id = next++; callbacks.set(id, callback); return id; },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (command: string, args: any) => {
        if (command === "plugin:fs|exists" || command === "dir_exists") return true;
        if (command === "plugin:fs|read_text_file") return Array.from(new TextEncoder().encode(JSON.stringify({ configured: true, sampleDir: "C:/Samples", checkUpdates: false })));
        if (command === "plugin:event|listen") { listeners.set(args.handler, args.event); return args.handler; }
        if (command === "plugin:event|unlisten") { listeners.delete(args.eventId); return; }
        if (command === "plugin:event|emit") {
          const request = JSON.parse(args.payload.body);
          const isPack = request.operationName === "PacksSearch";
          const page = request.variables.page ?? 1;
          const items = isPack ? [pack] : request.variables.parent_asset_uuid ? [{
            uuid: `sample-${page}`, name: `sample-${page}.wav`, files: [], tags: [], parents: { items: [pack] },
            duration: 1000, bpm: null, key: null, chord_type: null, asset_category_slug: "oneshot",
          }] : [];
          const body = JSON.stringify({ data: { assetsSearch: { items, tag_summary: [],
            response_metadata: { records: items.length }, pagination_metadata: { currentPage: page, totalPages: isPack ? 1 : 2 },
          } } });
          for (const [id, event] of listeners) if (event === "splice-result") {
            callbacks.get(id)({ event, id, payload: { id: args.payload.id, ok: true, body } });
          }
          return;
        }
        throw new Error(`Unexpected native call: ${command}`);
      },
    };
  });
  await page.route("**/src/splice/saveSample.ts*", route => route.fulfill({ contentType: "application/javascript", body: `
    export async function savePackSample(sample, path, folder) {
      window.__packSaves.push({sample, path, folder});
      await new Promise(resolve => { window.__releasePackSave = resolve; });
      if (window.__failDownload) throw Error("Disk full");
    }` }));
});

test("notifies throughout all pack pages and succeeds only after the last save", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sample packs", exact: true }).click();
  await page.getByRole("button", { name: "Download pack Download Test Pack" }).click();
  await expect(page.getByText("Downloading sample pack", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__packSaves.length)).toBe(1);
  await expect(page.getByText("Sample pack downloaded", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await expect(page.getByText("Downloading sample pack", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__releasePackSave());
  await expect.poll(() => page.evaluate(() => (window as any).__packSaves.length)).toBe(2);
  await expect(page.getByText("Sample pack downloaded", { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__releasePackSave());
  await expect(page.getByText("Sample pack downloaded", { exact: true })).toBeVisible();
  await expect(page.getByText(/2 samples saved to C:\/Samples/)).toBeVisible();
});

test("failed writes do not produce the success notification", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { (window as any).__failDownload = true; });
  await page.getByRole("button", { name: "Sample packs", exact: true }).click();
  await page.getByRole("button", { name: "Download pack Download Test Pack" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__packSaves.length)).toBe(1);
  await page.evaluate(() => (window as any).__releasePackSave());
  await expect.poll(() => page.evaluate(() => (window as any).__packSaves.length)).toBe(2);
  await page.evaluate(() => (window as any).__releasePackSave());
  await expect(page.getByText("Sample pack download failed", { exact: true })).toBeVisible();
  await expect(page.getByText("Sample pack downloaded", { exact: true })).toHaveCount(0);
});
