/**
 * Bundles the circuit viewer into the app.
 *
 * The Circuit tab draws circuits with RunFrame, which evaluates the project's
 * code in a web worker and builds 3D models with manifold-3d. `setup` puts
 * them into the web app's public folder, so the app loads them from itself
 * and not from a website:
 *
 *   runframe.min.js    the tscircuit package's dist/browser.min.js: RunFrame
 *                      with its eval worker inside
 *   viewer-assets.js   manifold-3d, as text the page turns into a blob URL
 *                      (see overlay/.../tscircuit-viewer/frame.html)
 *
 * viewer.json names the versions. The files are generated, not saved: they
 * are listed in the checkout's .git/info/exclude, so `export` never copies
 * them into overlay/.
 */
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fail, run, step, tryRun } from "./exec.ts"
import { checkoutDir, repoRoot } from "./paths.ts"

/** The contents of viewer.json. */
export interface ViewerSource {
  /** Folder in the checkout the generated files go to. */
  into: string
  /** Version or tag of the tscircuit npm package, the source of RunFrame and its eval worker. */
  tscircuit: string
  /** Version of the manifold-3d npm package. It has to be the one RunFrame's 3D viewer asks for. */
  manifold: string
  /**
   * Version or tag of @tscircuit/circuit-json-to-jlcpcb-quote, which prices a board in the Order pane.
   * The viewer fetches it when a price is asked for; the build only settles which version.
   */
  jlcpcbQuote?: string
  /** Base URL of the npm registry, for a mirror. Defaults to registry.npmjs.org. */
  registry?: string
  /** Base URL of tscircuit's package CDN, for a mirror. Defaults to jscdn.tscircuit.com. */
  jscdn?: string
}

interface Sources {
  registry: string
  /** Where downloads are kept between runs. */
  cacheDir: string
}

const DEFAULT_REGISTRY = "https://registry.npmjs.org"
const DEFAULT_JSCDN = "https://jscdn.tscircuit.com"
const JLCPCB_QUOTE_PACKAGE = "@tscircuit/circuit-json-to-jlcpcb-quote"

export const viewerFile = join(repoRoot, "viewer.json")

/** Null when this repo bundles no viewer (there is no viewer.json). */
export const readViewerSource = (): ViewerSource | null =>
  existsSync(viewerFile) ? (JSON.parse(readFileSync(viewerFile, "utf8")) as ViewerSource) : null

/** The files `bundleViewer` writes, relative to `into`. */
const VIEWER_FILES = ["runframe.min.js", "viewer-assets.js"]

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
  // The unpacked directory is renamed into the cache, which can be on another volume than the OS temp directory.
  mkdirSync(options.cacheDir, { recursive: true })
  const scratch = mkdtempSync(join(options.cacheDir, ".download-"))
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
      rmSync(folder, { recursive: true, force: true })
      renameSync(unpacked, folder)
    }
    return { version: metadata.version, read: (path) => readFileSync(join(folder, "package", path)) }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * The version a tag such as "latest" names today. The package is not on npm, so tscircuit's CDN is asked.
 * Null when it cannot be found: the viewer then asks for the newest, and a price is the only thing at stake.
 */
function resolveJlcpcbQuoteVersion(versionOrTag: string, jscdn: string, scratchDir: string): string | null {
  mkdirSync(scratchDir, { recursive: true })
  const manifestFile = join(scratchDir, "jlcpcb-quote-package.json")
  const url = `${jscdn}/${JLCPCB_QUOTE_PACKAGE}/${versionOrTag}/package.json`
  const fetched = tryRun("curl", ["--fail", "--silent", "--show-error", "--location", "--output", manifestFile, url])
  try {
    if (!fetched.ok) return null
    const version = (JSON.parse(readFileSync(manifestFile, "utf8")) as { version?: unknown }).version
    return typeof version === "string" && /^\d+\.\d+\.\d+[\w.-]*$/.test(version) ? version : null
  } catch {
    return null
  } finally {
    rmSync(manifestFile, { force: true })
  }
}

