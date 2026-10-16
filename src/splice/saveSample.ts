import { fetch } from "@tauri-apps/plugin-http";
import { join } from "@tauri-apps/api/path";
import * as wav from "node-wav";
import { SpliceSample } from "./api";
import { decodeSpliceAudio, getMp3SampleRate, MP3_START_DELAY } from "./decoder";
import { IS_WINDOWS, WINDOWS_MAX_PATH, writeSampleFile } from "../native";

/** Save the same decoded, 24-bit WAV audio used by individual sample exports. */
export async function savePackSample(sample: SpliceSample, relativePath: string, folder: string, trimDelay: boolean) {
  if (IS_WINDOWS && (await join(folder, relativePath)).length > WINDOWS_MAX_PATH) {
    throw new Error("The file path is too long. Choose a shorter sample folder in Settings.");
  }
  const preview = sample.files.find(file => file.asset_file_type_slug === "preview_mp3");
  if (!preview) throw new Error("No downloadable preview is available.");
  const response = await fetch(preview.url);
  if (!response.ok) throw new Error(`Audio download failed (HTTP ${response.status}).`);
  const decoded = decodeSpliceAudio(new Uint8Array(await response.arrayBuffer()));
  const sampleRate = getMp3SampleRate(decoded) ?? 44100;
  const context = new OfflineAudioContext(1, 1, sampleRate);
  const audio = await context.decodeAudioData(decoded.slice().buffer);
  const start = trimDelay ? MP3_START_DELAY : 0;
  const end = trimDelay && sample.duration > 0
    ? Math.min(audio.length, Math.round(sample.duration / 1000 * audio.sampleRate) + start) : audio.length;
  if (end <= start || !audio.numberOfChannels) throw new Error("The downloaded audio is empty.");
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index).subarray(start, end));
  await writeSampleFile(folder, relativePath, wav.encode(channels as unknown as ArrayBuffer[], {
    bitDepth: 24, sampleRate: audio.sampleRate,
  }));
}
