import { SpliceSample, SpliceSamplePack, SpliceSearchResponse } from "../splice/api";
import { ChordType, MusicKey, SpliceTag } from "../splice/entities";

// Mock search data, used only when the app runs outside of the Tauri shell
// (i.e. `yarn dev` opened in a plain browser). This lets UI work happen with
// hot reload in a regular browser, where the splice.com helper webview that
// performs real searches doesn't exist.

const TAGS: Record<string, SpliceTag> = Object.fromEntries(
  ["drums", "kick", "snare", "bass", "synth", "melodic", "vocal", "dry", "wet",
   "trap", "house", "techno", "lo-fi", "ambient", "percussion", "fx", "guitar"]
    .map((label, i) => [label, { uuid: `tag-${i}`, label }])
);

const tagsOf = (...labels: string[]) => labels.map(x => TAGS[x]);

/** Builds a `data:` URL holding a JSON amplitude array shaped like a real Splice waveform asset. */
function mockWaveformUrl(seed: number, kind: "loop" | "decay") {
  const points: number[] = [];
  let noise = seed;

  for (let i = 0; i < 160; i++) {
    noise = (noise * 16807) % 2147483647;
    const rand = (noise % 1000) / 1000;

    const t = i / 160;
    const envelope = kind == "decay"
      ? Math.exp(-t * 5)
      : 0.55 + 0.45 * Math.sin(t * Math.PI * 8 + seed);

    points.push(Math.max(0.02, Math.min(1, envelope * (0.6 + rand * 0.4))));
  }

  return "data:application/json," + encodeURIComponent(JSON.stringify(points));
}

const PACKS: SpliceSamplePack[] = [
  { uuid: "pack-1", name: "Neon Nights - Synthwave Essentials", permalink_base_url: "mock", files: [{ path: "", asset_file_type_slug: "cover_image", url: "/img/mock-neon.svg" }] },
  { uuid: "pack-2", name: "Concrete Jungle Drums", permalink_base_url: "mock", files: [{ path: "", asset_file_type_slug: "cover_image", url: "/img/mock-drums.svg" }] },
  { uuid: "pack-3", name: "Velvet Keys & Chords", permalink_base_url: "mock", files: [{ path: "", asset_file_type_slug: "cover_image", url: "/img/mock-keys.svg" }] },
];

function mockSample(
  i: number,
  name: string,
  opts: {
    pack: number, bpm: number | null, key: MusicKey | null, chord: ChordType | null,
    duration: number, category: "oneshot" | "loop", tags: SpliceTag[]
  }
): SpliceSample {
  const pack = PACKS[opts.pack];
  return {
    uuid: `sample-${i}`,
    name,
    tags: opts.tags,
    files: [
      { name: "waveform", path: "", asset_file_type_slug: "waveform",
        url: mockWaveformUrl(i + 1, opts.category == "oneshot" ? "decay" : "loop") },
      { name: "preview", path: "", asset_file_type_slug: "preview_mp3", url: "data:audio/mpeg," },
    ],
    parents: {
      items: [pack]
    },
    bpm: opts.bpm,
    chord_type: opts.chord,
    duration: opts.duration,
    instrument: null,
    key: opts.key,
    asset_category_slug: opts.category
  };
}

const SAMPLES: SpliceSample[] = [
  mockSample(0, "NN_120_synth_loop_midnight_drive_Cmin.wav",
    { pack: 0, bpm: 120, key: "C", chord: "minor", duration: 16000, category: "loop", tags: tagsOf("synth", "melodic", "wet") }),
  mockSample(1, "NN_analog_bass_stab_F.wav",
    { pack: 0, bpm: null, key: "F", chord: null, duration: 1250, category: "oneshot", tags: tagsOf("bass", "synth", "dry") }),
  mockSample(2, "CJD_140_drum_loop_full_gritty.wav",
    { pack: 1, bpm: 140, key: null, chord: null, duration: 6857, category: "loop", tags: tagsOf("drums", "trap", "percussion") }),
  mockSample(3, "CJD_kick_punchy_saturated.wav",
    { pack: 1, bpm: null, key: null, chord: null, duration: 640, category: "oneshot", tags: tagsOf("drums", "kick", "dry") }),
  mockSample(4, "CJD_snare_tight_layered.wav",
    { pack: 1, bpm: null, key: null, chord: null, duration: 480, category: "oneshot", tags: tagsOf("drums", "snare") }),
  mockSample(5, "VK_90_keys_loop_dusty_chords_Abmaj.wav",
    { pack: 2, bpm: 90, key: "G#", chord: "major", duration: 10667, category: "loop", tags: tagsOf("melodic", "lo-fi", "wet") }),
  mockSample(6, "VK_85_guitar_loop_lazy_sunday_Dmaj.wav",
    { pack: 2, bpm: 85, key: "D", chord: "major", duration: 11294, category: "loop", tags: tagsOf("guitar", "lo-fi", "melodic") }),
  mockSample(7, "NN_128_arp_loop_neon_cascade_Amin.wav",
    { pack: 0, bpm: 128, key: "A", chord: "minor", duration: 15000, category: "loop", tags: tagsOf("synth", "melodic", "techno") }),
  mockSample(8, "VK_vocal_chop_wistful_Em.wav",
    { pack: 2, bpm: null, key: "E", chord: "minor", duration: 2100, category: "oneshot", tags: tagsOf("vocal", "wet", "fx") }),
  mockSample(9, "CJD_174_break_loop_chopped_amen.wav",
    { pack: 1, bpm: 174, key: null, chord: null, duration: 5517, category: "loop", tags: tagsOf("drums", "percussion", "trap") }),
];

