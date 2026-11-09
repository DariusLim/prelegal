import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { mockBackend, mockChat } from "./mock-backend";

const NOW = new Date("2026-03-15T10:00:00");
const TODAY_ISO = "2026-03-15";

const preview = (page: Page) => page.getByRole("article");
const previewPane = (page: Page) => page.getByRole("region", { name: "Document preview" });
const conversation = (page: Page) => page.getByRole("log", { name: "Conversation" });
const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message" });
// Scoped: Next.js renders its own (empty) role="alert" route announcer.
const chatAlert = (page: Page) => page.getByRole("region", { name: "Assistant" }).getByRole("alert");
const signatureRow = (page: Page, label: string) =>
  preview(page).getByRole("row", { name: new RegExp(`^${label}`) });

async function say(page: Page, text: string) {
  await messageBox(page).fill(text);
  await messageBox(page).press("Enter");
}

let backend: Awaited<ReturnType<typeof mockBackend>>;

async function openNewDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  // The page is prerendered; the message box is enabled only once hydrated.
  await expect(messageBox(page)).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  backend = await mockBackend(page);
  await openNewDocument(page);
});

test("opens with the greeting and the list of supported documents, without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  page.on("pageerror", (err) => errors.push(err.message));
  await openNewDocument(page);

  await expect(conversation(page)).toContainText("What would you like to create?");
  await expect(previewPane(page).getByRole("button")).toHaveCount(11);
  await expect(previewPane(page).getByRole("button", { name: /Cloud Service Agreement/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("picking a document asks the assistant, which selects and fills it in", async ({ page }) => {
  const requests = await mockChat(page, [
    {
      reply: "A Cloud Service Agreement it is. Who are the parties?",
      documentId: "cloud-service-agreement",
      fields: { effectiveDate: "2026-12-01", subscriptionPeriod: "12 months from the Order Date" },
      party1: { company: "Acme, Inc.", name: "Ada Lovelace" },
      party2: { company: "Globex" },
    },
  ]);

  await previewPane(page).getByRole("button", { name: /Cloud Service Agreement/ }).click();

  await expect(conversation(page)).toContainText("I'd like to create a Cloud Service Agreement.");
  await expect(conversation(page)).toContainText("Who are the parties?");
  await expect(preview(page).getByRole("heading", { name: "Cloud Service Agreement", exact: true }).first()).toBeVisible();
  await expect(preview(page)).toContainText("December 1, 2026");
  await expect(preview(page)).toContainText("12 months from the Order Date");
  await expect(preview(page)).toContainText("[Governing Law]");
  await expect(preview(page).getByRole("columnheader", { name: "Provider" })).toBeVisible();
  await expect(preview(page).getByRole("columnheader", { name: "Customer" })).toBeVisible();
  await expect(signatureRow(page, "Company")).toContainText("Acme, Inc.");
  await expect(signatureRow(page, "Print Name")).toContainText("[Customer Print Name]");
  // The Standard Terms follow, with nested clause numbering.
  await expect(preview(page)).toContainText("1.1 Access and Use."); // fetched on demand

  expect(requests[0].today).toBe(TODAY_ISO);
  expect(requests[0].draft).toMatchObject({ documentId: null, fields: {} });
});

test("an unsupported request keeps the picker and shows the assistant's suggestion", async ({ page }) => {
  await mockChat(page, [
    { reply: "I can't create employment contracts yet. The closest is a Professional Services Agreement. Use that?" },
  ]);

  await say(page, "I need an employment contract");

  await expect(conversation(page)).toContainText("The closest is a Professional Services Agreement");
  await expect(previewPane(page).getByRole("button", { name: /Professional Services Agreement/ })).toBeVisible();
  await expect(preview(page)).toHaveCount(0);
});

test("switching documents keeps the parties and resets the other fields", async ({ page }) => {
  const requests = await mockChat(page, [
    {
      reply: "Mutual NDA selected.",
      documentId: "mutual-nda",
      fields: { governingLaw: "Delaware" },
      party1: { company: "Acme, Inc." },
      party2: { company: "Globex" },
    },
    { reply: "Switched to a Pilot Agreement.", documentId: "pilot-agreement", fields: { pilotPeriod: "90 days" } },
  ]);

  await say(page, "An NDA between Acme and Globex, Delaware law");
  await expect(preview(page)).toContainText("Expires 1 year from Effective Date."); // NDA default
  await expect(preview(page)).toContainText("Delaware");

  await say(page, "Actually make it a pilot for 90 days");
  await expect(preview(page).getByRole("heading", { name: "Pilot Agreement", exact: true }).first()).toBeVisible();
  await expect(preview(page)).toContainText("90 days");
  await expect(preview(page)).toContainText("[Governing Law]");
  await expect(preview(page)).not.toContainText("Expires 1 year from Effective Date.");
  await expect(signatureRow(page, "Company")).toContainText("Acme, Inc.");
  await expect(signatureRow(page, "Company")).toContainText("Globex");

  // The second turn sent the NDA draft (with its defaults) to the assistant.
  expect(requests[1].draft).toMatchObject({
    documentId: "mutual-nda",
    fields: { governingLaw: "Delaware", mndaTerm: "Expires 1 year from Effective Date." },
  });
  expect(requests[1].messages.map((m) => m.role)).toEqual(["assistant", "user", "assistant", "user"]);
});

test("Shift+Enter adds a new line instead of sending", async ({ page }) => {
  const requests = await mockChat(page, [{ reply: "Thanks." }]);

  await messageBox(page).fill("Line one");
  await messageBox(page).press("Shift+Enter");
  await messageBox(page).pressSequentially("Line two");
  await expect(messageBox(page)).toHaveValue("Line one\nLine two");
  expect(requests).toHaveLength(0);

  await page.getByRole("button", { name: "Send" }).click();
  await expect(conversation(page)).toContainText("Thanks.");
  expect(requests).toHaveLength(1);
});

test("a failed turn shows the error and keeps the message for a retry", async ({ page }) => {
  await mockChat(page, [
    { status: 502, detail: "The AI assistant couldn't respond. Please try again." },
    { reply: "Welcome back!", documentId: "mutual-nda" },
  ]);

  await say(page, "An NDA please");
  await expect(chatAlert(page)).toHaveText("The AI assistant couldn't respond. Please try again.");
  await expect(messageBox(page)).toHaveValue("An NDA please");
  await expect(conversation(page)).not.toContainText("An NDA please");

  await page.getByRole("button", { name: "Send" }).click();
  await expect(conversation(page)).toContainText("Welcome back!");
  await expect(chatAlert(page)).toHaveCount(0);
  await expect(preview(page).getByRole("heading", { name: "Mutual Non-Disclosure Agreement", exact: true })).toBeVisible();
});

test("downloads the completed document as a PDF", async ({ page }) => {
  await mockChat(page, [
    {
      reply: "Noted.",
      documentId: "cloud-service-agreement",
      party1: { company: "Acme, Inc." },
      party2: { company: "Globex" },
    },
  ]);
  await say(page, "A CSA between Acme, Inc. and Globex");
  await expect(signatureRow(page, "Company")).toContainText("Globex");

  const button = page.getByRole("button", { name: "Download PDF" });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);

  expect(download.suggestedFilename()).toBe("CSA-Acme-Inc-Globex.pdf");
  const pdf = await readFile(await download.path());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(20_000);
  await expect(page.getByText("Couldn’t generate the PDF")).toHaveCount(0);
});

test("an error after the reply started streaming shows the error and keeps the message", async ({ page }) => {
  await mockChat(page, [{ streamError: "The AI assistant couldn't respond. Please try again." }]);

  await say(page, "An NDA please");

  await expect(chatAlert(page)).toHaveText("The AI assistant couldn't respond. Please try again.");
  await expect(messageBox(page)).toHaveValue("An NDA please");
  await expect(conversation(page)).not.toContainText("Let me");
});

test("autosaves the document after each turn: created on the first, then updated", async ({ page }) => {
  await mockChat(page, [
    { reply: "Mutual NDA selected.", documentId: "mutual-nda", party1: { company: "Acme, Inc." } },
    { reply: "Delaware it is.", fields: { governingLaw: "Delaware" } },
  ]);
  const saveStatus = page.getByRole("status").filter({ hasText: /saved|Saving/i });

  await expect(saveStatus).toHaveText("Not saved yet");
  await say(page, "An NDA for Acme");
  await expect(saveStatus).toHaveText("Saved");
  await expect(page.getByRole("heading", { level: 1, name: "Mutual NDA: Acme, Inc." })).toBeVisible();

  await say(page, "Delaware law");
  await expect(conversation(page)).toContainText("Delaware it is.");
  await expect.poll(() => backend.saves.length).toBe(2);

  const [created, updated] = backend.saves;
  expect(created.method).toBe("POST");
  expect(created.body).toMatchObject({ draft: { documentId: "mutual-nda", party1: { company: "Acme, Inc." } } });
  expect(updated).toMatchObject({ method: "PATCH", id: 1, body: { draft: { fields: { governingLaw: "Delaware" } } } });
  expect((updated.body.messages as unknown[]).length).toBe(5);

  // Back on the list, the document is there.
  await page.getByRole("button", { name: "← All documents" }).click();
  await expect(page.getByRole("list", { name: "Documents" })).toContainText("Mutual NDA: Acme, Inc.");
});

test("a failed save can be retried", async ({ page }) => {
  await mockChat(page, [{ reply: "Mutual NDA selected.", documentId: "mutual-nda" }]);
  let failures = 1;
  await page.route("**/api/documents", async (route) => {
    if (route.request().method() === "POST" && failures-- > 0) await route.fulfill({ status: 500, body: "" });
    else await route.fallback();
  });

  await say(page, "An NDA");
  await expect(page.getByText("Couldn’t save.")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  expect(backend.documents).toHaveLength(1);
});
