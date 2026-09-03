/**
 * Example Plugin — Tool & Command Extension
 *
 * Demonstrates the complete patterns for registering custom tools and
 * slash commands in pi:
 *
 * - Tool: `example_tool` — callable by the AI model
 *     - typebox schema + StringEnum (Google API compatible)
 *     - two-tier error signaling: throw for hard failures, structured
 *       content with recovery clues for self-correctable failures
 *     - promptSnippet for discoverability
 *     - renderCall/renderResult TUI rendering
 * - Command: `/example` — user-invokable (ctx.ui.notify, LLM fallback)
 * - Command: `/example-test` — runtime self-check pattern
 * - lib.ts separation: pure logic is imported, not inlined
 *
 * ## Testing
 *
 *   pi -e ./tools/example-plugin/index.ts
 *   /example hello world              # test command
 *   /example-test                     # runtime self-check
 *   > Please call example_tool now    # test tool via agent
 *
 * Design reference: skills/pi-extension-dev/ (or /skill:pi-extension-dev)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig, processQuery, validateEmail } from "./lib.js";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Wrap a plain-text result into the structured format pi expects.
 *
 * IMPORTANT: Always return this shape from tool execute() methods.
 * NEVER return a plain string — the agent needs structured output
 * with a content array and optional details for the TUI to render.
 */
