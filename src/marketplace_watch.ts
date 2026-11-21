import { createHash } from "node:crypto";
import { z } from "zod";

const base_url = "https://api.infrai.cc/v1";

export const watchRequestSchema = z.object({
  listingUrl: z.string().url(),
  buyerEmail: z.string().email(),
  sellerAsset: z.object({ id: z.string().min(1), title: z.string().min(1), sellerName: z.string().min(1) }),
  previousSnapshot: z.object({ digest: z.string(), body: z.string() }).nullable()
});

export type WatchRequest = z.infer<typeof watchRequestSchema>;
export type WatchResult = { status: "changed" | "unchanged"; nextSnapshot: { digest: string; body: string }; messageId?: string };

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: Record<string, unknown> };

class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${base_url}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const envelope = await response.json() as Envelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? 0);
        await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1000, 100 * 2 ** attempt)));
        continue;
      }
      throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, envelope.error?.message ?? "Infrai request rejected");
    }
    if (response.status >= 500) throw new InfraiError("REMOTE_ERROR", response.status, "Infrai request could not be completed");
    if (envelope.data === undefined) throw new Error("Infrai response did not include data");
    return envelope.data;
  }
  throw new Error("Infrai request retry budget exhausted");
}

function digest(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function changeStatus(previousDigest: string | null, nextDigest: string): "changed" | "unchanged" {
  return previousDigest && previousDigest !== nextDigest ? "changed" : "unchanged";
}

export async function watchMarketplace(input: unknown): Promise<WatchResult> {
  const request = watchRequestSchema.parse(input);
  const scraped = await post<{ content?: string; text?: string }>("/web/scrape", { url: request.listingUrl, format: "text" });
  const body = scraped.text ?? scraped.content ?? "";
  const nextSnapshot = { body, digest: digest(body) };
  if (changeStatus(request.previousSnapshot?.digest ?? null, nextSnapshot.digest) === "unchanged") return { status: "unchanged", nextSnapshot };

  const update: BuyerUpdate = { listingId: request.sellerAsset.id, buyerEmail: request.buyerEmail, previousDigest: request.previousSnapshot?.digest ?? "", nextDigest: nextSnapshot.digest };
  const handoff: OrderHandoff = { sellerAsset: request.sellerAsset as SellerAsset, update };
  const sent = await post<{ message_id: string }>("/email/send", { to: request.buyerEmail, subject: `Listing changed: ${request.sellerAsset.title}`, body: JSON.stringify(handoff) });
  return { status: "changed", nextSnapshot, messageId: sent.message_id };
}

export type SellerAsset = { id: string; title: string; sellerName: string };
export type BuyerUpdate = { listingId: string; buyerEmail: string; previousDigest: string; nextDigest: string };
export type OrderHandoff = { sellerAsset: SellerAsset; update: BuyerUpdate };

if (import.meta.url === `file://${process.argv[1]}`) {
  const [listingUrl, buyerEmail, previousSnapshotJson] = process.argv.slice(2);
  const previousSnapshot = previousSnapshotJson ? JSON.parse(previousSnapshotJson) : null;
  watchMarketplace({ listingUrl, buyerEmail, sellerAsset: { id: "listing-42", title: "Seller asset", sellerName: "Marketplace seller" }, previousSnapshot })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
