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
