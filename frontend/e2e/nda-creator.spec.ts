import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

/** Fixed "now" in the browser, so the default Effective Date is deterministic. */
const NOW = new Date("2026-03-15T10:00:00");
const TODAY_ISO = "2026-03-15";
const TODAY_LONG = "March 15, 2026";

const preview = (page: Page) => page.getByRole("article");
const party = (page: Page, n: 1 | 2) => page.getByRole("group", { name: `Party ${n}` });
const signatureRow = (page: Page, label: string) =>
  preview(page).getByRole("row", { name: new RegExp(`^${label}`) });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto("/");
  // The page is prerendered; input typed before hydration is lost. The date
  // field is only filled in on the client, so it doubles as a hydration signal.
  await expect(page.getByLabel("Effective date")).toHaveValue(TODAY_ISO);
});

test("renders the full NDA with placeholders and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  page.on("pageerror", (err) => errors.push(err.message));
  await page.reload();
  await expect(page.getByLabel("Effective date")).toHaveValue(TODAY_ISO);

  await expect(preview(page).getByRole("heading", { name: "Mutual Non-Disclosure Agreement", exact: true })).toBeVisible();
  await expect(preview(page).getByRole("heading", { name: "Standard Terms" })).toBeVisible();
  await expect(preview(page)).toContainText(TODAY_LONG);
  await expect(preview(page)).toContainText("[Governing Law (state)]");
  await expect(signatureRow(page, "Company")).toContainText("[Party 1 Company]");
  await expect(preview(page)).toContainText("11. General.");
  expect(errors).toEqual([]);
});

test("fills the preview live from the form", async ({ page }) => {
  await page.getByLabel("Governing law").fill("Delaware");
  await page.getByLabel("Jurisdiction").fill("courts located in New Castle, DE");
  await page.getByLabel("Effective date").fill("2026-12-01");

  for (const [n, p] of [
    [1, { company: "Acme, Inc.", name: "Ada Lovelace", title: "CEO", address: "ada@acme.test" }],
    [2, { company: "Globex", name: "Alan Turing", title: "CTO", address: "alan@globex.test" }],
  ] as const) {
    await party(page, n).getByLabel("Company").fill(p.company);
    await party(page, n).getByLabel("Signatory name").fill(p.name);
    await party(page, n).getByLabel("Title").fill(p.title);
    await party(page, n).getByLabel("Notice address").fill(p.address);
  }

  await expect(preview(page)).toContainText("Governing Law: Delaware");
  await expect(preview(page)).toContainText("Jurisdiction: courts located in New Castle, DE");
  await expect(preview(page)).toContainText("December 1, 2026");
  await expect(signatureRow(page, "Company")).toContainText("Acme, Inc.");
  await expect(signatureRow(page, "Company")).toContainText("Globex");
  await expect(signatureRow(page, "Print Name")).toContainText("Alan Turing");
  await expect(signatureRow(page, "Notice Address")).toContainText("ada@acme.test");
  // Every placeholder is gone once all fields are filled.
  await expect(preview(page)).not.toContainText(/\[(Party|Governing|Jurisdiction)/);
});

test("term options update the MNDA Term and Term of Confidentiality", async ({ page }) => {
  await expect(preview(page)).toContainText("Expires 1 year from Effective Date.");

  await page.getByRole("radio", { name: "Continues until terminated" }).check();
  await expect(preview(page)).toContainText("Continues until terminated in accordance with the terms of the MNDA.");
  await expect(page.getByLabel("MNDA term in years")).toBeDisabled();

  await page.getByRole("radio", { name: "In perpetuity" }).check();
  await expect(preview(page)).toContainText("In perpetuity.");

  // Native radio group: arrow keys move the selection back to the first option.
  await page.getByRole("radio", { name: "In perpetuity" }).press("ArrowUp");
  await expect(page.getByRole("radio", { name: "Fixed term of" })).toBeChecked();
  await expect(preview(page)).toContainText("1 year from Effective Date, but in the case of trade secrets");
});

test("years input accepts edits, caps at two digits and reverts when left empty", async ({ page }) => {
  const years = page.getByLabel("MNDA term in years");

  // Clearing then typing must not snap back to 1 (which would produce "15").
  await years.selectText();
  await years.press("Backspace");
  await expect(years).toHaveValue("");
  await years.pressSequentially("5");
  await expect(years).toHaveValue("5");
  await expect(preview(page)).toContainText("Expires 5 years from Effective Date.");

  await years.fill("");
  await years.pressSequentially("1234");
  await expect(years).toHaveValue("12");
  await expect(preview(page)).toContainText("Expires 12 years from Effective Date.");

  await years.fill("");
  await years.pressSequentially("abc0");
  await years.blur();
  await expect(years).toHaveValue("12");
  await expect(preview(page)).toContainText("Expires 12 years from Effective Date.");
});

test("downloads the completed NDA as a PDF", async ({ page }) => {
  await party(page, 1).getByLabel("Company").fill("Acme, Inc.");
  await party(page, 2).getByLabel("Company").fill("Globex");

  const button = page.getByRole("button", { name: "Download PDF" });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);

  expect(download.suggestedFilename()).toBe("Mutual-NDA-Acme-Inc-Globex.pdf");
  const pdf = await readFile(await download.path());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(10_000);

  await expect(button).toBeVisible();
  await expect(page.getByText("Couldn’t generate the PDF")).toHaveCount(0);
});
