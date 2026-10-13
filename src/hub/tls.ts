import { execFileSync } from "node:child_process";
import { X509Certificate, generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";

export type HubNames = { ip: string; dns?: string };
export type HubTls = { caPem: string; certPem: string; keyPem: string; fingerprint: string };
const PRIVATE_RANGES: [string, string][] = [
  ["10.0.0.0", "255.0.0.0"],
  ["172.16.0.0", "255.240.0.0"],
  ["192.168.0.0", "255.255.0.0"],
  ["127.0.0.0", "255.0.0.0"],
];
const octets = (ip: string) => ip.split(".").map(Number);
const privateIp = (ip: string) =>
  PRIVATE_RANGES.some(([net, mask]) => {
    const n = octets(net), m = octets(mask), a = octets(ip);
    return a.every((byte, i) => (byte & m[i]) === n[i]);
  });
const DNS = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** The hub's own CA, kept across restarts and address changes so members trust
 * it once. Only the server certificate is reissued when its names change. */
export function ensureHubTls(dir: string, names: HubNames, openssl = "openssl"): HubTls {
  if (isIP(names.ip) !== 4) throw new Error("HUB_HOST_IP_REQUIRED");
  if (!privateIp(names.ip)) throw new Error("HUB_HOST_PRIVATE_IP_REQUIRED: the hub address must be in 10/8, 172.16/12, 192.168/16 or 127/8");
  if (names.dns !== undefined && !DNS.test(names.dns)) throw new Error("HUB_NAME_INVALID");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = (name: string) => join(dir, name);
  const run = (args: string[]) => {
    try {
      return execFileSync(openssl, args, { cwd: dir, stdio: "pipe" });
    } catch (e) {
      const err = e as any;
      throw new Error(`HUB_OPENSSL_FAILED: ${err.stderr?.toString?.() || err.message || String(e)}`);
    }
  };
  // Keys are made in Node so they always use a named curve; LibreSSL's `req -newkey ec`
  // writes explicit curve parameters that OpenSSL 3 (and so Node's TLS) refuses.
  const makeKey = (name: string) => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    writeFileSync(file(name), privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(file(name), 0o600);
  };
  // The CA is trusted as "always trust" by every member, so it may only ever
  // vouch for private addresses and the one configured name.
  const caDns = names.dns?.toLowerCase() ?? "";
  if (!existsSync(file("ca.pem")) || !existsSync(file("ca.key"))) {
    const permitted = [...PRIVATE_RANGES.map(([net, mask]) => `IP:${net}/${mask}`), `DNS:${caDns || "invalid"}`]
      .map((entry) => `permitted;${entry}`)
      .join(",");
    makeKey("ca.key");
    run(["req", "-new", "-x509", "-key", "ca.key", "-out", "ca.pem", "-days", "825", "-sha256",
      "-subj", "/CN=Pazmo Team Hub CA",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign",
      "-addext", `nameConstraints=critical,${permitted}`]);
    writeFileSync(file("ca.names"), caDns);
  }
  const recorded = existsSync(file("ca.names")) ? readFileSync(file("ca.names"), "utf8") : undefined;
  if (recorded === undefined) {
    throw new Error("HUB_CA_UNCONSTRAINED: this hub CA has no name constraints; delete the tls directory and have team members trust the new CA");
  }
  if (recorded !== caDns) {
    throw new Error(`HUB_CA_NAME_CHANGED: the hub CA only vouches for DNS name "${recorded || "(none)"}", not "${caDns || "(none)"}"; delete the tls directory and have team members trust the new CA`);
  }
  const caPem = readFileSync(file("ca.pem"), "utf8");
  const ca = new X509Certificate(caPem);
  if (new Date(ca.validTo).getTime() - Date.now() < 30 * 86400_000) {
    throw new Error("HUB_CA_EXPIRING: hub CA expires within 30 days; delete the tls directory and have team members trust the new CA again");
  }
  const san = `IP:${names.ip}${names.dns ? `,DNS:${names.dns}` : ""}`;
  let current = false;
  if (existsSync(file("server.pem")) &&
    existsSync(file("server.key")) &&
    existsSync(file("server.names")) &&
    readFileSync(file("server.names"), "utf8") === san &&
    new Date(new X509Certificate(readFileSync(file("server.pem"))).validTo).getTime() > Date.now() + 7 * 86400_000) {
    const serverPem = readFileSync(file("server.pem"), "utf8");
    const leaf = new X509Certificate(serverPem);
    try {
      current = leaf.verify(ca.publicKey);
    } catch {
      current = false;
    }
  }
  if (!current) {
    writeFileSync(
      file("server.ext"),
      `subjectAltName=${san}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n`,
    );
    // OpenSSL also checks the subject CN against the CA's DNS constraint, so an IP is not a valid CN here.
    makeKey("server.key");
    run(["req", "-new", "-key", "server.key", "-out", "server.csr", "-subj", `/CN=${names.dns ?? "hub.invalid"}`]);
    run(["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
      "-out", "server.pem", "-days", "397", "-sha256", "-extfile", "server.ext"]);
    writeFileSync(file("server.names"), san);
    rmSync(file("server.csr"));
  }
  return {
    caPem,
    certPem: readFileSync(file("server.pem"), "utf8"),
    keyPem: readFileSync(file("server.key"), "utf8"),
    fingerprint: ca.fingerprint256,
  };
}
