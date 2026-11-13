import { readFileSync, writeFileSync } from "node:fs"
import { pinFile } from "./paths.ts"

export interface UpstreamPin {
  /** Git URL of upstream T3 Code. */
  repository: string
  /** Branch that `bump` follows. */
  branch: string
  /** The exact upstream commit this repo's overlay and patches apply to. */
  commit: string
}

export const readPin = (): UpstreamPin =>
  JSON.parse(readFileSync(pinFile, "utf8")) as UpstreamPin

export const writePin = (pin: UpstreamPin): void =>
  writeFileSync(pinFile, `${JSON.stringify(pin, null, 2)}\n`)

/** Web URL showing what upstream changed between two commits. */
export const compareUrl = (pin: UpstreamPin, from: string, to: string): string =>
  `${pin.repository.replace(/\.git$/, "")}/compare/${from}...${to}`
