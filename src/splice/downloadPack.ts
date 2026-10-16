import { createSearchRequest, SpliceSample, SpliceSamplePack } from "./api";
import { readSearchResponse } from "./packs";

export interface PackDownloadProgress { saved: number; failed: number; found: number; }
export interface PackDownloadResult extends PackDownloadProgress { errors: string[]; }

function safePart(value: string) {
  const clean = value.replace(/[<>:"|?*\x00-\x1f /\\]/g, "_").slice(0, 100).replace(/[. ]+$/g, "");
  if (!clean || clean === "." || clean === "..") return "sample";
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(clean) ? `_${clean}` : clean;
}

export function packSamplePath(pack: SpliceSamplePack, sample: SpliceSample) {
  const parts = sample.name.split(/[/\\]/).filter(part => part && part !== "." && part !== "..");
  const name = parts.pop() || sample.uuid;
  const basename = safePart(name.replace(/\.[^.]+$/, ""));
  return [safePart(pack.name), ...parts.map(safePart), `${basename}.wav`].join("/");
}

/** Fetch every pack page without inheriting the browse filters. Keep only two
 * audio transfers/conversions in memory and wait for every write before returning.
 */
export async function downloadPack(
  pack: SpliceSamplePack,
  search: (body: string) => Promise<string>,
  save: (sample: SpliceSample, relativePath: string) => Promise<void>,
  onProgress: (progress: PackDownloadProgress) => void,
): Promise<PackDownloadResult> {
  const result: PackDownloadResult = { saved: 0, failed: 0, found: 0, errors: [] };
  const seen = new Set<string>();
  const paths = new Set<string>();
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    const request = createSearchRequest("");
    request.variables.parent_asset_uuid = pack.uuid;
    request.variables.parent_asset_type = "pack";
    request.variables.sort = "recency";
    request.variables.page = page;
    const data = readSearchResponse(await search(JSON.stringify(request)));
    totalPages = data.pagination_metadata.totalPages;
    const items = data.items.filter(sample => {
      if (seen.has(sample.uuid)) return false;
      seen.add(sample.uuid);
      return true;
    });
    result.found += items.length;
    onProgress({ ...result });
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
      while (next < items.length) {
        const sample = items[next++];
        let relativePath = packSamplePath(pack, sample);
        const original = relativePath;
        let suffix = 1;
        // Windows filenames are case-insensitive, including on a Linux build host.
        while (paths.has(relativePath.toLowerCase())) relativePath = original.replace(/\.wav$/, `_${suffix++}.wav`);
        paths.add(relativePath.toLowerCase());
        try {
          await save(sample, relativePath);
          result.saved++;
        } catch (error) {
          result.failed++;
          if (result.errors.length < 3) result.errors.push(`${sample.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
        onProgress({ ...result });
      }
    }));
  }
  if (!result.found) throw new Error("No samples were found in this pack.");
  return result;
}
