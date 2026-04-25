// sidebar.ts — UI logic + message passing
// Build Step 1: Send PING to background, display PONG response.

document.addEventListener("DOMContentLoaded", () => {
  const pingBtn = document.getElementById("ping-btn") as HTMLButtonElement | null;
  const responseArea = document.getElementById("response-area") as HTMLPreElement | null;

  if (!pingBtn || !responseArea) return;

  pingBtn.addEventListener("click", async () => {
    try {
      const response = await browser.runtime.sendMessage({ type: "PING", payload: {} });
      responseArea.textContent = JSON.stringify(response, null, 2);
    } catch (err) {
      responseArea.textContent = `Error: ${String(err)}`;
    }
  });
});

export {};
