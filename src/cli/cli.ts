import { parseArgs } from "node:util";
import { resolveConfig, generateApiKey } from "../config/index.js";
import { createGateway } from "../gateway/index.js";
import { logger } from "../shared/logger.js";

const TAG = "cli";

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];

  switch (command) {
    case "start":
      return startCommand(argv.slice(1));
    case "config":
      return configCommand(argv.slice(1));
    case "keygen":
      return keygenCommand(argv.slice(1));
    case "version":
      console.log("openclash v0.1.0");
      return;
    case undefined:
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

async function startCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string", short: "h" },
      config: { type: "string", short: "c" },
      "log-level": { type: "string" },
    },
    strict: false,
  });

  if (values["log-level"]) {
    logger.setLevel(values["log-level"] as any);
  }

  const port = typeof values.port === "string" ? parseInt(values.port, 10) : undefined;
  const host = typeof values.host === "string" ? values.host : undefined;
  const configPath = typeof values.config === "string" ? values.config : undefined;

  const config = resolveConfig(
    {
      server: { port, host },
    },
    configPath,
  );

  if (Object.keys(config.providers).length === 0) {
    console.error("No providers configured. Create a config file or pass --config.");
    console.error(`Config path: ${configPath ?? "~/.config/openclash/config.json"}`);
    process.exitCode = 1;
    return;
  }

  const gateway = await createGateway(config);
  await gateway.start();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info(TAG, "Shutting down...");
    await gateway.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function configCommand(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string", short: "c" },
    },
    strict: false,
  });

  const config = resolveConfig(undefined, typeof values.config === "string" ? values.config : undefined);
  console.log(JSON.stringify(config, null, 2));
}

function keygenCommand(argv: string[]): void {
  const providerName = argv[0];
  if (!providerName) {
    console.error("Usage: openclash keygen <provider-name>");
    console.error("Example: openclash keygen cursor-acp");
    process.exitCode = 1;
    return;
  }
  console.log(generateApiKey(providerName));
}

function printHelp(): void {
  console.log(`
openclash - ACP to OpenAI protocol conversion gateway

Usage:
  openclash <command> [options]

Commands:
  start       Start the gateway server
  config      Print resolved configuration
  keygen      Generate an apiKey for a provider
  version     Print version

Options for 'start':
  -p, --port <port>        Server port (default: 8080)
  -h, --host <host>        Server host (default: 0.0.0.0)
  -c, --config <path>      Config file path
      --log-level <level>  Log level: debug, info, warn, error

Usage for 'keygen':
  openclash keygen <provider-name>
  Example: openclash keygen cursor-acp
`.trim());
}
