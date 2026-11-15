import { mergeConfig } from "vite";
import base from "./vite.config";
export default mergeConfig(base, { build: { rollupOptions: { input: { main: "index.html", proto: "proto.html" } } } });
