import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./shared.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = path.join(root, "public");

startServer({ staticDir, rootDir: root });
