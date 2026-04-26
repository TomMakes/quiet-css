// service_worker.ts — Storage I/O, message relay, tab tracking
// Build Step 2: Full storage handlers for rules and blinds.

import { Rule, Blind, createRule, createBlind, QCMessage } from "../shared/schema.js";

const RULES_KEY = "quietcss_rules";
const BLINDS_KEY = "quietcss_blinds";

// ---------- Hostname matching ----------

function matchesHost(pattern: string, isRegex: boolean, hostname: string): boolean {
  if (isRegex) {
    try {
      return new RegExp(pattern).test(hostname);
    } catch {
      return false;
    }
  }
  return hostname.includes(pattern);
}

// ---------- Storage helpers ----------

async function getAllRules(): Promise<Rule[]> {
  const data = await browser.storage.local.get(RULES_KEY);
  return (data[RULES_KEY] as Rule[] | undefined) ?? [];
}

async function getAllBlinds(): Promise<Blind[]> {
  const data = await browser.storage.local.get(BLINDS_KEY);
  return (data[BLINDS_KEY] as Blind[] | undefined) ?? [];
}

async function saveAllRules(rules: Rule[]): Promise<void> {
  await browser.storage.local.set({ [RULES_KEY]: rules });
}

async function saveAllBlinds(blinds: Blind[]): Promise<void> {
  await browser.storage.local.set({ [BLINDS_KEY]: blinds });
}

// ---------- Message handler ----------

browser.runtime.onMessage.addListener(
  (message: unknown, _sender: browser.runtime.MessageSender) => {
    const msg = message as QCMessage;
    console.log("[QuietCSS SW] Received message:", msg.type);

    switch (msg.type) {

      case "PING":
        return Promise.resolve({ type: "PONG", payload: { echo: msg } });

      case "GET_RULES": {
        const hostname = msg.payload.hostname as string;
        return (async () => {
          const allRules = await getAllRules();
          const allBlinds = await getAllBlinds();
          const rules = allRules.filter(r => matchesHost(r.hostPattern, r.isRegex, hostname));
          const blinds = allBlinds.filter(b => matchesHost(b.hostPattern, b.isRegex, hostname));
          return { type: "RULES_DATA", payload: { rules, blinds } };
        })();
      }

      case "SAVE_RULE": {
        const incoming = msg.payload.rule as Partial<Rule>;
        return (async () => {
          if (incoming.isRegex) {
            try {
              new RegExp(incoming.hostPattern ?? "");
            } catch (e) {
              return { type: "ERROR", payload: { error: `Invalid regex pattern for hostPattern: ${String(e)}` } };
            }
          }
          const rules = await getAllRules();
          const rule = createRule(incoming);
          const idx = rules.findIndex(r => r.id === rule.id);
          if (idx >= 0) {
            rules[idx] = rule;
          } else {
            rules.push(rule);
          }
          await saveAllRules(rules);
          return { type: "RULE_SAVED", payload: { rule } };
        })();
      }

      case "DELETE_RULE": {
        const id = msg.payload.id as string;
        return (async () => {
          const rules = await getAllRules();
          await saveAllRules(rules.filter(r => r.id !== id));
          return { type: "RULE_DELETED", payload: { id } };
        })();
      }

      case "TOGGLE_RULE": {
        const id = msg.payload.id as string;
        const enabled = msg.payload.enabled as boolean;
        return (async () => {
          const rules = await getAllRules();
          const rule = rules.find(r => r.id === id);
          if (!rule) return { type: "ERROR", payload: { error: `Rule ${id} not found` } };
          rule.enabled = enabled;
          await saveAllRules(rules);
          return { type: "RULE_UPDATED", payload: { rule } };
        })();
      }

      case "SAVE_BLIND": {
        const incoming = msg.payload.blind as Partial<Blind>;
        return (async () => {
          const blinds = await getAllBlinds();
          const blind = createBlind(incoming);
          const idx = blinds.findIndex(b => b.id === blind.id);
          if (idx >= 0) {
            blinds[idx] = blind;
          } else {
            blinds.push(blind);
          }
          await saveAllBlinds(blinds);
          return { type: "BLIND_SAVED", payload: { blind } };
        })();
      }

      case "DELETE_BLIND": {
        const id = msg.payload.id as string;
        return (async () => {
          const blinds = await getAllBlinds();
          await saveAllBlinds(blinds.filter(b => b.id !== id));
          return { type: "BLIND_DELETED", payload: { id } };
        })();
      }

      case "TOGGLE_BLIND": {
        const id = msg.payload.id as string;
        const enabled = msg.payload.enabled as boolean;
        return (async () => {
          const blinds = await getAllBlinds();
          const blind = blinds.find(b => b.id === id);
          if (!blind) return { type: "ERROR", payload: { error: `Blind ${id} not found` } };
          blind.enabled = enabled;
          await saveAllBlinds(blinds);
          return { type: "BLIND_UPDATED", payload: { blind } };
        })();
      }

      default:
        console.warn("[QuietCSS SW] Unknown message type:", msg.type);
        return undefined;
    }
  }
);

export {};
