/**
 * Workers Builds authenticates with an API token that can read the Worker,
 * but GET /workers/scripts/:name/secrets returns Cloudflare error 10500.
 * Wrangler treats that preflight as fatal. The upload itself keeps existing
 * secrets (keepSecrets), so this only makes code 10500 non-fatal.
 *
 * Runs from postinstall, before Cloudflare's `npx wrangler deploy`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const MARKER = "event-share: secrets list 10500 is non-fatal";
const require = createRequire(import.meta.url);
const cliPath = join(dirname(require.resolve("wrangler/package.json")), "wrangler-dist/cli.js");
const source = readFileSync(cliPath, "utf8");

if (source.includes(MARKER)) {
	process.exit(0);
}

const pattern =
	/const secrets = await fetchSecrets\(config2, scriptName, accountId\);\n\s*for \(const secret of secrets\) \{\n\s*secretNames\.add\(secret\.name\);\n\s*\}\n\s*\} catch \(e11\) \{\n\s*if \(isWorkerNotFoundError\(e11\)\) \{\n\s*return \{ override: false \};\n\s*\}\n\s*throw e11;\n\s*\}/;

const match = source.match(pattern);
if (!match) {
	console.warn(
		"[event-share] wrangler のシークレット確認を書き換えられませんでした。バージョンが変わった可能性があります。",
	);
	process.exit(0);
}

const patched = match[0].replace(
	"throw e11;",
	`if (e11 && e11.code === 10500) {
        console.warn("[event-share] Listing Worker secrets failed with Cloudflare error 10500. Continuing deploy; existing secrets are kept.");
        return { override: false }; // ${MARKER}
      }
      throw e11;`,
);

if (source.split(match[0]).length !== 2) {
	console.warn("[event-share] シークレット確認の一致が1件ではありません。書き換えをスキップします。");
	process.exit(0);
}

writeFileSync(cliPath, source.replace(match[0], patched));
console.log("[event-share] wrangler のシークレット一覧（10500）をデプロイ失敗にしないようにしました。");
