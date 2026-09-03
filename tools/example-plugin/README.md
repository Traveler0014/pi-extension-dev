# example-plugin

Example tool and command extension for pi — demonstrates the complete patterns for registering custom tools and slash commands with proper TUI rendering and two-tier error signaling.

> **This is a template.** Replace the placeholder logic with your actual implementation.
> See [pi-alarm](https://github.com/Traveler0014/pi-alarm) and [pi-github](https://github.com/Traveler0014/pi-github) for production examples.
> Design reference: [skills/pi-extension-dev](../../skills/pi-extension-dev/) (or `/skill:pi-extension-dev`)

## Naming convention

| Layer | Style | Format | Example |
|-------|-------|--------|---------|
| Tool (agent) | `snake_case` | `<prefix>_<verb>` | `example_tool`, `gh_issue_create`, `alarm_set` |
| Command (user) | `kebab-case` | `/<prefix>-<verb>` | `/example`, `/gh-login`, `/alarm-list` |

## Features

- **Tool:** `example_tool` — AI-callable tool with typebox schema, `StringEnum`, `promptSnippet`, structured results, TUI rendering
- **Command:** `/example` — user-invokable slash command with `ctx.ui.notify()` and LLM fallback
- **Command:** `/example-test` — runtime self-check pattern (for plugins with environment dependencies)
- **lib.ts separation** — pure logic in `lib.ts`, unit-tested in `lib.test.ts`, zero pi imports

## Tools (agent-facing, snake_case)

### `example_tool`

An example tool demonstrating proper pi extension patterns.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | ✅ | The input text to process |
| `format` | "json" \| "text" | ❌ | Output format (default: text) |

Schema uses typebox + `StringEnum` (Google API compatible):

```typescript
parameters: Type.Object({
  query: Type.String({ description: "The input text to process" }),
  format: Type.Optional(StringEnum(["json", "text"] as const)),
}),
```

**Error signaling — two tiers:**

```typescript
// Hard failure (invalid input, unrecoverable) → throw.
// pi marks isError: true and reports it to the model.
if (!params.query?.trim()) {
  throw new Error(`Invalid 'query': must be a non-empty string`);
}

// Self-correctable failure → structured return WITH recovery clues.
// The model reads the hint and retries with fixed arguments.
return textResult(
  `${error}. Retry with a valid address, e.g. "email:user@example.com".`,
  { validation: "failed" },
);
```

## Commands (user-facing, kebab-case)

### `/example`

Interactive slash command with sub-commands and LLM fallback.

```bash
/example greet Alice           # Direct handling
/example process this text     # Falls back to LLM if parser doesn't understand
```

### `/example-test`

Runtime self-check: runs lib round-trips and config readability, reports pass/fail per check. Adapt this pattern when your plugin depends on binaries, endpoints, or auth — each failed check should tell the user how to fix it.

## Key Patterns Demonstrated

### 1. Structured tool results

```typescript
function textResult(text: string, details?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], details: details ?? {} };
}
```

### 2. promptSnippet for discoverability

```typescript
promptSnippet: "Process a text query via example_tool(query, format?)",
// Without promptSnippet the tool does not appear in the system prompt's
// "Available tools" section and is hard for the model to discover.
```

### 3. LLM fallback for commands

```typescript
if (ctx.isIdle()) {
  pi.sendUserMessage(`User invoked /example: "${input}". Process this...`);
} else {
  ctx.ui.notify("Agent is busy, try again in a moment", "warning");
}
```

## Customization Checklist

- [ ] Replace tool `name`, `label`, `description`, `promptSnippet`
- [ ] Define tool `parameters` schema (typebox + StringEnum)
- [ ] Implement `execute()` — throw on hard failures, recovery clues on soft ones
- [ ] Implement `renderCall()` / `renderResult()` with theme colors
- [ ] Replace command `name` and `description`
- [ ] Implement command `handler()` with `ctx.ui.notify()` + LLM fallback
- [ ] Move business logic to `lib.ts`, add `lib.test.ts`
- [ ] Update this README

## License

MIT
