/**
 * Smoke tests against the real app, over CDP.
 *
 * What this is for: the things no unit test can reach. Every check here corresponds to
 * something that was once wrong and was found — or wrongly *claimed* — only by watching
 * the running window.
 *
 *   - a Mermaid diagram fetched a remote image, twice per render, and nothing in the
 *     unit tests could have seen it
 *   - `blockRemoteImages` was reported broken by an audit and turned out to work; the
 *     evidence either way was the network trace
 *   - every external link in v1.0.0 was dead, silently, because the rejection was
 *     unobserved
 *
 * What it is not: a full end-to-end suite. Native file dialogs cannot be driven over
 * CDP, so anything behind Open/Save/Export is out of reach, and this does not run in CI
 * because it needs a real windowing environment and a built binary. It is a local
 * command you run before a release, and `test/e2e/README.md` says so.
 */
import { attach, settle } from "./cdp.mjs";

const FIXTURE_MARK = "e2e-smoke";

/** Hosts the app is allowed to talk to. Everything else is a finding. */
const ALLOWED = [
  "http://localhost:1420", // the dev server, in a dev build
  "http://127.0.0.1:1420",
  "http://ipc.localhost", // Tauri's own IPC transport
  "http://asset.localhost", // local files, granted per opened directory
  "asset://",
  "tauri://",
  "devtools://",
  "blob:",
  "data:",
];

const checks = [];
/**
 * `required` marks a check the rest depend on. Without this the first run of this
 * harness reported "nothing reaches the network" as a PASS while the fixture was not
 * even open — a vacuous pass, which is worse than a failure because it reads as
 * evidence. If a required check fails the run stops rather than reporting on a
 * document nobody asked about.
 */
const check = (name, fn, { required = false } = {}) => checks.push({ name, fn, required });

/**
 * A page-side expression for the *active* tab's scroller.
 *
 * `DocumentDeck` keeps every open tab mounted and hides the inactive ones, so a bare
 * `document.querySelector('article')` returns whichever document sits first in the DOM
 * rather than the one under test. With a single tab open those are the same element,
 * which is why this harness was fine until the first run against a restored session:
 * it clicked the fixture's tab, then measured a different tab's document and reported
 * the fixture as unrendered.
 *
 * Every query below is scoped through this. Ambient `document.querySelector` in a
 * check is a bug waiting for someone to have two tabs open.
 */
const ACTIVE = `[...document.querySelectorAll('.doc-scroller')].find((el) => el.getClientRects().length > 0)`;

check(
  "the fixture is the active document",
  async (cdp) => {
    const active = await cdp.evaluate(`(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const target = tabs.find((t) =>
      /${FIXTURE_MARK}/i.test(t.textContent || '') || /${FIXTURE_MARK}/i.test(t.getAttribute('title') || ''));
    if (target) target.click();
    return {
      found: !!target,
      tabs: tabs.map((t) => (t.textContent || '').trim()).filter(Boolean),
    };
  })()`);

    // The app restores its previous session, so the fixture is not necessarily active on
    // launch — a run that assumed it was would measure a different document and pass for
    // the wrong reason.
    if (!active.found) {
      throw new Error(
        `no tab matching "${FIXTURE_MARK}". Open test/e2e/fixtures/${FIXTURE_MARK}.md. ` +
          `Tabs present: ${active.tabs.join(", ") || "(none)"}`,
      );
    }
    await settle(2000);

    const body = await cdp.evaluate(
      `((${ACTIVE})?.querySelector('article')?.textContent || '').slice(0, 200)`,
    );
    if (!body.includes("smoke")) {
      throw new Error(`the fixture does not appear to be rendered; article begins: ${body}`);
    }
  },
  { required: true },
);

check(
  "a Mermaid diagram renders",
  async (cdp) => {
    await cdp.evaluate(
      `(${ACTIVE})?.querySelector('.mermaid-src, figure.mermaid')?.scrollIntoView(), 1`,
    );
    // Rendering is behind an IntersectionObserver and loads ~2MB of Mermaid on first use.
    await settle(6000);

    const rendered = await cdp.evaluate(`(() => {
    const doc = ${ACTIVE};
    const figure = doc?.querySelector('figure.mermaid');
    return {
      present: !!figure,
      failed: !!doc?.querySelector('figure.mermaid-error'),
      svg: !!figure?.querySelector('svg'),
    };
  })()`);

    if (rendered.failed) throw new Error("the diagram rendered as an error figure");
    if (!rendered.present || !rendered.svg) {
      throw new Error(`no rendered diagram: ${JSON.stringify(rendered)}`);
    }
  },
  { required: true },
);

check("nothing in the document reaches the network", async (cdp) => {
  // The claim on the README, and the one two separate bugs have broken. The fixture
  // carries a remote image and a Mermaid label with an <img> in it; both are supposed to
  // be inert.
  const escaped = cdp.requests.filter((url) => !ALLOWED.some((prefix) => url.startsWith(prefix)));
  if (escaped.length > 0) {
    throw new Error(`requests left the process:\n  ${escaped.join("\n  ")}`);
  }
});

