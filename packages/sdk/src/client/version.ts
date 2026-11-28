// A named import lets the bundler inline only the version, not the manifest,
// so the hook stays small. The release PR bumps package.json; nothing else.
import { version } from "../../package.json";

/** The version reported to Nodrail by the SDK and the hook. */
export const PACKAGE_VERSION: string = version;
