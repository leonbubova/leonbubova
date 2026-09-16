// Regenerates the auto sections of README.md between the marker comments.
// Public repos only — this README is public. Usage:
//   GITHUB_TOKEN=$(gh auth token) node scripts/update-readme.mjs
import { readFileSync, writeFileSync } from "node:fs";

const OWNER = process.env.GH_OWNER ?? "leonbubova";
const TOKEN = process.env.GITHUB_TOKEN;
const README = new URL("../README.md", import.meta.url);
const RECENT_DAYS = 60;

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "profile-readme",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function listPublicRepos() {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/users/${OWNER}/repos?per_page=100&page=${page}&type=owner`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

// <owner>.github.io/<repo>/ 301s to the custom domain if there is one, and
// 404s if has_pages is set but nothing is deployed.
async function resolvePagesUrl(repo) {
  const guess =
    repo.name.toLowerCase() === `${OWNER.toLowerCase()}.github.io`
      ? `https://${OWNER}.github.io/`
      : `https://${OWNER}.github.io/${repo.name}/`;
  try {
    const res = await fetch(guess, { method: "HEAD", redirect: "manual" });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) return new URL(loc, guess).href;
    if (res.status === 404) return null;
  } catch {}
  return guess;
}

const rel = (iso) => {
  const d = (Date.now() - new Date(iso)) / 864e5;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return `${Math.floor(d)}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
};
const short = (u) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

const repos = (await listPublicRepos())
  .filter((r) => !r.fork)
  .sort((a, b) => (a.pushed_at < b.pushed_at ? 1 : -1));
for (const r of repos) r.pages_url = r.has_pages ? await resolvePagesUrl(r) : null;

const live = repos.filter((r) => r.pages_url && !r.archived);
const cutoff = Date.now() - RECENT_DAYS * 864e5;
const recent = repos.filter((r) => !r.archived && new Date(r.pushed_at) > cutoff);
const rest = repos.filter((r) => !recent.includes(r));

const siteRow = (r) =>
  `| **[${r.name}](${r.pages_url})** | \`${short(r.pages_url)}\` | [repo](${r.html_url}) | ${rel(r.pushed_at)} |`;
const repoRow = (r) =>
  `| [${r.name}](${r.html_url})${r.archived ? " 📦" : ""} | ${cell(r.description)} | ${r.pages_url ? `[live](${r.pages_url})` : ""} | ${r.language ?? ""} | ${rel(r.pushed_at)} |`;

const sites = [
  `### 🌐 Live sites`,
  ``,
  `| Site | URL | | Last push |`,
  `|---|---|---|---|`,
  ...live.map(siteRow),
].join("\n");

const activity = [
  `### 🔨 Pushed in the last ${RECENT_DAYS} days`,
  ``,
  `| Repo | About | | Lang | Last push |`,
  `|---|---|---|---|---|`,
  ...recent.map(repoRow),
  ``,
  `<details><summary>All other public repos (${rest.length})</summary>`,
  ``,
  `| Repo | About | | Lang | Last push |`,
  `|---|---|---|---|---|`,
  ...rest.map(repoRow),
  ``,
  `</details>`,
].join("\n");

const stamp = `<sub>auto-updated ${new Date().toISOString().slice(0, 10)} by [update-readme.yml](.github/workflows/update-readme.yml)</sub>`;

let md = readFileSync(README, "utf8");
const replace = (name, body) => {
  const re = new RegExp(`<!-- ${name}:START -->[\\s\\S]*?<!-- ${name}:END -->`);
  if (!re.test(md)) throw new Error(`marker ${name} missing in README.md`);
  md = md.replace(re, `<!-- ${name}:START -->\n${body}\n<!-- ${name}:END -->`);
};
replace("SITES", sites);
replace("REPOS", activity);
replace("STAMP", stamp);
writeFileSync(README, md);
console.log(`${live.length} live sites, ${recent.length} recent, ${rest.length} other`);
