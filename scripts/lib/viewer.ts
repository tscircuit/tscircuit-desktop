/**
 * Bundles the circuit viewer into the app.
 *
 * The Circuit tab draws circuits with RunFrame, which evaluates the project's
 * code in a web worker and builds 3D models with manifold-3d. `setup` puts
 * all three into the web app's public folder, so the app loads them from
 * itself and not from a website:
 *
 *   runframe.min.js    RunFrame's self-contained bundle
 *   viewer-assets.js   the eval worker and manifold-3d, as text the page turns
 *                      into blob URLs (see overlay/.../tscircuit-viewer/frame.html)
 *
 * viewer.json names where each comes from. The files are generated, not
 * saved: they are listed in the checkout's .git/info/exclude, so `export`
 * never copies them into overlay/.
 */
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fail, run, step } from "./exec.ts"
import { checkoutDir, repoRoot } from "./paths.ts"

/** The contents of viewer.json. */
export interface ViewerSource {
  /** Folder in the checkout the generated files go to. */
  into: string
  /**
   * RunFrame's bundle. "tscircuit" takes dist/browser.min.js from the
   * tscircuit package below; a URL takes a bundle built somewhere else and
   * must come with the SHA-256 it is expected to have.
   */
  runframe: "tscircuit" | { url: string; sha256: string }
  /** Version or tag of the tscircuit npm package, the source of the eval worker. */
  tscircuit: string
  /** Version of the manifold-3d npm package. It has to be the one RunFrame's 3D viewer asks for. */
  manifold: string
  /** Base URL of the npm registry, for a mirror. Defaults to registry.npmjs.org. */
  registry?: string
}

interface Sources {
  registry: string
  /** Where downloads are kept between runs. */
  cacheDir: string
}

const DEFAULT_REGISTRY = "https://registry.npmjs.org"

export const viewerFile = join(repoRoot, "viewer.json")

/** Null when this repo bundles no viewer (there is no viewer.json). */
export const readViewerSource = (): ViewerSource | null =>
  existsSync(viewerFile) ? (JSON.parse(readFileSync(viewerFile, "utf8")) as ViewerSource) : null

/** The files `bundleViewer` writes, relative to `into`. */
const VIEWER_FILES = ["runframe.min.js", "viewer-assets.js"]

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")

/** curl follows redirects, honours proxy settings, and reads file:// URLs, which the tests use. */
function download(url: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true })
  const partial = `${target}.partial`
  run("curl", ["--fail", "--silent", "--show-error", "--location", "--output", partial, url])
  renameSync(partial, target)
}

interface PackageFiles {
  version: string
  read: (path: string) => Buffer
}

