import { test, expect, signIn, users } from "./fixtures";
import { createClient } from "@supabase/supabase-js";

// Files in an agent conversation (Jason, 2026-11-02): the paperclip
// reads a file to text, the file shows as a chip, and the text is
// saved inside the leader's message, ahead of what they typed. Plain
// Aimee chats have no paperclip.

function db() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

test.describe("files in an agent conversation", () => {
  test.describe.configure({ timeout: 600_000 });

  test("a file goes with the message, and shows as a chip", async ({ page }) => {
    await signIn(page, users.companyAdmin());
    await page.goto("/ask-aimee/new?agent=vivid-vision");
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const conversationId = /\/ask-aimee\/([0-9a-f-]{36})/.exec(page.url())![1];

    await page.getByTestId("composer-file-input").setInputFiles({
      name: "Brand story.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Harbour Build finishes the jobs other builders walk away from."),
    });
    await expect(page.getByTestId("composer-file")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("composer-file")).toContainText("Brand story.txt");

    const composer = page.getByRole("textbox").first();
    await composer.fill("I'm the owner. Here is our brand story to work from.");
    await composer.press("Enter");

    const bubbleFile = page.getByTestId("bubble-file");
    await expect(bubbleFile).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("composer-file")).toHaveCount(0);
    // The file's text is not shown in the chat.
    await expect(page.getByText("walk away from", { exact: false })).toHaveCount(0);

    await expect(async () => {
      const { data } = await db()
        .from("coaching_messages")
        .select("content")
        .eq("conversation_id", conversationId)
        .eq("role", "user")
        .order("created_at", { ascending: true })
        .limit(1)
        .single<{ content: string }>();
      expect(data?.content).toMatch(/^<attached_file name="Brand story\.txt">\nHarbour Build finishes/);
      expect(data?.content).toMatch(/<\/attached_file>\n\nI'm the owner\./);
    }).toPass({ timeout: 30_000 });

    // Reloaded, it is still a chip.
    await page.reload();
    await expect(page.getByTestId("bubble-file")).toHaveCount(1, { timeout: 30_000 });
  });

  test("a plain Aimee conversation has no paperclip", async ({ page }) => {
    await signIn(page, users.companyAdmin());
    await page.goto("/ask-aimee");
    await page.getByRole("button", { name: /new|start|ask/i }).first().click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByRole("textbox").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Attach a file" })).toHaveCount(0);
  });
});
