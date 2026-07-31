import { spawn } from "node:child_process";
import fs from "node:fs";

const [codexJs, promptPath, schemaPath, outputPath, model, codexHome, reasoningEffort] =
  process.argv.slice(2);

if (
  ![
    codexJs,
    promptPath,
    schemaPath,
    outputPath,
    model,
    codexHome,
    reasoningEffort,
  ].every(Boolean)
) {
  process.stderr.write("Missing Codex synthesis helper argument.\n");
  process.exit(2);
}

const prompt = fs.readFileSync(promptPath);
const child = spawn(
  process.execPath,
  [
    codexJs,
    "exec",
    "--model",
    model,
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "-c",
    'approval_policy="never"',
    "-c",
    `model_reasoning_effort="${reasoningEffort}"`,
    prompt.toString("utf8"),
  ],
  {
    env: { ...process.env, CODEX_HOME: codexHome },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
child.once("close", (code) => process.exit(code ?? 1));