/** Returns a canned response mimicking what the Splice search endpoint would return. */
export function mockSearch(body: string): string {
  const payload = JSON.parse(body);
  const variables = payload.variables;
  const packSearch = payload.operationName === "PacksSearch";
  const query: string = (packSearch ? variables.query : variables.filepath) ?? "";
  const matchingSamples = SAMPLES
    .filter(sample => packSearch || sample.name.toLowerCase().includes(query.toLowerCase()))
    .filter(sample => !variables.parent_asset_uuid || sample.parents.items.some(pack => pack.uuid === variables.parent_asset_uuid))
    .filter(sample => !variables.key || sample.key === variables.key)
    .filter(sample => !variables.chord_type || sample.chord_type === variables.chord_type)
    .filter(sample => !variables.asset_category_slug || sample.asset_category_slug === variables.asset_category_slug)
    .filter(sample => !variables.bpm || sample.bpm === Number(variables.bpm))
    .filter(sample => variables.min_bpm == null || (sample.bpm != null && sample.bpm >= variables.min_bpm))
    .filter(sample => variables.max_bpm == null || (sample.bpm != null && sample.bpm <= variables.max_bpm))
    .filter(sample => (variables.tags ?? []).every((tag: string) => sample.tags.some(item => item.uuid === tag)));

  let items: (SpliceSample | SpliceSamplePack)[] = packSearch
    ? PACKS.filter(pack => pack.name.toLowerCase().includes(query.toLowerCase())) : matchingSamples;
  if (variables.sort === "recency") items = [...items].reverse();
  if (variables.sort === "random") {
    // Stable per seed so pagination uses the same order.
    const seed = Number(variables.random_seed ?? 0);
    const rank = (uuid: string) => [...uuid].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 2147483647, seed);
    items = [...items].sort((a, b) => rank(a.uuid) - rank(b.uuid));
  }
  const limit = variables.limit ?? 50;
  const page = Math.max(1, variables.page ?? 1);
  const response: SpliceSearchResponse<SpliceSample | SpliceSamplePack> = {
    data: {
      assetsSearch: {
        items: items.slice((page - 1) * limit, page * limit),
        tag_summary: [
          ...["drums", "synth", "guitar", "vocal"].map(label => ({
            tag: { ...TAGS[label], taxonomy: { uuid: "tx-instr", name: "Instrument" as const } },
            count: SAMPLES.filter(sample => sample.tags.some(tag => tag.uuid === TAGS[label].uuid)).length
          })),
          ...["trap", "house", "lo-fi", "techno"].map(label => ({
            tag: { ...TAGS[label], taxonomy: { uuid: "tx-genre", name: "Genre" as const } },
            count: SAMPLES.filter(sample => sample.tags.some(tag => tag.uuid === TAGS[label].uuid)).length
          })),
          ...["kick", "snare", "bass", "melodic", "dry", "wet", "percussion", "fx"].map(label => ({
            tag: { ...TAGS[label], taxonomy: { uuid: "tx-attribute", name: "Functional Attribute" as const } },
            count: SAMPLES.filter(sample => sample.tags.some(tag => tag.uuid === TAGS[label].uuid)).length
          }))
        ],
        response_metadata: { records: items.length },
        pagination_metadata: { currentPage: page, totalPages: Math.ceil(items.length / limit) }
      }
    }
  };
  return JSON.stringify(response);
}
