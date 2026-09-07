import { expect, test } from "@playwright/test";

test("privacy contact survives CDN email obfuscation without its decoder", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
  await page.route("**/email-decode.min.js", (route) => route.abort());
  await page.route("**/privacy", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    // Model the observed edge rewrite, leaving Cloudflare's documented opt-out
    // regions intact. No decoder runs, so hydration must not depend on its timing.
    const body = html
      .split(/(<!--email_off-->[\s\S]*?<!--\/email_off-->)/g)
      .map((part) =>
        part.startsWith("<!--email_off-->")
          ? part
          : part.replace(
              /<a\b([^>]*?)href="mailto:[^"]+"([^>]*)>[^<]+<\/a>/g,
              '<a$1href="/cdn-cgi/l/email-protection"$2><span class="__cf_email__">[email protected]</span></a>'
            )
      )
      .join("");
    await route.fulfill({ response, body });
  });

  await page.goto("/privacy", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: "liam@everex.co.kr" })).toHaveAttribute(
    "href",
    "mailto:liam@everex.co.kr"
  );
  expect(errors).toEqual([]);
});
