import { openSecret, sealSecret } from "@/lib/domain/crypto";
import { env } from "@/lib/env";
import { createCoinbaseClient } from "@/lib/exchange/coinbase";
import { normalizeExchangeError } from "@/lib/exchange/errors";
import { createMockClient } from "@/lib/exchange/mock";
import type { ExchangeClient, KeyPermissions } from "@/lib/exchange/types";
import { appendAudit } from "@/lib/server/repos/audit";
import { deleteConnection, getConnection, saveConnection } from "@/lib/server/repos/exchange";
import { getOnboarding, saveOnboarding } from "@/lib/server/repos/onboarding";
import { getReferencePrice } from "@/lib/server/services/market";
import type { ExchangeConnection } from "@/lib/types";

async function setExchangeConnected(userId: string, exchangeConnected: boolean): Promise<void> {
  const current = await getOnboarding(userId);
  await saveOnboarding({
    userId,
    preferredMode: current.preferredMode,
    riskAcknowledged: current.riskAcknowledged,
    exchangeConnected,
    completedAt: current.completedAt
  });
}

export async function connectCoinbase(userId: string, keyId: string, secretPem: string): Promise<ExchangeConnection> {
  if (!env.secretKey) {
    throw new Error("Exchange connections are disabled: KAIRIS_SECRET_KEY is not set.");
  }
  const id = keyId.trim();
  const secret = secretPem.trim();
  if (!id || !secret) {
    throw new Error("Both the API key name and the private key are required.");
  }

  let permissions: KeyPermissions;
  try {
    permissions = await createCoinbaseClient({ keyId: id, secret }).keyPermissions();
  } catch (error) {
    const normalized = normalizeExchangeError(error);
    throw new Error(normalized.recommendation + " (" + normalized.code + ": " + normalized.message + ")");
  }
  const { canView, canTrade, canTransfer, portfolioUuid } = permissions;
  if (canTransfer) {
    throw new Error("This key can transfer funds. Kairis only accepts trade-only keys; create a new key without withdrawal or transfer permission.");
  }

  const now = new Date().toISOString();
  const connection = await saveConnection({
    userId,
    provider: "coinbase",
    keyId: id,
    canView,
    canTrade,
    canTransfer,
    portfolioUuid,
    validatedAt: now,
    createdAt: now,
    sealed: sealSecret(secret, env.secretKey)
  });
  await setExchangeConnected(userId, true);
  await appendAudit(userId, "exchange", "connected", `Coinbase key ${id} validated: view=${canView} trade=${canTrade}`);
  return connection;
}

export async function disconnectExchange(userId: string): Promise<void> {
  await deleteConnection(userId);
  await setExchangeConnected(userId, false);
  await appendAudit(userId, "exchange", "disconnected", "Coinbase key removed; the stored secret was deleted.");
}

export async function getConnectionStatus(userId: string): Promise<ExchangeConnection | null> {
  const stored = await getConnection(userId);
  if (!stored) {
    return null;
  }
  return {
    userId: stored.userId,
    provider: stored.provider,
    keyId: stored.keyId,
    canView: stored.canView,
    canTrade: stored.canTrade,
    canTransfer: stored.canTransfer,
    portfolioUuid: stored.portfolioUuid,
    validatedAt: stored.validatedAt,
    createdAt: stored.createdAt
  };
}

// The user's Coinbase key when one is stored and the server can open it; otherwise the mock provider.
export async function getExchangeClient(userId: string): Promise<ExchangeClient> {
  const stored = await getConnection(userId);
  if (stored && env.secretKey) {
    let secret: string;
    try {
      secret = openSecret(stored.sealed, env.secretKey);
    } catch {
      throw new Error("The stored Coinbase secret could not be decrypted (KAIRIS_SECRET_KEY changed?); reconnect the exchange.");
    }
    return createCoinbaseClient({ keyId: stored.keyId, secret });
  }
  return createMockClient(getReferencePrice);
}