/** Downloads an npm package, checks it against the registry's hash, and unpacks it. */
function fetchPackage(name: string, versionOrTag: string, options: Sources): PackageFiles {
  const scratch = mkdtempSync(join(tmpdir(), "tscircuit-desktop-viewer-"))
  try {
    const metadataFile = join(scratch, "metadata.json")
    download(`${options.registry}/${name}/${versionOrTag}`, metadataFile)
    const metadata = JSON.parse(readFileSync(metadataFile, "utf8")) as {
      version: string
      dist: { tarball: string; integrity: string }
    }
    const folder = join(options.cacheDir, `${name.replace("/", "+")}@${metadata.version}`)
    if (!existsSync(join(folder, "package"))) {
      const tarball = join(scratch, "package.tgz")
      download(metadata.dist.tarball, tarball)
      const [algorithm = "", expected = ""] = metadata.dist.integrity.split("-")
      const actual = createHash(algorithm).update(readFileSync(tarball)).digest("base64")
      if (actual !== expected) {
        fail(`${name}@${metadata.version} does not match the hash the registry lists for it.`)
      }
      const unpacked = join(scratch, "unpacked")
      mkdirSync(unpacked)
      run("tar", ["-xzf", tarball, "-C", unpacked])
      mkdirSync(dirname(folder), { recursive: true })
      rmSync(folder, { recursive: true, force: true })
      renameSync(unpacked, folder)
    }
    return { version: metadata.version, read: (path) => readFileSync(join(folder, "package", path)) }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Downloads a file that must have a known hash. A changed file is an error, not an update. */
function fetchPinnedFile(source: { url: string; sha256: string }, options: Sources): Buffer {
  const cached = join(options.cacheDir, `sha256-${source.sha256}`)
  if (!existsSync(cached)) {
    const fresh = `${cached}.unchecked`
    download(source.url, fresh)
    const actual = sha256(fresh)
    if (actual !== source.sha256) {
      rmSync(fresh, { force: true })
      fail(
        `${source.url} is not the file viewer.json expects.\n  expected sha256 ${source.sha256}\n  got             ${actual}\nIf the new file is the one you want, put its hash in viewer.json.`,
      )
    }
    renameSync(fresh, cached)
  }
  return readFileSync(cached)
}

/** Keeps a generated file out of `git add --all`, which `export` relies on. */
function excludeFromCheckoutGit(path: string): void {
  const excludeFile = join(checkoutDir, ".git", "info", "exclude")
  const current = existsSync(excludeFile) ? readFileSync(excludeFile, "utf8") : ""
  if (current.split("\n").includes(`/${path}`)) return
  mkdirSync(dirname(excludeFile), { recursive: true })
  appendFileSync(excludeFile, `${current.endsWith("\n") || current === "" ? "" : "\n"}/${path}\n`)
}

/**
 * Writes the viewer's files into the checkout. Unlike the bundled skill, a
 * failure here stops `setup`: without these files the Circuit tab is empty.
 */
export function bundleViewer(source: ViewerSource): void {
  const resolved: Sources = {
    registry: (source.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, ""),
    cacheDir: join(repoRoot, ".cache", "viewer"),
  }
  for (const file of VIEWER_FILES) excludeFromCheckoutGit(`${source.into}/${file}`)

  const tscircuit = fetchPackage("tscircuit", source.tscircuit, resolved)
  const manifold = fetchPackage("manifold-3d", source.manifold, resolved)
  const runframe =
    source.runframe === "tscircuit" ? tscircuit.read("dist/browser.min.js") : fetchPinnedFile(source.runframe, resolved)

  // The app draws the header and tabs itself, which takes a RunFrame that a page around it can drive.
  if (!runframe.includes("runframe_capabilities")) {
    fail(
      `The RunFrame named in ${viewerFile} cannot be driven by the app: it is older than the change that added "runframe_capabilities". Name a newer one.`,
    )
  }

  const tscircuitManifest = JSON.parse(tscircuit.read("package.json").toString("utf8")) as {
    dependencies?: Record<string, string>
  }
  const assets = {
    versions: {
      tscircuit: tscircuit.version,
      // The worker is built from this dependency. The frame names it so RunFrame need not ask a CDN which is newest.
      eval: (tscircuitManifest.dependencies?.["@tscircuit/eval"] ?? "").replace(/^[^0-9]+/, "") || null,
      manifold: manifold.version,
      runframe: source.runframe === "tscircuit" ? `tscircuit@${tscircuit.version}` : source.runframe.url,
    },
    webworker: tscircuit.read("dist/webworker.min.js").toString("utf8"),
    manifoldJs: manifold.read("manifold.js").toString("utf8"),
    manifoldWasmBase64: manifold.read("manifold.wasm").toString("base64"),
  }
  const target = join(checkoutDir, source.into)
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, "runframe.min.js"), runframe)
  // U+2028 and U+2029 are legal inside JSON strings but end a line in older JavaScript parsers.
  const literal = JSON.stringify(assets)
    .split(String.fromCharCode(0x2028))
    .join("\\u2028")
    .split(String.fromCharCode(0x2029))
    .join("\\u2029")
  writeFileSync(join(target, "viewer-assets.js"), `self.TSCIRCUIT_VIEWER_ASSETS = ${literal};\n`)
  step(
    `Bundled the circuit viewer: tscircuit ${tscircuit.version}, manifold-3d ${manifold.version}, RunFrame from ${assets.versions.runframe}`,
  )
}
