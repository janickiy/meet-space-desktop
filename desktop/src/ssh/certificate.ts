import { createHash, createPrivateKey, type KeyObject, X509Certificate } from "node:crypto";
import { normalizeDomain, SshError } from "./types";

export interface TlsCertificateInput { fullchain: string; privateKey: string }
export interface ValidatedTlsCertificate extends TlsCertificateInput { certificateSha256: string }

const CERTIFICATE_LIMIT = 64 * 1024;
const PRIVATE_KEY_LIMIT = 16 * 1024;
const MESSAGE = "Проверьте PEM-сертификат и приватный ключ без пароля: они должны соответствовать друг другу, домену и действовать ещё минимум час. Цепочка сертификатов должна идти от сертификата сервера к центрам сертификации.";

function requireValue(value: unknown): asserts value {
  if (!value) throw new Error("invalid certificate");
}

function supportedKey(key: KeyObject): boolean {
  if (key.asymmetricKeyType === "rsa" || key.asymmetricKeyType === "rsa-pss") return (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048;
  return key.asymmetricKeyType === "ec" && ["prime256v1", "secp384r1", "secp521r1"].includes(key.asymmetricKeyDetails?.namedCurve ?? "");
}

/** Local structural validation only; the remote installer also checks system trust.
 * The private key is never included in the returned public plan or its hash. */
export function validateTlsCertificate(raw: unknown, domain: string, expectedSha256?: string): ValidatedTlsCertificate {
  try {
    requireValue(raw && typeof raw === "object" && !Array.isArray(raw));
    const value = raw as Record<string, unknown>;
    requireValue(Object.keys(value).sort().join("\0") === "fullchain\0privateKey");
    const { fullchain, privateKey } = value;
    requireValue(typeof fullchain === "string" && typeof privateKey === "string");
    requireValue(Buffer.byteLength(fullchain) > 0 && Buffer.byteLength(fullchain) <= CERTIFICATE_LIMIT);
    requireValue(Buffer.byteLength(privateKey) > 0 && Buffer.byteLength(privateKey) <= PRIVATE_KEY_LIMIT);
    requireValue(!/[^\x09\x0a\x0d\x20-\x7e]/.test(fullchain + privateKey));
    requireValue(normalizeDomain(domain) === domain);
    const blocks = fullchain.match(/-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g) ?? [];
    requireValue(blocks.length > 0 && blocks.length <= 10);
    requireValue(fullchain.replace(/-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g, "").trim() === "");
    requireValue(/^[\t\r\n ]*-----BEGIN (RSA |EC )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END \1PRIVATE KEY-----[\t\r\n ]*$/.test(privateKey));
    const certificates = blocks.map(pem => new X509Certificate(pem));
    requireValue(new Set(certificates.map(cert => cert.fingerprint256)).size === certificates.length);
    const now = Date.now();
    for (const cert of certificates) {
      const from = Date.parse(cert.validFrom), to = Date.parse(cert.validTo);
      requireValue(Number.isFinite(from) && Number.isFinite(to) && from <= now && to >= now + 60 * 60 * 1000);
      requireValue(supportedKey(cert.publicKey));
    }
    const leaf = certificates[0];
    requireValue(!leaf.ca && leaf.checkHost(domain, { subject: "never", wildcards: true, partialWildcards: false, multiLabelWildcards: false }));
    const key = createPrivateKey({ key: privateKey, format: "pem" });
    requireValue(supportedKey(key) && leaf.checkPrivateKey(key));
    for (let index = 1; index < certificates.length; index++) {
      const issuer = certificates[index], child = certificates[index - 1];
      requireValue(issuer.ca && child.checkIssued(issuer) && child.verify(issuer.publicKey));
    }
    const certificateSha256 = createHash("sha256").update(fullchain).digest("hex");
    if (expectedSha256 !== undefined) requireValue(/^[a-f0-9]{64}$/.test(expectedSha256) && certificateSha256 === expectedSha256);
    return { fullchain, privateKey, certificateSha256 };
  } catch {
    throw new SshError("TLS_CERTIFICATE_INVALID", MESSAGE);
  }
}
