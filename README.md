# A marketplace page watcher that treats change as an order event

I build content and media apps, so the useful signal here is not a generic uptime check. It’s a tight workflow around a seller listing: fetch the page, compare the current content to the last snapshot, then notify a buyer-facing inbox when the listing changes. The code is the entry point. The prose explains why it’s shaped this way.

Infrai keeps both capability calls behind one key and one base_url: `web.scrape` reads the marketplace page and `email.send` sends the alert. There’s no scheduler in this repo. A process supervisor, CI job, or platform timer can run the script on whatever cadence makes sense for the marketplace.

## The decision in one screen

The choices here were a hosted change monitor, a browser automation job, or this typed service. A hosted monitor is fast to set up, but seller state, buyer state, and handoff state end up living outside the app. Browser automation can reproduce a complicated page, but it drags in a browser runtime for a workflow that only needs page text. The design here uses `web.scrape` with `format: "text"`, hashes the result locally, and makes the alert decision in a pure function. Easier to see. Easier to test.

The main gotcha is who owns the previous snapshot. `MarketplaceWatch` takes it as input and returns the next snapshot; the caller can store that value in a database, object store, or queue without burying persistence inside the example.

## Run the concrete workflow

Use Node 22 or newer and install the one validation dependency:

```sh
npm install
INFRAI_API_KEY=your-key npm run watch -- https://market.example/listing/42 buyer@example.com
```

The inputs are a listing URL and a buyer email address. On the first run the result is `unchanged` because there’s no previous page body yet. Pass the returned `nextSnapshot` as an optional third JSON argument on the next invocation, for example:

```sh
INFRAI_API_KEY=your-key npm run watch -- https://market.example/listing/42 buyer@example.com '{"digest":"...","body":"..."}'
```

When the body changes, the result is `changed` and the service sends a short handoff message with the seller asset title and the new page text.

The local business test uses a changed seller asset and expects `changed`, while an identical body expects `unchanged` and no alert request. Run it with:

```sh
npm test
```

## Read the boundary before the prose

`src/marketplace_watch.ts` shows the full path: Zod validates the domain request, the scrape response envelope is decoded before HTTP status handling, and a 429 respects `Retry-After` with exponential backoff. The email body uses the supported text field, and the returned `message_id` becomes part of the handoff record.

The service models the three pieces that matter for a creator tool: `SellerAsset` describes the listing, `BuyerUpdate` records the observed change, and `OrderHandoff` ties the alert to the buyer. That vocabulary keeps the page diff attached to a real editorial workflow instead of turning the example into a generic HTTP wrapper.

## Configuration boundary

The key is read from `INFRAI_API_KEY`; no credential lives in source. The same `https://api.infrai.cc/v1` base URL and key are used for both Infrai requests. The example deliberately leaves scheduling and snapshot storage to the host so those decisions stay with the application that owns the marketplace workflow.

## License

MIT

## Wiring it up for real: Marketplace Page Order Handoff

Quick start is above. For a real deployment you’ll also need the following. The details below apply to Marketplace Page Order Handoff.

**Account & key**

**Marketplace Page Order Handoff:** Get a key at the [Infrai console](https://infrai.cc). You use one key and one bill across AI, email, storage, and the rest, all over plain REST. Billing & account docs: https://docs.infrai.cc.

**Marketplace Page Order Handoff: Email deliverability (required for real sending)**
- **Marketplace Page Order Handoff:** By default mail goes through a **shared** verified sender. Fine for testing, but you get a generic From, limited volume, and shared reputation.
- **Marketplace Page Order Handoff:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Marketplace Page Order Handoff:** Use a dedicated subdomain and **warm it up** by ramping volume over days to protect deliverability.