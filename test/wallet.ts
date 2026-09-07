/**
 * WALLET — the adversarial suite.
 *
 * Every case here is written as the attacker, not as the user. A wallet link that works when
 * you use it correctly proves almost nothing; the only interesting question is what happens
 * when someone is actively trying to attach YOUR address to THEIR account.
 *
 * These sign with real keys and verify through the real code path. Nothing is stubbed except
 * the clock.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";
import { buildChallenge, checkSignature, allowedDomains, CHAINS } from "../src/services/wallet";

let fail = 0;
const bad = (m: string) => { console.log(`❌ ${m}`); fail++; };
const ok = (m: string) => console.log(`   ✅ ${m}`);

const DOMAIN = "cryptobuds.world";
const URI = "https://cryptobuds.world/";
const POLYGON = 137;

const victim = privateKeyToAccount(generatePrivateKey());
const attacker = privateKeyToAccount(generatePrivateKey());

console.log("\n── WHO IS ALLOWED TO ASK ──");
{
  const evil = buildChallenge(victim.address, "cryptobuds-airdrop.xyz", "https://cryptobuds-airdrop.xyz/", POLYGON);
  if (evil.ok) bad("a domain nobody has heard of got a challenge issued");
  else ok(`a look-alike domain is refused — "${evil.why}"`);

  const good = buildChallenge(victim.address, DOMAIN, URI, POLYGON);
  if (!good.ok) bad(`the real domain was refused: ${good.why}`);
  else ok("the real domain gets a challenge");

  // The allowlist is only as good as the URI check: claim a good domain, point the URI at
  // your own host, and the message a wallet renders would name yours.
  const mismatch = buildChallenge(victim.address, DOMAIN, "https://evil.example/", POLYGON);
  if (mismatch.ok) bad("a challenge was issued whose URI belonged to a different host than its domain");
  else ok("a URI that doesn't belong to the claimed domain is refused");

  const insecure = buildChallenge(victim.address, DOMAIN, "http://cryptobuds.world/", POLYGON);
  if (insecure.ok) bad("a plaintext http:// origin was allowed to request a signature");
  else ok("http:// is refused — a signature request rides https or not at all");

  const nowhere = buildChallenge(victim.address, DOMAIN, URI, 999999);
  if (nowhere.ok) bad("a challenge was issued for a chain we do not support");
  else ok("an unsupported chain is refused");

  if (process.env.NODE_ENV !== "production" && !allowedDomains().some((d) => d.startsWith("localhost")))
    bad("localhost is missing off-prod, so nobody can develop against this");
  else ok(`${allowedDomains().length} origins allowed in this environment`);
}

console.log("\n── WHAT THE WALLET IS ASKED TO SIGN ──");
{
  const c = buildChallenge(victim.address, DOMAIN, URI, POLYGON);
  if (!c.ok) { bad("could not build a challenge to inspect"); }
  else {
    const f = parseSiweMessage(c.message);
    if (f.domain !== DOMAIN) bad(`the signed message names "${f.domain}", not the requesting domain`);
    else ok(`the message names its origin (${f.domain}) — this is what a wallet shows and checks`);

    if (f.chainId !== POLYGON) bad("the signed message doesn't pin a chain");
    else ok("the message pins a chain");

    if (!f.expirationTime) bad("the signed message never expires — a leaked signature is good forever");
    else ok("the message carries an expiry");

    if (!f.nonce || f.nonce.length < 8) bad("the nonce is too short to be unguessable");
    else ok(`the nonce is server-issued and ${f.nonce.length} chars`);

    if (f.address?.toLowerCase() !== victim.address.toLowerCase()) bad("the message doesn't bind the address");
    else ok("the message binds the address it was issued for");

    const again = buildChallenge(victim.address, DOMAIN, URI, POLYGON);
    if (again.ok && again.nonce === c.nonce) bad("two challenges produced the same nonce");
    else ok("nonces do not repeat");
  }
}

console.log("\n── SIGNATURES ──");
(async () => {
  const c = buildChallenge(victim.address, DOMAIN, URI, POLYGON);
  if (!c.ok) { bad("no challenge to sign"); return finish(); }
  const f = parseSiweMessage(c.message);
  const sig = await victim.signMessage({ message: c.message });

  if (!(await checkSignature(c.message, sig, victim.address, DOMAIN, f.nonce!, POLYGON)))
    bad("a genuine signature from the right key was rejected");
  else ok("a genuine signature verifies");

  /* THE ONE THAT MATTERS. The attacker holds a signature the victim really produced. They
     try to present it as proof of a DIFFERENT address — their own. */
  if (await checkSignature(c.message, sig, attacker.address, DOMAIN, f.nonce!, POLYGON))
    bad("the victim's signature proved the attacker's address");
  else ok("a signature cannot be re-presented as a different address");

  // The attacker signs the victim's challenge with their own key, hoping we only check that
  // *something* signed it.
  const forged = await attacker.signMessage({ message: c.message });
  if (await checkSignature(c.message, forged, victim.address, DOMAIN, f.nonce!, POLYGON))
    bad("a signature from the wrong key was accepted for the victim's address");
  else ok("a signature from the wrong key is refused");

  // Tampering after signing: same signature, message edited.
  const edited = c.message.replace(DOMAIN, "evil.example");
  if (await checkSignature(edited, sig, victim.address, "evil.example", f.nonce!, POLYGON))
    bad("an edited message still verified — the signature isn't covering the domain");
  else ok("editing the message invalidates the signature");

  // A signature is only good for the nonce it was issued against.
  if (await checkSignature(c.message, sig, victim.address, DOMAIN, "differentnonce123", POLYGON))
    bad("a signature verified against a nonce it was not issued for");
  else ok("the nonce must match the one we issued");

  // Domain mismatch caught at verification too, not only at issue time — belt and braces,
  // because these two checks live in different functions and can drift apart.
  if (await checkSignature(c.message, sig, victim.address, "cryptobuds-airdrop.xyz", f.nonce!, POLYGON))
    bad("verification accepted a domain other than the one inside the message");
  else ok("verification re-checks the domain independently");

  // Expiry is inside the signed payload, so it is the wallet's business as well as ours.
  const stale = buildChallenge(victim.address, DOMAIN, URI, POLYGON, new Date(Date.now() - 60 * 60_000));
  if (stale.ok) {
    const sf = parseSiweMessage(stale.message);
    const staleSig = await victim.signMessage({ message: stale.message });
    if (await checkSignature(stale.message, staleSig, victim.address, DOMAIN, sf.nonce!, POLYGON))
      bad("an hour-old challenge still verified");
    else ok("an expired challenge is refused even with a perfect signature");
  }

  console.log("\n── SMART-CONTRACT WALLETS ──");
  {
    const base = CHAINS.find((c) => c.chainId === 8453);
    if (!base) bad("Base is not a configured chain — Coinbase Smart Wallet users cannot link");
    else ok("Base is configured, so a contract wallet there can be asked about its own signature");

    const contracts = CHAINS.filter((c) => c.contract).map((c) => c.id);
    if (!contracts.includes("polygon")) bad("the collection's own chain has no contract configured");
    else ok(`holdings read from: ${contracts.join(", ")}`);
  }

  finish();
})();

function finish() {
  console.log(fail ? `\n❌ ${fail} PROBLEMS` : "\n✅ a wallet link proves control of an address and nothing else proves it");
  if (fail) process.exit(1);
}
