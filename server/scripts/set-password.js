// One-off helper: generates a bcrypt hash for ADMIN_PASSWORD_HASH.
// Usage: npm run set-password -w server -- <your-password>
import { hashPassword } from "../src/auth/password.js";
const plain = process.argv[2];
if (!plain) {
    console.error("Usage: npm run set-password -w server -- <your-password>");
    process.exit(1);
}
const hash = await hashPassword(plain);
console.log("\nAdd this to your .env file:\n");
console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
