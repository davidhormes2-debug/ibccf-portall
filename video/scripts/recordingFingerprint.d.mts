export declare const REPO_ROOT: string;
export declare const SCENE_DURATIONS_PATH: string;
export declare const ALL_LOCALES: string[];
export declare const RECORDINGS_DIR: string;
export declare const MANIFEST_PATH: string;

export declare function recordingFileName(locale: string): string;
export declare function recordingPath(locale: string): string;
export declare function listSourceFiles(): string[];
export declare function computeNarrationFingerprint(locale: string, localeDir?: string): string;
export declare function computeSourceFingerprint(files?: string[]): string;

export interface RecordingResult { locale: string; timedOut: boolean; }
export declare function recordedLocalesFromResults(results: RecordingResult[]): string[];

export interface UpdateManifestOptions {
  manifestPath: string;
  fingerprint?: string;
  recordedAt?: string;
  [key: string]: unknown;
}
export interface ManifestLocaleEntry {
  sourceFingerprint?: string;
  narrationFingerprint?: string;
  recordedAt?: string;
  fileName?: string;
}
export interface ManifestData {
  locales: Record<string, ManifestLocaleEntry>;
}
export declare function updateManifest(locales: string[], options: UpdateManifestOptions): Promise<ManifestData>;
