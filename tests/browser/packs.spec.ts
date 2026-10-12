import { expect, test } from "@playwright/test";

const neon = "Neon Nights - Synthwave Essentials";
const drums = "Concrete Jungle Drums";

test("browse artwork, search packs, open all samples and restore discovery", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Ispliced");
  await expect(page.getByRole("heading", { name: "Ispliced" })).toBeVisible();
  await page.getByRole("button", { name: "Sample packs", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(3);
  const image = page.getByRole("img", { name: `${drums} artwork` });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const search = page.getByRole("textbox", { name: "Search for sample packs" });
  await search.fill("jungle");
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(1);
  await page.getByRole("button", { name: `Open pack ${drums}` }).click();
  await expect(page.getByRole("textbox", { name: "Search for samples" })).toHaveValue("");
  for (const name of ["CJD_140_drum_loop_full_gritty.wav", "CJD_kick_punchy_saturated.wav",
    "CJD_snare_tight_layered.wav", "CJD_174_break_loop_chopped_amen.wav"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Play sample" })).toHaveCount(4);
  await page.getByRole("button", { name: "Back to packs" }).click();
  await expect(search).toHaveValue("jungle");
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(1);
  await search.fill("no-pack-with-this-name");
  await expect(page.getByText("Couldn't find anything.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("pack filters search contained audio, but opening a pack shows all sounds", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sample packs", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(3);
  await page.getByRole("button", { name: "BPM", exact: true }).click();
  await page.getByRole("spinbutton", { name: "BPM", exact: true }).fill("120");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(1);
  await expect(page.getByRole("button", { name: `Open pack ${neon}` })).toBeVisible();
  await page.getByRole("button", { name: `Open pack ${neon}` }).click();
  await expect(page.getByRole("button", { name: "Play sample" })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "BPM", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to packs" }).click();
  await expect(page.getByRole("button", { name: "120 BPM", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(1);
});

test("sample search continues to work after switching pages", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Search for samples" }).fill("kick");
  await expect(page.getByRole("button", { name: "Play sample" })).toHaveCount(1);
  await page.getByRole("button", { name: "Sample packs", exact: true }).click();
  await expect(page.getByText("Couldn't find anything.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(3);
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByRole("textbox", { name: "Search for samples" }).fill("synth");
  await expect(page.getByRole("button", { name: "Play sample" })).toHaveCount(1);
});

test("packs share instrument, genre, key, tag, sample type and sorting controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sample packs", exact: true }).click();
  const cards = page.getByRole("button", { name: /^Open pack / });
  await expect(cards).toHaveCount(3);
  await page.getByRole("button", { name: /Instruments$/ }).click();
  await page.getByRole("option", { name: "drums", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole("button", { name: `Open pack ${drums}` })).toBeVisible();
  await page.getByRole("button", { name: /Genres$/ }).click();
  await page.getByRole("option", { name: "trap", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "Key", exact: true }).click();
  await page.getByRole("button", { name: "C", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Couldn't find anything.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(cards).toHaveCount(3);
  await page.getByRole("button", { name: "bass", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: / Type$/ }).click();
  await page.getByRole("option", { name: "Loops", exact: true }).click();
  await expect(page.getByText("Couldn't find anything.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: / Type$/ }).click();
  await page.getByRole("option", { name: "One-Shots", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open pack ${neon}` })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.getByRole("button", { name: /Sort by$/ }).click();
  await page.getByRole("option", { name: "Most recent", exact: true }).click();
  await expect(cards.first()).toHaveAccessibleName("Open pack Velvet Keys & Chords");
});

test("navigation arrows restore pack searches, filters and sample views", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Go back" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Go forward" })).toBeDisabled();
  await page.getByRole("button", { name: "Sample packs", exact: true }).click();
  await page.getByRole("textbox", { name: "Search for sample packs" }).fill("neon");
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(1);
  await page.getByRole("button", { name: "BPM", exact: true }).click();
  await page.getByRole("spinbutton", { name: "BPM", exact: true }).fill("120");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "120 BPM", exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Open pack ${neon}` }).click();
  await expect(page.getByRole("button", { name: "Play sample" })).toHaveCount(3);
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByRole("textbox", { name: "Search for sample packs" })).toHaveValue("neon");
  await expect(page.getByRole("button", { name: "120 BPM", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(1);
  await page.getByRole("button", { name: "Go forward" }).click();
  await expect(page.getByRole("button", { name: "Play sample" })).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: "Search for samples" })).toHaveValue("");
});

test("navigation arrows remember pagination; filtered packs load later matches on demand", async ({ page }) => {
  // A small page size exercises pagination with the existing catalogue fixtures.
  await page.route("**/src/dev/mock.ts*", async route => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain("const limit = variables.limit ?? 50;");
    await route.fulfill({ response, body: body.replace("const limit = variables.limit ?? 50;", "const limit = 1;") });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Sample packs", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open pack ${neon}` })).toBeVisible();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open pack ${drums}` })).toBeVisible();
  await page.getByRole("button", { name: `Open pack ${drums}` }).click();
  await expect(page.getByRole("button", { name: "Play sample" })).toHaveCount(1);
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByRole("button", { name: `Open pack ${drums}` })).toBeVisible();
  await expect(page.getByRole("button", { name: `Open pack ${neon}` })).toHaveCount(0);
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByRole("button", { name: `Open pack ${neon}` })).toBeVisible();
  await page.getByRole("button", { name: / Type$/ }).click();
  await page.getByRole("option", { name: "Loops", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(1);
  await page.getByRole("button", { name: "Load more packs" }).click();
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(2);
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(1);
  await page.getByRole("button", { name: "Go forward" }).click();
  await expect(page.getByRole("button", { name: /^Open pack / })).toHaveCount(2);
});

test("back restores the list scroll position after opening a pack", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 480 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Search for samples" }).fill("_");
  await expect(page.getByRole("button", { name: "Play sample" })).toHaveCount(10);
  const list = page.getByLabel("Sample results", { exact: true });
  await list.evaluate(element => { element.scrollTop = 120; });
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(120);
  await page.evaluate(() => {
    document.addEventListener("click", () => {
      const list = document.querySelector('[aria-label="Sample results"]')!;
      sessionStorage.setItem("scrollBeforeOpening", String(list.scrollTop));
    }, { capture: true, once: true });
  });
  // Clicking can scroll the chosen result into view; restore the actual position
  // at navigation rather than the earlier programmatic scroll offset.
  await page.getByRole("button", { name: "Show samples from Velvet Keys & Chords", exact: true }).first().click();
  const savedScroll = await page.evaluate(() => Number(sessionStorage.getItem("scrollBeforeOpening")));
  expect(savedScroll).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Play sample" })).toHaveCount(3);
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByRole("button", { name: "Play sample" })).toHaveCount(10);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(savedScroll);
});
