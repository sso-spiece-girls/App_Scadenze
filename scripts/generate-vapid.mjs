/**
 * Generates a VAPID key pair (ES256 / P-256) for Web Push, in the
 * base64url format expected by the `web-push` library.
 *
 * Run: node scripts/generate-vapid.mjs
 */
import { generateKeyPairSync, createPublicKey, createPrivateKey } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});

// VAPID public key must be the raw uncompressed point (65 bytes, 0x04 prefix).
// Export the KeyObject directly: SPKI DER ends with BIT STRING (03 42 00) <65 bytes point>
const pubDer = publicKey.export({ type: "spki", format: "der" });
const point = pubDer.subarray(pubDer.length - 65);

// PKCS8 DER: last 32 bytes are the private scalar.
const privDer = privateKey.export({ type: "pkcs8", format: "der" });
const scalar = privDer.subarray(privDer.length - 32);

function base64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

console.log("VAPID keys generated. Add to your Supabase secrets / .env:");
console.log("");
console.log(`VAPID_PUBLIC_KEY=${base64url(point)}`);
console.log(`VAPID_PRIVATE_KEY=${base64url(scalar)}`);
console.log(`VITE_VAPID_PUBLIC_KEY=${base64url(point)}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
console.log("");
console.log("WARNING: keep the private key secret. Never commit it.");