check("the rendered diagram holds no remote reference", async (cdp) => {
  // Belt and braces against the network check: a reference that is present but not yet
  // fetched would pass the trace and still be a hole.
  const leaked = await cdp.evaluate(`(() => {
    const figure = (${ACTIVE})?.querySelector('figure.mermaid');
    const html = figure ? figure.innerHTML : '';
    return { probe: html.includes('probe-'), imgs: figure?.querySelectorAll('img').length ?? 0 };
  })()`);
  if (leaked.probe) throw new Error("the diagram still contains the probe host");
});

check("the document's --doc-* tokens reach the page", async (cdp) => {
  // Deliberately not a colour comparison. The first version converted the token to rgb
  // through a probe element and looked for an element painting exactly that; it failed
  // against a perfectly healthy page, because computed colour formats do not round-trip
  // reliably. A check that goes red on correct behaviour gets deleted, so this asserts
  // the thing that actually matters and can be known for certain: the tokens exist, are
  // non-empty, and a change to one is observable.
  const tokens = await cdp.evaluate(`(() => {
    const root = document.documentElement;
    const read = (name) => getComputedStyle(root).getPropertyValue(name).trim();
    const missing = ['--doc-bg', '--doc-text', '--doc-accent'].filter((t) => !read(t));

    const before = getComputedStyle(document.body).backgroundColor;
    root.style.setProperty('--doc-bg', 'rgb(1, 2, 3)');
    const changed = getComputedStyle((${ACTIVE}) ?? document.body).backgroundColor;
    root.style.removeProperty('--doc-bg');

    return { missing, before, changed };
  })()`);

  if (tokens.missing.length > 0) {
    throw new Error(`document tokens not set: ${tokens.missing.join(", ")}`);
  }
  if (tokens.changed === tokens.before) {
    throw new Error("changing --doc-bg repainted nothing; the token is decorative");
  }
});

/**
 * The command palette, which is here for two reasons a unit test cannot reach.
 *
 * The caret: `CommandPalette` focuses its own field from a `requestAnimationFrame`,
 * after Radix's focus scope, and Chromium *selects the whole value* when an input is
 * focused from script. That made the `>` the box opens with disappear on the first
 * keystroke — Ctrl+Shift+P then "theme" landed in quick-open and searched for a file
 * called theme. It was caught by looking at a screenshot, and nothing else would have.
 *
 * The suspension: every shortcut is registered on `window`, so the only way to observe
 * that they stop firing while a modal owns the keyboard is to press one.
 */
check("the command palette opens with its caret after the prefix", async (cdp) => {
  const key = (init) =>
    `window.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, cancelable: true, ${init}}))`;

  await cdp.evaluate(key(`key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true`));
  await settle(400);

  const field = await cdp.evaluate(`(() => {
    const box = document.querySelector('[role="combobox"]');
    return box && { value: box.value, caret: box.selectionStart, focused: box === document.activeElement };
  })()`);

  if (!field) throw new Error("Ctrl+Shift+P opened no palette");
  if (!field.focused) throw new Error("the palette opened without focus in its field");
  if (field.value !== ">")
    throw new Error(`expected the box to hold ">", got ${JSON.stringify(field.value)}`);
  if (field.caret !== 1) {
    throw new Error(
      `caret at ${field.caret}, not after the prefix — the first keystroke will replace it`,
    );
  }

  // Ctrl+F must not reach the window handler while this is open.
  await cdp.evaluate(key(`key: 'f', code: 'KeyF', ctrlKey: true`));
  await settle(300);
  if (await cdp.evaluate(`!!document.querySelector('[role="search"]')`)) {
    throw new Error("Ctrl+F opened the find bar behind the palette; shortcuts are not suspended");
  }

  await cdp.evaluate(key(`key: 'Escape', code: 'Escape'`));
  await settle(300);
  if (await cdp.evaluate(`!!document.querySelector('[role="combobox"]')`)) {
    throw new Error("Escape left the palette open");
  }
});

check("the page logged no errors", async (cdp) => {
  if (cdp.consoleErrors.length > 0) {
    throw new Error(`console errors:\n  ${cdp.consoleErrors.join("\n  ")}`);
  }
});

const cdp = await attach();
console.log(`attached to ${cdp.url}\n`);

let failed = 0;
let ran = 0;
for (const { name, fn, required } of checks) {
  ran += 1;
  try {
    await fn(cdp);
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${error.message.split("\n").join("\n        ")}`);
    if (required) {
      console.log("\n  Stopping — everything after this would be measuring the wrong page.");
      break;
    }
  }
}

// Reported as "of those that ran", not "of all". The first version printed "5/6 passed"
// after stopping at the very first check — counting five it had never executed. That is
// the same vacuous-evidence mistake `required` exists to prevent, one level up.
const skipped = checks.length - ran;
console.log(`\n${ran - failed}/${ran} passed` + (skipped > 0 ? `, ${skipped} not run` : ""));
cdp.close();
process.exit(failed === 0 ? 0 : 1);