function textResult(text: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details: details ?? {},
  };
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
  // ── Tool: example_tool ──────────────────────────────────────────────────
  //
  // Key properties of a well-designed tool:
  //   1. name: snake_case with prefix ("example_tool")
  //   2. description: detailed — the agent reads this to decide WHEN to call
  //   3. promptSnippet: one-line entry in the system prompt's "Available
  //      tools" section. Without it the tool is hard to discover.
  //   4. parameters: typebox schema. Use StringEnum for string enums —
  //      Type.Union/Type.Literal are NOT compatible with Google's API.
  //   5. execute: returns { content: [...], details: {...} }
  //   6. renderCall/renderResult: TUI rendering

  pi.registerTool({
    name: "example_tool",
    label: "Example Tool",

    description:
      "An example tool demonstrating proper pi extension patterns. " +
      "Processes a text query and returns the result. " +
      "Replace this with your actual implementation.",

    promptSnippet: "Process a text query via example_tool(query, format?)",

    parameters: Type.Object({
      query: Type.String({
        description: "The input text to process",
      }),
      format: Type.Optional(
        StringEnum(["json", "text"] as const, {
          description: "Output format (default: text)",
        }),
      ),
    }),

    // ── execute() — the actual tool logic ───────────────────────────────
    //
    // ERROR SIGNALING — two tiers, use the right one:
    //
    //   throw          → hard failure. pi marks isError: true and reports
    //                    the error to the model. Use for invalid input and
    //                    unrecoverable failures.
    //
    //   return content → soft failure WITH RECOVERY CLUES. The model reads
    //                    the text and self-corrects (e.g. retries with a
    //                    different selector). Never encode hard errors as
    //                    plain returns — returning never sets isError.

    async execute(_toolCallId, params) {
      // 1. Hard failure → throw (invalid input is never self-correctable
      //    by retrying with the same arguments)
      if (!params.query || params.query.trim().length === 0) {
        throw new Error(
          `Invalid 'query': must be a non-empty string (received "${params.query}")`,
        );
      }

      // 2. Business logic lives in lib.ts (pure, unit-tested, no pi imports)
      const { result, timestamp } = processQuery(params.query);

      // 3. Soft-failure example: structured return with recovery clues.
      //    Here "email:" prefix triggers validation — if it fails we tell
      //    the model exactly what went wrong and how to fix it.
      if (params.query.startsWith("email:")) {
        const email = params.query.slice("email:".length).trim();
        const error = validateEmail(email);
        if (error) {
          return textResult(
            `${error}. Retry with a valid address, e.g. "email:user@example.com".`,
            { validation: "failed", hint: "email:<address> prefix" },
          );
        }
      }

      // 4. Success → structured result with details for TUI rendering
      if (params.format === "json") {
        return textResult(
          JSON.stringify({ query: params.query, result, timestamp }, null, 2),
          { format: "json", queryLength: params.query.length },
        );
      }
      return textResult(
        `Processed: ${params.query} → ${result} (length=${result.length})`,
        { format: "text", queryLength: params.query.length },
      );
    },

    // ── renderCall() — how the tool invocation looks in the TUI ────────
    //
    // Renders BEFORE the tool executes (shows what is about to happen).

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("example_tool"));
      text += " " + theme.fg("accent", `"${args.query}"`);
      if (args.format) {
        text += " " + theme.fg("dim", `(${args.format})`);
      }
      return new Text(text, 0, 0);
    },

    // ── renderResult() — how the tool result appears in the TUI ─────────
    //
    // Renders AFTER execution. Read result.details for structured state.

    renderResult(result, _options, theme, _context) {
      const content = result.content[0];
      const details = result.details as Record<string, unknown> | undefined;

      if (details?.validation === "failed") {
        return new Text(theme.fg("warning", "Recovered"), 0, 0);
      }

      if (content?.type === "text") {
        const firstLine = content.text.split("\n")[0];
        return new Text(theme.fg("muted", firstLine), 0, 0);
      }

      return new Text(theme.fg("success", "Done"), 0, 0);
    },
  });

  // ── Command: /example ───────────────────────────────────────────────────
  //
  // Commands are user-invokable via /command-name in the pi TUI.
  // Key differences from tools:
  //   - kebab-case names, loose parsing (humans type natural language)
  //   - feedback via ctx.ui.notify() (NOT return values)
  //   - LLM fallback when parsing fails — never a dead-end error

  pi.registerCommand("example", {
    description: "An example command — /example <text>",

    async handler(args, ctx) {
      const input = args.trim();

      // ── Show usage if no input ──────────────────────────────────────
      if (!input) {
        ctx.ui.notify("Usage: /example <text>", "warning");
        return;
      }

      // ── Simple parsing attempt ──────────────────────────────────────
      const parts = input.split(/\s+/);
      const verb = parts[0];
      const rest = parts.slice(1).join(" ");

      // ── Handle known sub-commands ──────────────────────────────────
      if (verb === "greet") {
        ctx.ui.notify(`Hello, ${rest || "world"}! 👋`, "info");
        return;
      }

      // ── LLM fallback for unhandled input ───────────────────────────
      if (ctx.isIdle()) {
        pi.sendUserMessage(
          `User invoked /example with: "${input}". ` +
          `Process this request using the example_tool if appropriate.`,
        );
      } else {
        ctx.ui.notify("Agent is busy, try again in a moment", "warning");
      }
    },
  });

  // ── Command: /example-test ──────────────────────────────────────────────
  //
  // Runtime self-check pattern — REQUIRED for plugins with environment
  // dependencies (binaries, endpoints, auth). Each failed check tells
  // the user how to FIX it, not just that it broke.
  // Pure-logic plugins can skip this (vitest covers them).

  pi.registerCommand("example-test", {
    description: "Runtime self-check: lib functions, config read/write",
    handler: async (_args, ctx) => {
      const checks: { name: string; run: () => string | Error }[] = [
        {
          name: "lib.processQuery",
          run: () => {
            const { result } = processQuery("  ok  ");
            return result === "ok" ? "round-trip ok" : new Error("unexpected result");
          },
        },
        {
          name: "lib.validateEmail",
          run: () => {
            const bad = validateEmail("not-an-email");
            return bad === null
              ? new Error("accepted an invalid email")
              : "rejects invalid input";
          },
        },
        {
          name: "config readable",
          run: () => {
            const config = loadConfig();
            return config.endpoint
              ? `endpoint: ${config.endpoint}`
              : new Error("no endpoint configured");
          },
        },
      ];

      let failed = 0;
      for (const check of checks) {
        const r = (() => {
          try {
            return check.run();
          } catch (e) {
            return e instanceof Error ? e : new Error(String(e));
          }
        })();
        const ok = !(r instanceof Error);
        if (!ok) failed++;
        ctx.ui.notify(
          `${ok ? "✓" : "✗"} ${check.name}: ${ok ? r : r.message}`,
          ok ? "info" : "error",
        );
      }
      ctx.ui.notify(
        failed === 0 ? "example-plugin: all checks passed" : `${failed} check(s) failed`,
        failed === 0 ? "info" : "warning",
      );
    },
  });
}
