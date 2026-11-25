// Browser smoke test. Serves the built app from dist/ with a pretend server, then opens it on a phone and a desktop screen.
// Run after "npm run build":  node scripts/smoke.mjs   (needs the playwright package and a Chromium: see .github/workflows/check.yml)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright";

const DIST = path.resolve("dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/status") {
    const ok = req.headers["x-access-code"] === "letmein";
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    return res.end(JSON.stringify(ok ? { voice: true, voiceProvider: "test", pexels: false, pixabay: false } : { error: "Wrong or missing access code." }));
  }
  if (u.pathname.startsWith("/api/")) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"not in test"}'); }
  let f = path.join(DIST, u.pathname === "/" ? "index.html" : u.pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const project = { v: 1, topic: "Test", scenes: [{ id: "a", title: "One", text: "Hello there. This is a test.", onScreen: "", visual: "", duration: 0, palette: "" }] };
const problems = [];
const browser = await chromium.launch();
const seed = (ctx, proj) => ctx.addInitScript((p) => {
  if (localStorage.getItem("seeded")) return;
  localStorage.setItem("seeded", "1");
  localStorage.setItem("vortex-access", "letmein");
  localStorage.setItem("vortex-session", "2026-11-02");
  if (p) localStorage.setItem("vortex-project", JSON.stringify(p));
}, proj);

for (const [name, opts] of [["phone", devices["Pixel 7"]], ["desktop", { viewport: { width: 1366, height: 800 } }]]) {
  const ctx = await browser.newContext({ ...opts, acceptDownloads: true });
  await seed(ctx, project);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${name}: page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`${name}: console error: ${m.text().slice(0, 140)}`); });
  await page.goto(base);
  await page.waitForSelector("button:has-text('Publish')", { timeout: 15000 });
  for (const tab of ["Create", "Scenes", "Audio", "Camera", "Publish"]) {
    await page.getByRole("button", { name: tab, exact: true }).first().click();
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
    await page.waitForTimeout(150);
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) problems.push(`${name}: sideways scrolling on the ${tab} tab`);
  }

  // Backup and restore round trip (desktop only, once)
  if (name === "desktop") {
    await page.getByRole("button", { name: "Create", exact: true }).first().click();
    await page.waitForTimeout(1200); // the project is saved a moment after it loads
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download project file" }).click()]);
    const saved = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    if (saved.v !== 1 || !saved.scenes?.length) problems.push("backup: the downloaded file is not a valid project");
    page.once("dialog", (d) => d.accept());
    const file = (n, body) => ({ name: n, mimeType: "application/json", buffer: Buffer.from(body) });
    await page.locator('input[type=file][accept*="json"]').setInputFiles(file("p.json", JSON.stringify({ ...project, topic: "Restored" })));
    await page.waitForSelector("button:has-text('Publish')", { timeout: 15000 });
    await page.waitForTimeout(500);
    const topic = await page.evaluate(() => JSON.parse(localStorage.getItem("vortex-project") || "{}").topic);
    if (topic !== "Restored") problems.push(`backup: restore did not load the file (topic is ${topic})`);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Create", exact: true }).first().click();
    await page.locator('input[type=file][accept*="json"]').setInputFiles(file("bad.json", "not json"));
    await page.waitForSelector("text=not a project file", { timeout: 5000 }).catch(() => problems.push("backup: a bad file did not show a message"));
  }
  await ctx.close();
}

// A damaged project (scene fields of the wrong kind) must open normally, not crash the app.
{
  const ctx = await browser.newContext(devices["Pixel 7"]);
  await seed(ctx, { ...project, scenes: [{ id: 7, title: null, text: 123, palette: "x", duration: "y" }] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector("button:has-text('Publish')", { timeout: 15000 }).catch(() => problems.push("damaged project: the app did not open"));
  if (errors.length) problems.push(`damaged project: page error: ${errors[0]}`);
  await ctx.close();
}

await browser.close();
server.close();
if (problems.length) { console.error("Smoke test FAILED:\n- " + problems.join("\n- ")); process.exit(1); }
console.log("Smoke test passed.");
