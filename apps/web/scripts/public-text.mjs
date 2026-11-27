import { createHash } from "node:crypto";

// Exact assets reviewed for the public server. A different file at one of
// these paths must pass the text scan or be reviewed as a new binary.
const binaryAssets = new Map([
  [
    "apps/web/public/fonts/Inter-Medium.woff2",
    "28d4ec4cbdb4cc9c5144a66fc5876efceaaac1e9b88675b9a5d3b27a15603219",
  ],
  [
    "apps/web/public/fonts/Inter-Regular.woff2",
    "af56ce7512f372f8137e08b3b3cda238a635acf66a1078a6c8bb7787d52787fc",
  ],
  [
    "apps/web/public/fonts/JetBrainsMono-Medium.woff2",
    "535cde6e55d2ee225b1d05b56ac1a12bc41cd50915c2100a209e0e13a1eaa551",
  ],
  [
    "apps/web/public/fonts/JetBrainsMono-Regular.woff2",
    "57ea3549d3859dd9c9631820a10c7064808077e1b88df8aab952e16ab77d2f19",
  ],
  [
    "apps/web/public/fonts/Manrope-Bold.woff2",
    "de4a8bc703304c609b236c918692e20f6c023538cdfb3e4cb31bcedf184b4697",
  ],
  [
    "apps/web/public/fonts/Manrope-Regular.woff2",
    "64d952298af2b10037fb320f3d6da857dd6a4be6e4391d4c01bbc365045cf8c8",
  ],
  [
    "apps/web/src/app/apple-icon.png",
    "dc04d2f12abb208a7382cacde34accd13511736875957fdcbb407e22ad41bad6",
  ],
  [
    "apps/web/src/app/favicon.ico",
    "8592769eabf266918ce2f551e6fc3e08e47b4ec8e89de03d74b9851928fbfb03",
  ],
]);

function encoding(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  const firstNul = bytes.indexOf(0);
  if (firstNul < 0) return "utf-8";
  // In BOM-less UTF-16 text, ASCII characters produce NUL bytes in one
  // lane. Reject ambiguous or truncated data instead of guessing.
  const lane = firstNul % 2;
  if (bytes.length % 2) return null;
  for (let i = 1 - lane; i < bytes.length; i += 2)
    if (bytes[i] === 0) return null;
  return lane ? "utf-16le" : "utf-16be";
}

export function publicText(path, bytes) {
  const reviewedHash = binaryAssets.get(path);
  if (
    reviewedHash &&
    createHash("sha256").update(bytes).digest("hex") === reviewedHash
  )
    return "";

  const charset = encoding(bytes);
  if (!charset) return null;
  try {
    const text = new TextDecoder(charset, { fatal: true }).decode(bytes);
    // Accept tabs and standard line endings, but reject binary control bytes.
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) return null;
      if (code === 127) return null;
    }
    return text;
  } catch {
    return null;
  }
}
