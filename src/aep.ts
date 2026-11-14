// Types and chain check for the A-Comm Evidence Protocol (AEP) v1.0.3-rc.2.
// Spec: github.com/A-Comm-Tech/a-comm-evidence-protocol (Apache-2.0).
// We read AEP bundles. We do not define a format of our own.
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { canonicalize, sha256Digest } from './jcs.ts';

export type ArtifactType =
  | 'discovery' | 'referral' | 'intent' | 'delegation'
  | 'policy' | 'cart' | 'authorization' | 'fulfillment' | 'refund';

export interface ArtifactHashInput {
  artifact_type: ArtifactType;
  actor_type: string;
  actor_id: string;
  interaction_channel: 'voice' | 'text_chat' | 'voice_and_text' | null;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  previous_hash: string | null;
  timestamp: string;
}

export interface ArtifactRecord {
  sequence_number: number;
  artifact_type: ArtifactType;
  hash_input: ArtifactHashInput;
  current_hash: string;
  server_signature?: string;
}

export interface BundleVerification {
  valid: boolean;
  hashChainIntact: boolean;
  signaturesValid: boolean;
  chainComplete: boolean;
  artifactsVerified: number;
  verifiedAt?: string | null;
  verificationMode?: 'full' | 'cached' | null;
  errors: string[];
}

export interface PriorTransaction {
  chain_id: string;
  charge_ref: string;
  processed_date: string;
  amount: number;
  currency: string;
  matched_elements: string[];
  disputed: boolean;
}

export interface DisputeBundle {
  transaction: {
    id: string;
    transactionType: string;
    status: string;
    interactionChannel: 'voice' | 'text_chat' | 'voice_and_text' | null;
    createdAt: string;
    completedAt: string | null;
    sealedBundleHash: string | null;
  };
  verification: BundleVerification;
  artifacts: ArtifactRecord[];
  merchantContext: { merchantId: string; merchantName: string; totalValue: string | null; currency: string | null };
  evidenceTier?: 'S' | 'A' | 'B' | 'C' | 'D';
  protocolEnvelopesVerified?: unknown[];
  customerHistory?: {
    identity_keys?: Record<string, string | null>;
    prior_transactions?: PriorTransaction[];
    dispute_count?: number;
    refund_count?: number;
    window_days?: number;
  } | null;
  exportedAt: string;
}

export interface ChainCheck {
  hashChainIntact: boolean;
  // null when no public key was given, so signatures were not checked.
  signaturesValid: boolean | null;
  artifactsVerified: number;
  errors: string[];
}

export function hashArtifact(input: ArtifactHashInput): { canonical: string; digest: Buffer; tagged: string } {
  const canonical = canonicalize(input);
  const digest = sha256Digest(canonical);
  return { canonical, digest, tagged: 'sha256:' + digest.toString('hex') };
}

function ed25519Key(publicKeyBase64: string) {
  const raw = Buffer.from(publicKeyBase64, 'base64');
  if (raw.length !== 32) throw new Error('ed25519 public key must be 32 bytes');
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

// Recomputes every current_hash, checks each previous_hash link, and, when a
// public key is given, checks the Ed25519 signature over the raw 32 digest
// bytes (AEP 4.3). It does not check sealedBundleHash: the bundle signature
// rule is still open in the spec (vector c is pending).
export function verifyChain(artifacts: ArtifactRecord[], publicKeyBase64?: string): ChainCheck {
  const errors: string[] = [];
  let hashOk = true;
  let sigOk: boolean | null = publicKeyBase64 ? true : null;
  const key = publicKeyBase64 ? ed25519Key(publicKeyBase64) : null;
  let verified = 0;
  let prev: string | null = null;
  artifacts.forEach((a, i) => {
    const where = 'artifact ' + (i + 1) + ' (' + a.artifact_type + ')';
    let good = true;
    if (a.sequence_number !== i + 1) { errors.push(where + ': sequence_number is ' + a.sequence_number + ', expected ' + (i + 1)); good = false; }
    if (a.hash_input.artifact_type !== a.artifact_type) { errors.push(where + ': artifact_type differs from hash_input'); good = false; }
    if (a.hash_input.previous_hash !== prev) { errors.push(where + ': previous_hash does not match the artifact before it'); good = false; }
    const h = hashArtifact(a.hash_input);
    if (h.tagged !== a.current_hash) { errors.push(where + ': current_hash does not match the recomputed hash'); good = false; }
    if (!good) hashOk = false;
    if (key) {
      let ok = false;
      if (a.server_signature) {
        try { ok = edVerify(null, h.digest, key, Buffer.from(a.server_signature, 'base64')); } catch { ok = false; }
      }
      if (!ok) { errors.push(where + ': signature missing or invalid'); sigOk = false; good = false; }
    }
    if (good) verified++;
    prev = a.current_hash;
  });
  return { hashChainIntact: hashOk, signaturesValid: sigOk, artifactsVerified: verified, errors };
}
