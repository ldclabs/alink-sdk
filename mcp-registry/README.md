# MCP registry

[`server.json`](./server.json) is alink's manifest for the official [MCP registry](https://registry.modelcontextprotocol.io). It validates against the `2025-12-11` schema.

Nothing here is needed to *use* alink — see the [root README](../README.md) for that.

## Namespace: `ink.al/alink`

Registry names are reverse-DNS with exactly one slash. We use the reverse of `al.ink`, verified over DNS, rather than an `io.github.*` namespace: the product's whole claim is that your door lives on your own domain, and the registry entry should not be weaker than that.

## First publish

**1. Generate a key and add the DNS record**

```bash
openssl genpkey -algorithm ed25519 -out alink-mcp-registry.pem
```

The PEM is PKCS#8 DER wrapped in base64; both keys are the trailing 32 bytes of their DER encoding, so `tail -c 32` gets at them. **The two sides want different encodings** — the TXT record takes base64, `mcp-publisher login` takes hex:

```bash
# public key, base64 — goes in the TXT record
openssl pkey -in alink-mcp-registry.pem -pubout -outform DER | tail -c 32 | base64

# private key, hex (the 32-byte seed) — goes to mcp-publisher login, never into a file here
openssl pkey -in alink-mcp-registry.pem -outform DER | tail -c 32 | xxd -p -c 32
```

Add a TXT record on `al.ink` carrying the base64 public key:

```text
al.ink. IN TXT "v=MCPv1; k=ed25519; p=<PUBLIC_KEY_BASE64>"
```

Putting hex in `p=` fails with `401 ... invalid Ed25519 public key size`: the registry base64-decodes that field, and 64 hex characters do not decode to 32 bytes. If the record and the key ever drift apart, `mcp-publisher login` prints the exact record it expects — copy it from there.

> Keep the private key out of this repository — it belongs with the other operational secrets.

**2. Validate, then publish**

```bash
mcp-publisher validate mcp-registry/server.json
mcp-publisher login dns --domain=al.ink --private-key=<PRIVATE_KEY_HEX>
mcp-publisher publish mcp-registry/server.json
```

## Rules that bite

- **`description` is capped at 100 characters** by the schema, which also asks for capabilities rather than implementation. It is currently 91 — count before adding a word. Capability order is deliberate: works and sprite lead (the player-first narrative, PRD v4.12), the gatekeeper closes.
- `version` tracks the deployed core. Re-publish only when the **tool surface** changes; a re-publish that changes nothing is noise.
- `repository` is deliberately absent. The schema defines it as "repository metadata for the MCP server source code", and the server's source is not this repository. Add it if the core is ever opened.
- Retire an entry with `mcp-publisher status --status deprecated --message ...` rather than deleting it.

## Other directories

Third-party catalogues (Smithery, mcp.so, and similar) each have their own submission flow and are not driven from this file. They all point at the same endpoint: `https://api.al.ink/mcp`.
