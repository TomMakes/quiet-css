// service_worker.ts — Storage I/O, message relay, tab tracking
// Build Step 1: Echo received messages back to the sender for round-trip testing.

browser.runtime.onMessage.addListener(
  (message: unknown, _sender: browser.runtime.MessageSender) => {
    console.log("[QuietCSS SW] Received message:", message);
    return Promise.resolve({ type: "PONG", echo: message });
  }
);

export {};
