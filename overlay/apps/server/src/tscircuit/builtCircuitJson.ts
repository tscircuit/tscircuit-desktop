/**
 * tscircuit desktop: the Circuit tab draws a file `tsci build` already built from the build's
 * `dist/<file>/circuit.json`, which runs to megabytes for a board of any size. File reads stop
 * at 1 MB to keep previews light, so a build's Circuit JSON gets a limit of its own.
 */
const BUILT_CIRCUIT_JSON = /(^|[\\/])(?:[^\\/]+\.)?circuit\.json$/i;
const BUILT_CIRCUIT_JSON_MAX_BYTES = 32 * 1024 * 1024;

/** How much of a file a read returns before it is cut short. */
export const readFileMaxBytes = (relativePath: string, defaultMaxBytes: number): number =>
  BUILT_CIRCUIT_JSON.test(relativePath)
    ? Math.max(defaultMaxBytes, BUILT_CIRCUIT_JSON_MAX_BYTES)
    : defaultMaxBytes;
