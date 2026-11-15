import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { checkoutDir } from "./lib/paths.ts"

// The sandboxed iframe has an opaque origin, so Vercel Authentication cookies
// do not accompany its subresource requests. Keep the sandbox and deliver the
// bundled viewer scripts with the authenticated frame document.
const viewerDirectory = join(checkoutDir, "apps", "web", "dist", "tscircuit-viewer")
const framePath = join(viewerDirectory, "frame.html")
let frame = await readFile(framePath, "utf8")

// Chromium does not expose WebGPU to the frame's opaque origin. PCB Viewer
// already supports Canvas and reads this preference when it mounts.
const runframeTag = '<script src="./runframe.min.js"></script>'
frame = frame.replace(runframeTag, `<script>
  if (self.origin === "null") {
    localStorage.setItem("pcb_viewer_rendering_engine", JSON.stringify("canvas"))
  }
</script>
${runframeTag}`)

for (const name of ["viewer-assets.js", "runframe.min.js"]) {
  const tag = `<script src="./${name}"></script>`
  if (!frame.includes(tag)) throw new Error(`Viewer frame is missing its ${name} script.`)
  const script = await readFile(join(viewerDirectory, name), "utf8")
  frame = frame.replace(tag, () => `<script>\n${script.replace(/<\/script/gi, "<\\/script")}\n</script>`)
}

await writeFile(framePath, frame)
await writeFile(`${framePath}.gz`, gzipSync(frame))
