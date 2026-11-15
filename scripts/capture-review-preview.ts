import { join } from "node:path"
import { chromium } from "../.t3code/apps/web/node_modules/playwright/index.mjs"

export async function captureReviewPreview({
  url,
  screenshots,
  threadTitle,
}: {
  url: string
  screenshots: string
  threadTitle: string
}) {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(45_000)
    await page.goto(url).catch((error: Error) => {
      throw new Error(error.message.replaceAll(url, new URL(url).origin))
    })
    await page.locator("li[data-thread-item]", { hasText: threadTitle }).click()
    await page.getByText("This turn is a replay.", { exact: false }).waitFor()

    await page.getByRole("button", { name: "Toggle right panel" }).click()
    await page.getByLabel("Open a surface").getByRole("button", { name: /^Circuit\b/ }).click()
    const schematic = page.getByRole("button", { name: "Schematic", exact: true })
    await schematic.click()
    await page.frameLocator('iframe[title="Circuit preview"]').getByText("R1", { exact: true }).waitFor()
    await page.screenshot({ path: join(screenshots, "01-circuit-review.png"), animations: "disabled" })

    const composer = page.getByRole("textbox")
    await composer.fill("/chip")
    await composer.press("Enter")
    const dialog = page.getByRole("dialog", { name: "Add chip" })
    await dialog.waitFor()
    await page.screenshot({ path: join(screenshots, "02-add-chip.png"), animations: "disabled" })

    await dialog.getByRole("textbox", { name: /^Name/ }).fill("LM358")
    await dialog.getByRole("button", { name: /^(Add chip|Generate)$/ }).click()
    await page.getByText(/(?:add the chip LM358|generate a reusable tscircuit component for LM358)/i)
      .first().waitFor()
    await page.screenshot({ path: join(screenshots, "03-chip-request.png"), animations: "disabled" })
  } finally {
    await browser.close()
  }
}
