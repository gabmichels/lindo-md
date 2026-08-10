import { THEMES, tokensFor } from "./themes.js";

const REPO = "gabmichels/lindo-md";
const root = document.documentElement;

/* --- theme ---------------------------------------------------------------- */

let themeId = read("lindo-theme") ?? "house";
let appearance = root.dataset.appearance === "dark" ? "dark" : "light";

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode. The page works, it just does not remember.
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nothing to do about it, and nothing to tell the reader */
  }
}

function current() {
  return THEMES.find((t) => t.id === themeId) ?? THEMES[0];
}

/**
 * Paint one half of one preset onto `<html>`.
 *
 * Onto the root rather than onto a canvas element, which is the one place this
 * page diverges from the app: there, chrome lives on the root and the paper on
 * the canvas so a themed card can nest inside a themed page. Nothing nests
 * here, and the whole page is the paper.
 */
function apply() {
  const theme = current();
  const tokens = tokensFor(theme, appearance);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  root.dataset.appearance = appearance;

  for (const button of document.querySelectorAll("[data-appearance-set]")) {
    button.setAttribute("aria-pressed", String(button.dataset.appearanceSet === appearance));
  }
  for (const button of document.querySelectorAll("[data-theme-id]")) {
    button.setAttribute("aria-pressed", String(button.dataset.themeId === theme.id));
  }

  const note = document.getElementById("theme-note");
  if (note) note.textContent = `${theme.name} — ${theme.note}`;
}

/* --- the gallery ---------------------------------------------------------- */

const gallery = document.getElementById("theme-gallery");

for (const theme of THEMES) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "swatch";
  button.dataset.themeId = theme.id;
  button.setAttribute("aria-pressed", "false");
  // Each card previews its *own* half of the current appearance, so switching
  // the page to dark switches the whole gallery with it.
  button.innerHTML = `
    <div class="swatch-body">
      <div class="swatch-name">${theme.name}</div>
      <div class="swatch-line">The quick brown fox <em>jumps</em></div>
      <div class="swatch-chips">
        <i data-chip="link"></i><i data-chip="accent"></i><i data-chip="heading"></i><i data-chip="muted"></i>
      </div>
    </div>`;
  button.addEventListener("click", () => {
    themeId = theme.id;
    write("lindo-theme", themeId);
    apply();
    paintGallery();
  });
  gallery.append(button);
}

/** The cards are painted from the palette data, not from inherited tokens —
 *  a card showing the page's colors would show twenty identical cards. */
function paintGallery() {
  for (const theme of THEMES) {
    const button = gallery.querySelector(`[data-theme-id="${theme.id}"]`);
    const p = theme[appearance];
    button.style.setProperty("--sw-bg", p.bg);
    button.style.setProperty("--sw-text", p.text);
    button.style.setProperty("--sw-heading", p.heading);
    button.style.setProperty("--sw-link", p.link);
    button.style.setProperty("--sw-border", p.border);
    const chips = {
      link: p.link,
      accent: p.accent ?? p.link,
      heading: p.heading,
      muted: p.muted,
    };
    for (const [name, color] of Object.entries(chips)) {
      button.querySelector(`[data-chip="${name}"]`).style.background = color;
    }
  }
}

/* --- appearance ----------------------------------------------------------- */

for (const button of document.querySelectorAll("[data-appearance-set]")) {
  button.addEventListener("click", () => {
    appearance = button.dataset.appearanceSet;
    write("lindo-appearance", appearance);
    apply();
    paintGallery();
  });
}

// Follow the system only while the reader has not chosen for themselves.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
  if (read("lindo-appearance")) return;
  appearance = event.matches ? "dark" : "light";
  apply();
  paintGallery();
});

apply();
paintGallery();

/* --- downloads ------------------------------------------------------------ */

/**
 * Guess the platform so the hero button says one thing instead of five.
 *
 * A guess, and treated as one: it only relabels the button and re-orders the
 * cards. Every asset stays reachable from the download section whatever this
 * returns, because a reader on a Chromebook downloading for their desktop is
 * not an edge case.
 */
function platform() {
  const hint = navigator.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;
  if (/win/i.test(hint)) return "windows";
  if (/mac|darwin/i.test(hint)) return "macos";
  if (/linux|x11|cros/i.test(hint) && !/android/i.test(hint)) return "linux";
  return null;
}

const LABELS = { windows: "Download for Windows", linux: "Download for Linux" };

const button = document.getElementById("download-primary");
const label = document.getElementById("download-label");
const here = platform();

if (LABELS[here]) label.textContent = LABELS[here];
else if (here === "macos") label.textContent = "Build for macOS";
else label.textContent = "Download";

/**
 * Fill in the version and wire the buttons to the actual assets.
 *
 * Best-effort on purpose. Unauthenticated GitHub API calls are rate-limited per
 * IP, the page is static, and there is no key to hide in it — so every failure
 * path leaves the markup exactly as it shipped, pointing at
 * `/releases/latest`, which is always correct if less specific.
 */
async function loadRelease() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  const release = await response.json();

  const assets = release.assets ?? [];
  const find = (pattern) => assets.find((asset) => pattern.test(asset.name));

  const version = (release.tag_name ?? "").replace(/^v/, "");
  if (version) {
    document.getElementById("release-meta").innerHTML =
      `Version ${escapeHtml(version)} · free and MIT licensed · ` +
      `<a href="https://github.com/${REPO}/releases">All releases</a>`;
    document.getElementById("download-version").textContent =
      `Version ${version}, released ${formatDate(release.published_at)}. Installers are published on GitHub with every release.`;
  }

  const setup = find(/x64-setup\.exe$/i);
  const msi = find(/\.msi$/i);
  const appimage = find(/\.AppImage$/i);
  const deb = find(/\.deb$/i);
  const rpm = find(/\.rpm$/i);

  fillAssets("assets-windows", [setup, msi]);
  fillAssets("assets-linux", [appimage, deb, rpm]);

  const direct = here === "windows" ? setup : here === "linux" ? appimage : null;
  if (direct) {
    button.href = direct.browser_download_url;
    label.textContent = `${LABELS[here]} · ${size(direct.size)}`;
  }
}

function fillAssets(id, assets) {
  const list = document.getElementById(id);
  const present = assets.filter(Boolean);
  if (!present.length) return;
  list.replaceChildren(
    ...present.map((asset) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = asset.browser_download_url;
      link.textContent = asset.name;
      item.append(link, ` — ${size(asset.size)}`);
      return item;
    }),
  );
}

function size(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return "recently";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function escapeHtml(text) {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

loadRelease().catch(() => {
  /* The static markup is the fallback, and it is already on the page. */
});
