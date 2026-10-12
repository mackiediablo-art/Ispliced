import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("the desktop helper fetches repeated request IDs only once and replays completed replies", async () => {
  const source = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");
  const script = source.match(/const SPLICE_HELPER_INIT: &str = r#"([\s\S]*?)"#;/)![1];
  let listener!: (message: { payload: { id: string; body: string } }) => Promise<void>;
  let finish!: (response: { ok: boolean; text: () => Promise<string> }) => void;
  const fetch = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const emit = vi.fn();
  runInNewContext(script, {
    window: { __TAURI__: { event: {
      listen: (_event: string, callback: typeof listener) => { listener = callback; }, emit,
    } } }, fetch, setTimeout,
  });
  const message = { payload: { id: "request-1", body: "search" } };
  const pending = listener(message);
  await listener(message);
  expect(fetch).toHaveBeenCalledTimes(1);
  finish({ ok: true, text: async () => "results" });
  await pending;
  await listener(message);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledTimes(2);
  expect(emit).toHaveBeenLastCalledWith("splice-result", { id: "request-1", ok: true, body: "results" });
});