/** Keeps a generated file out of `git add --all`, which `export` relies on. */
function excludeFromCheckoutGit(path: string): void {
  const excludeFile = join(checkoutDir, ".git", "info", "exclude")
  const current = existsSync(excludeFile) ? readFileSync(excludeFile, "utf8") : ""
  if (current.split("\n").includes(`/${path}`)) return
  mkdirSync(dirname(excludeFile), { recursive: true })
  appendFileSync(excludeFile, `${current.endsWith("\n") || current === "" ? "" : "\n"}/${path}\n`)
}

/** Older RunFrame runners omit the preview's plot-only option when forwarding props. */
function forwardSimulationPlotOption(bundle: string, version: string): string {
  if (/\bhideSchematicInAnalogSimulation:\s*[$\w]+\.hideSchematicInAnalogSimulation\b/.test(bundle)) {
    return bundle
  }

  const previewOption = /\bschematicSvgOptions:\s*([$\w]+)\.schematicSvgOptions(?=,\s*showToggleFullScreen:)/g
  if (!bundle.includes("hideSchematicInAnalogSimulation") || [...bundle.matchAll(previewOption)].length !== 1) {
    fail(`Cannot forward the plot-only simulation option in the tscircuit ${version} viewer.`)
  }
  return bundle.replace(previewOption, (option, props: string) =>
    `${option},hideSchematicInAnalogSimulation:${props}.hideSchematicInAnalogSimulation`,
  )
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
  const runframe = tscircuit.read("dist/browser.min.js").toString("utf8")

  // The app draws the header and tabs itself, which takes a RunFrame that a page around it can drive.
  if (!runframe.includes("runframe_capabilities")) {
    fail(
      `tscircuit ${tscircuit.version} cannot be used as the circuit viewer: its RunFrame is older than the change that lets the app drive it (0.0.3179 has it). Name a newer version in ${viewerFile}.`,
    )
  }

  // An autorouter bug report reads a run's routing problems off the eval worker RunFrame keeps here, and the Order pane reads the circuit off it.
  if (!runframe.includes("runFrameWorker")) {
    fail(
      `tscircuit ${tscircuit.version} cannot be used as the circuit viewer: its RunFrame no longer keeps its eval worker in globalThis.runFrameWorker, which the viewer's page listens on to report autorouter bugs. Change overlay/apps/web/public/tscircuit-viewer/frame.html to follow it.`,
    )
  }

  const tscircuitManifest = JSON.parse(tscircuit.read("package.json").toString("utf8")) as {
    dependencies?: Record<string, string>
  }
  const jlcpcbQuote = source.jlcpcbQuote
    ? resolveJlcpcbQuoteVersion(source.jlcpcbQuote, (source.jscdn ?? DEFAULT_JSCDN).replace(/\/+$/, ""), resolved.cacheDir)
    : null
  if (source.jlcpcbQuote && jlcpcbQuote === null) {
    step(`Could not look up ${JLCPCB_QUOTE_PACKAGE} ${source.jlcpcbQuote}; the Order pane will ask for the newest version when it prices a board`)
  }
  const assets = {
    versions: {
      tscircuit: tscircuit.version,
      // RunFrame's worker is built from this dependency. The frame names it so RunFrame need not ask a CDN which is newest.
      eval: (tscircuitManifest.dependencies?.["@tscircuit/eval"] ?? "").replace(/^[^0-9]+/, "") || null,
      manifold: manifold.version,
      jlcpcbQuote,
    },
    manifoldJs: manifold.read("manifold.js").toString("utf8"),
    manifoldWasmBase64: manifold.read("manifold.wasm").toString("base64"),
  }
  const target = join(checkoutDir, source.into)
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, "runframe.min.js"), forwardSimulationPlotOption(runframe, tscircuit.version))
  writeFileSync(join(target, "viewer-assets.js"), `self.TSCIRCUIT_VIEWER_ASSETS = ${JSON.stringify(assets)};\n`)
  step(
    `Bundled the circuit viewer: tscircuit ${tscircuit.version}, manifold-3d ${manifold.version}` +
      (jlcpcbQuote ? `, prices from ${JLCPCB_QUOTE_PACKAGE} ${jlcpcbQuote}` : ""),
  )
}
