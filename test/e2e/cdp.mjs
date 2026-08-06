/**
 * A very small Chrome DevTools Protocol client, which is the only way to drive this app.
 *
 * The window is a WebView2 with no automation surface: `SendKeys` does not reach it, and
 * there is no WebDriver. Launching with `--remote-debugging-port` and talking CDP over a
 * WebSocket is what works, and it is how the Mermaid egress bug was confirmed and the
 * `blockRemoteImages` claim refuted — in both cases by watching what left the process
 * rather than by reading the code.
 *
 * Deliberately not a framework. Everything here is a few lines of `WebSocket` and JSON;
 * a Playwright-shaped abstraction over one protocol used by one test would be more code
 * to maintain than the tests it serves.
 */

/** Connects to the page target, or throws with something actionable. */
export async function attach({ port = 9222, timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let targets;
  for (;;) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      break;
    } catch (cause) {
      if (Date.now() > deadline) {
        throw new Error(
          `nothing is listening for CDP on ${port}. Launch the app with ` +
            `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${port}" — ` +
            `see test/e2e/README.md`,
          { cause },
        );
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error(`no page target among ${targets.length}; is the window open?`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const requests = [];
  const consoleErrors = [];
  let nextId = 1;

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    // `requestWillBeSent` rather than a response event: the claim under test is that
    // nothing is *attempted*, and a request to a host that does not resolve still
    // happened.
    if (message.method === "Network.requestWillBeSent") {
      requests.push(message.params.request.url);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description).join(" "));
    }
    if (message.method === "Runtime.exceptionThrown") {
      consoleErrors.push(`uncaught: ${message.params.exceptionDetails.text}`);
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => {
      reject(new Error("CDP websocket refused the connection"));
    });
  });
  await send("Network.enable");
  await send("Runtime.enable");

  return {
    url: page.url,
    requests,
    consoleErrors,
    /** Evaluates in the page and returns the value, or throws what the page threw. */
    async evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(`page threw: ${result.exceptionDetails.text}`);
      }
      return result.result.value;
    },
    close() {
      ws.close();
    },
  };
}

export const settle = (ms) => new Promise((r) => setTimeout(r, ms));
