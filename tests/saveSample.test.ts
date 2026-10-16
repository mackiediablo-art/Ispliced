import { beforeEach, expect, it, vi } from "vitest";
import * as wav from "node-wav";
import { savePackSample } from "../src/splice/saveSample";
import { SpliceSample } from "../src/splice/api";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), write: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.fetch }));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));
vi.mock("../src/native", () => ({ IS_WINDOWS: true, WINDOWS_MAX_PATH: 259, writeSampleFile: mocks.write }));
vi.mock("../src/splice/decoder", () => ({ decodeSpliceAudio: (bytes: Uint8Array) => bytes,
  getMp3SampleRate: () => 44100, MP3_START_DELAY: 1105 }));

const sample = { duration: 10, files: [{ asset_file_type_slug: "preview_mp3", url: "https://audio.test/sample" }] } as SpliceSample;
let length: number;
beforeEach(() => {
  vi.clearAllMocks();
  length = 2000;
  mocks.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(32) });
  mocks.write.mockResolvedValue(undefined);
  vi.stubGlobal("OfflineAudioContext", class {
    async decodeAudioData() {
      return { length, sampleRate: 44100, numberOfChannels: 2,
        getChannelData: () => new Float32Array(length).fill(0.5) };
    }
  });
});

it("saves stereo PCM WAV using the selected delay-trimming setting", async () => {
  await savePackSample(sample, "Pack/test.wav", "C:/Samples", true);
  const [folder, path, bytes] = mocks.write.mock.calls[0];
  expect([folder, path]).toEqual(["C:/Samples", "Pack/test.wav"]);
  const audio = wav.decode(bytes);
  expect(audio.sampleRate).toBe(44100);
  expect(audio.channelData).toHaveLength(2);
  expect(audio.channelData[0]).toHaveLength(441);
});

it("exports audio over one minute without writing an empty WAV", async () => {
  length = 61 * 44100;
  await savePackSample(sample, "Pack/long.wav", "C:/Samples", false);
  expect(wav.decode(mocks.write.mock.calls[0][2]).channelData[0]).toHaveLength(length);
});

it("rejects HTTP failures and overlong Windows paths before writing", async () => {
  mocks.fetch.mockResolvedValue({ ok: false, status: 403 });
  await expect(savePackSample(sample, "Pack/test.wav", "C:/Samples", false)).rejects.toThrow("HTTP 403");
  await expect(savePackSample(sample, "a".repeat(260) + ".wav", "C:/Samples", false)).rejects.toThrow("path is too long");
  expect(mocks.write).not.toHaveBeenCalled();
});
