import { expect, test, type Page } from "@playwright/test";

import { mockBackend, mockChat, storedDocument } from "./mock-backend";

const PARTY = { name: "", title: "", company: "", noticeAddress: "" };
const documentsList = (page: Page) => page.getByRole("list", { name: "Documents" });
const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message" });
const conversation = (page: Page) => page.getByRole("log", { name: "Conversation" });

const savedNda = storedDocument(1, {
  draft: {
    documentId: "mutual-nda",
    fields: { purpose: "Evaluating a merger", governingLaw: "Delaware" },
    party1: { ...PARTY, company: "Acme, Inc." },
    party2: { ...PARTY, company: "Globex" },
  },
  messages: [
    { role: "assistant", content: "Hi! What would you like to create?" },
    { role: "user", content: "An NDA between Acme and Globex" },
    { role: "assistant", content: "Done. Which state's law?" },
  ],
  updatedAt: "2026-03-14T12:00:00Z",
});
const blankDraft = storedDocument(2, { updatedAt: "2026-03-13T12:00:00Z" });

test("a visitor creates an account and lands on an empty documents list", async ({ page }) => {
  const backend = await mockBackend(page, { user: null });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill("new@example.com");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "My documents" })).toBeVisible();
  await expect(page.getByText("No documents yet")).toBeVisible();
  await expect(page.getByText("new@example.com")).toBeVisible();
  expect(backend.user).toEqual({ id: 1, email: "new@example.com" });
});

test("a wrong password shows the error and stays on the sign-in form", async ({ page }) => {
  await mockBackend(page, { user: null });
  await page.goto("/");

  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("wrong password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Incorrect email or password." })).toBeVisible();
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "My documents" })).toBeVisible();
});

test("lists saved documents and resumes one where it left off", async ({ page }) => {
  await mockBackend(page, { documents: [blankDraft, savedNda] });
  const requests = await mockChat(page, [{ reply: "Delaware noted.", fields: { chosenCourts: "Wilmington" } }]);
  await page.goto("/");

  const rows = documentsList(page).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Mutual NDA: Acme, Inc. & Globex");
  await expect(rows.nth(0)).toContainText("Mutual Non-Disclosure Agreement");
  await expect(rows.nth(1)).toContainText("Untitled document");
  await expect(rows.nth(1)).toContainText("No document chosen yet");

  await rows.nth(0).getByRole("button", { name: /^Mutual NDA: Acme/ }).click();

  // Focus follows to the editor's heading.
  await expect(page.getByRole("heading", { level: 1, name: "Mutual NDA: Acme, Inc. & Globex" })).toBeFocused();
  await expect(conversation(page)).toContainText("Done. Which state's law?");
  await expect(page.getByRole("article")).toContainText("Evaluating a merger");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(messageBox(page)).toBeEnabled();

  await messageBox(page).fill("Courts in Wilmington");
  await messageBox(page).press("Enter");
  await expect(conversation(page)).toContainText("Delaware noted.");
  // The whole saved conversation and draft went to the assistant.
  expect(requests[0].messages).toHaveLength(4);
  expect(requests[0].draft).toMatchObject({ documentId: "mutual-nda", fields: { governingLaw: "Delaware" } });
});

test("renames and deletes documents", async ({ page }) => {
  const backend = await mockBackend(page, { documents: [savedNda, blankDraft] });
  await page.goto("/");

  await page.getByRole("button", { name: "Rename Mutual NDA: Acme, Inc. & Globex" }).click();
  await page.getByRole("textbox", { name: "Document name" }).fill("Globex merger NDA");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(documentsList(page)).toContainText("Globex merger NDA");
  await expect(page.getByRole("button", { name: "Rename Globex merger NDA" })).toBeFocused();
  expect(backend.documents.find((d) => d.id === 1)?.title).toBe("Globex merger NDA");

  await page.getByRole("button", { name: "Delete Untitled document" }).click();
  const confirm = page.getByRole("group", { name: "Delete Untitled document?" });
  await expect(confirm).toContainText("Delete this document?");
  await expect(confirm.getByRole("button", { name: "Confirm delete Untitled document" })).toBeFocused();
  await confirm.getByRole("button", { name: "Confirm delete Untitled document" }).click();
  await expect(documentsList(page).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "My documents" })).toBeFocused();
  expect(backend.documents.map((d) => d.id)).toEqual([1]);
});

test("a failed rename keeps the typed name for another try", async ({ page }) => {
  await mockBackend(page, { documents: [savedNda] });
  let failures = 1;
  await page.route(/\/api\/documents\/1$/, async (route) => {
    if (route.request().method() === "PATCH" && failures-- > 0) await route.fulfill({ status: 500, body: "" });
    else await route.fallback();
  });
  await page.goto("/");

  await page.getByRole("button", { name: /^Rename / }).click();
  await page.getByRole("textbox", { name: "Document name" }).fill("Globex merger NDA");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Couldn’t rename the document." })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Document name" })).toHaveValue("Globex merger NDA");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(documentsList(page)).toContainText("Globex merger NDA");
});

test("signing out returns to the sign-in form", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My documents" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});

test("an expired session sends the user back to sign in", async ({ page }) => {
  const backend = await mockBackend(page, { documents: [savedNda] });
  await page.goto("/");
  await expect(documentsList(page)).toBeVisible();

  backend.sessionExpired = true;
  await documentsList(page).getByRole("button", { name: /^Mutual NDA: Acme/ }).click();

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("works at phone width without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await mockBackend(page, { documents: [savedNda] });
  await page.goto("/");
  await documentsList(page).getByRole("button", { name: /^Mutual NDA: Acme/ }).click();
  await expect(page.getByRole("article")).toContainText("Evaluating a merger");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(messageBox(page)).toBeInViewport();
});
