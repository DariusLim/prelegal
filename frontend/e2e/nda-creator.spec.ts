import { readFile } from "node:fs/promises";

import { expect, test, type Page, type Route } from "@playwright/test";

/** Fixed "now" in the browser, so the default Effective Date is deterministic. */
const NOW = new Date("2026-03-15T10:00:00");
const TODAY_ISO = "2026-03-15";
const TODAY_LONG = "March 15, 2026";

const preview = (page: Page) => page.getByRole("article");
const conversation = (page: Page) => page.getByRole("log", { name: "Conversation" });
// Scoped: Next.js renders its own (empty) role="alert" route announcer.
const chatAlert = (page: Page) => page.getByRole("region", { name: "NDA assistant" }).getByRole("alert");
const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message" });
const signatureRow = (page: Page, label: string) =>
  preview(page).getByRole("row", { name: new RegExp(`^${label}`) });

interface ChatTurn {
  reply: string;
  updates?: Record<string, unknown>;
}

/**
 * Answers /api/chat with the given turns in order (the backend and LLM are not
 * involved) and records each request body.
 */
async function mockChat(page: Page, turns: (ChatTurn | { status: number; detail: string })[]) {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/chat", async (route: Route) => {
    requests.push(route.request().postDataJSON());
    const turn = turns.shift();
    if (!turn) throw new Error("unexpected chat request");
    if ("status" in turn) {
      await route.fulfill({ status: turn.status, json: { detail: turn.detail } });
    } else {
      await route.fulfill({ json: { updates: {}, ...turn } });
    }
  });
  return requests;
}

async function say(page: Page, text: string) {
  await messageBox(page).fill(text);
  await messageBox(page).press("Enter");
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto("/");
  // The page is prerendered; the message box is enabled only once hydrated.
  await expect(messageBox(page)).toBeEnabled();
});

test("opens with the assistant's greeting and the NDA with placeholders, without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  page.on("pageerror", (err) => errors.push(err.message));
  await page.reload();
  await expect(messageBox(page)).toBeEnabled();

  await expect(conversation(page)).toContainText("who are the two parties");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(preview(page).getByRole("heading", { name: "Mutual Non-Disclosure Agreement", exact: true })).toBeVisible();
  await expect(preview(page).getByRole("heading", { name: "Standard Terms" })).toBeVisible();
  await expect(preview(page)).toContainText(TODAY_LONG);
  await expect(preview(page)).toContainText("[Governing Law (state)]");
  await expect(signatureRow(page, "Company")).toContainText("[Party 1 Company]");
  await expect(preview(page)).toContainText("11. General.");
  expect(errors).toEqual([]);
});

test("the assistant's answers fill in the document", async ({ page }) => {
  const requests = await mockChat(page, [
    {
      reply: "Got it. Which state's law should govern?",
      updates: {
        party1: { company: "Acme, Inc.", name: "Ada Lovelace", title: "CEO", noticeAddress: "ada@acme.test" },
        party2: { company: "Globex" },
        mndaTermType: "untilTerminated",
      },
    },
    {
      reply: "Done! You can download the PDF now.",
      updates: {
        governingLaw: "Delaware",
        jurisdiction: "courts located in New Castle, DE",
        effectiveDate: "2026-12-01",
        confidentialityType: "perpetual",
      },
    },
  ]);

  await say(page, "Acme (I'm Ada Lovelace, CEO, ada@acme.test) and Globex. No end date.");
  await expect(conversation(page)).toContainText("Which state's law should govern?");
  await expect(messageBox(page)).toHaveValue("");
  await expect(signatureRow(page, "Company")).toContainText("Acme, Inc.");
  await expect(signatureRow(page, "Company")).toContainText("Globex");
  await expect(signatureRow(page, "Print Name")).toContainText("Ada Lovelace");
  await expect(preview(page)).toContainText("Continues until terminated in accordance with the terms of the MNDA.");

  await say(page, "Delaware, New Castle courts, starting Dec 1, confidential forever");
  await expect(conversation(page)).toContainText("You can download the PDF now.");
  await expect(preview(page)).toContainText("Governing Law: Delaware");
  await expect(preview(page)).toContainText("Jurisdiction: courts located in New Castle, DE");
  await expect(preview(page)).toContainText("December 1, 2026");
  await expect(preview(page)).toContainText("In perpetuity.");
  // Untouched fields keep their values.
  await expect(signatureRow(page, "Company")).toContainText("Acme, Inc.");

  // Each turn sends the whole conversation, the current fields and the user's date.
  expect(requests).toHaveLength(2);
  const second = requests[1] as { messages: { role: string; content: string }[]; fields: Record<string, unknown>; today: string };
  expect(second.today).toBe(TODAY_ISO);
  expect(second.messages.map((m) => m.role)).toEqual(["assistant", "user", "assistant", "user"]);
  expect(second.messages[1].content).toContain("Ada Lovelace");
  expect(second.fields).toMatchObject({ mndaTermType: "untilTerminated", party2: { company: "Globex" } });
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
    { reply: "Welcome back!", updates: { party1: { company: "Acme" } } },
  ]);

  await say(page, "Acme and Globex");
  await expect(chatAlert(page)).toHaveText("The AI assistant couldn't respond. Please try again.");
  await expect(messageBox(page)).toHaveValue("Acme and Globex");
  await expect(conversation(page)).not.toContainText("Acme and Globex");

  await page.getByRole("button", { name: "Send" }).click();
  await expect(conversation(page)).toContainText("Welcome back!");
  await expect(chatAlert(page)).toHaveCount(0);
  await expect(signatureRow(page, "Company")).toContainText("Acme");
});

test("downloads the completed NDA as a PDF", async ({ page }) => {
  await mockChat(page, [{ reply: "Noted.", updates: { party1: { company: "Acme, Inc." }, party2: { company: "Globex" } } }]);
  await say(page, "Acme, Inc. and Globex");
  await expect(signatureRow(page, "Company")).toContainText("Globex");

  const button = page.getByRole("button", { name: "Download PDF" });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);

  expect(download.suggestedFilename()).toBe("Mutual-NDA-Acme-Inc-Globex.pdf");
  const pdf = await readFile(await download.path());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(10_000);

  await expect(button).toBeVisible();
  await expect(page.getByText("Couldn’t generate the PDF")).toHaveCount(0);
});
