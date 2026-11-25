// A local stand-in for the parts of Stripe's API that Nodrail uses, so the real
// SDK and real webhook signatures run with no account. Never used with real keys.
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const newId = (prefix) => `${prefix}_${randomBytes(10).toString("hex")}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const MONTH = 30 * 86_400;

/** Stripe's form encoding: a[b][0][c]=d. */
function parseForm(text) {
  const result = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const path = key.replace(/\]/g, "").split("[");
    let target = result;
    for (const part of path.slice(0, -1)) target = target[part] ??= {};
    target[path.at(-1)] = value;
  }
  return result;
}

const page = (title, body) =>
  `<!doctype html><html lang="en"><title>${title}</title><meta name="viewport" content="width=device-width"><main><h1>${title}</h1><p>Local stand-in for Stripe. No real payment.</p>${body}</main></html>`;

const button = (action, label) =>
  `<form method="post" action="${action}"><button>${label}</button></form>`;

const apiError = (message) => ({
  status: 400,
  body: { error: { type: "invalid_request_error", message } },
});

/** Every known price is the approved Pro price: USD 29 every month. */
const priceBody = (id) => ({
  id,
  object: "price",
  active: true,
  currency: "usd",
  unit_amount: 2900,
  recurring: { interval: "month", interval_count: 1 },
});

export async function startFakeStripe({
  port = 0,
  apiKey,
  webhookSecret,
  prices,
  deliver,
}) {
  const customers = new Map();
  const sessions = new Map();
  const subscriptions = new Map();
  const portals = new Map();
  const events = new Map();
  const idempotent = new Map();
  let base = "";

  async function emit(type, object) {
    const event = {
      id: newId("evt"),
      object: "event",
      api_version: "fake",
      created: nowSeconds(),
      type,
      data: { object: structuredClone(object) },
    };
    events.set(event.id, event);
    return send(event);
  }

  function send(event) {
    const payload = JSON.stringify(event);
    const timestamp = nowSeconds();
    const digest = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    return deliver(payload, `t=${timestamp},v1=${digest}`);
  }

  async function pay(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error("Unknown session");
    const start = nowSeconds();
    const subscription = {
      id: newId("sub"),
      object: "subscription",
      customer: session.customer,
      status: "active",
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: session.subscription_metadata,
      items: {
        object: "list",
        data: [
          {
            id: newId("si"),
            object: "subscription_item",
            price: { id: session.price, object: "price" },
            current_period_start: start,
            current_period_end: start + MONTH,
          },
        ],
      },
    };
    subscriptions.set(subscription.id, subscription);
    session.subscription = subscription.id;
    session.status = "complete";
    await emit("customer.subscription.created", subscription);
    await emit("checkout.session.completed", session);
    return subscription;
  }

  async function updateSubscription(id, changes) {
    const subscription = subscriptions.get(id);
    if (!subscription) throw new Error("Unknown subscription");
    Object.assign(subscription, changes);
    await emit(
      subscription.status === "canceled"
        ? "customer.subscription.deleted"
        : "customer.subscription.updated",
      subscription,
    );
    return subscription;
  }

  const api = {
    "POST /v1/customers": (_, form) => {
      const customer = {
        id: newId("cus"),
        object: "customer",
        name: form.name ?? null,
        metadata: form.metadata ?? {},
      };
      customers.set(customer.id, customer);
      return { body: customer };
    },
    "POST /v1/checkout/sessions": (_, form) => {
      if (form.mode !== "subscription") return apiError("mode is required");
      if (!customers.has(form.customer)) return apiError("No such customer");
      const price = form.line_items?.[0]?.price;
      if (!prices.includes(price)) return apiError("No such price");
      if (!form.success_url || !form.cancel_url)
        return apiError("Return URLs are required");
      const id = newId("cs_test");
      const session = {
        id,
        object: "checkout.session",
        mode: "subscription",
        status: "open",
        customer: form.customer,
        price,
        success_url: form.success_url,
        cancel_url: form.cancel_url,
        subscription: null,
        subscription_metadata: form.subscription_data?.metadata ?? {},
        url: `${base}/checkout/${id}`,
      };
      sessions.set(id, session);
      return { body: session };
    },
    "POST /v1/billing_portal/sessions": (_, form) => {
      if (!customers.has(form.customer)) return apiError("No such customer");
      const id = newId("bps");
      const session = {
        id,
        object: "billing_portal.session",
        customer: form.customer,
        return_url: form.return_url,
        url: `${base}/portal/${id}`,
      };
      portals.set(id, session);
      return { body: session };
    },
    "GET /v1/checkout/sessions/:id": ([id]) =>
      sessions.has(id)
        ? { body: sessions.get(id) }
        : { status: 404, body: { error: { message: "No such session" } } },
    "DELETE /v1/subscriptions/:id": ([id]) => {
      const subscription = subscriptions.get(id);
      if (!subscription)
        return {
          status: 404,
          body: { error: { message: "No such subscription" } },
        };
      background(updateSubscription(id, { status: "canceled" }));
      return { body: { ...subscription, status: "canceled" } };
    },
    "GET /v1/subscriptions/:id": ([id]) => {
      const subscription = subscriptions.get(id);
      return subscription
        ? { body: subscription }
        : { status: 404, body: { error: { message: "No such subscription" } } };
    },
    "GET /v1/prices/:id": ([id]) =>
      prices.includes(id)
        ? { body: priceBody(id) }
        : { status: 404, body: { error: { message: "No such price" } } },
  };

  const liveFor = (customer) =>
    [...subscriptions.values()].find(
      (item) => item.customer === customer && item.status !== "canceled",
    );

  const redirect = (response, location) => {
    response.writeHead(303, { location }).end();
  };
  const background = (promise) => promise.catch(() => undefined);

  function browser(method, parts, response) {
    const [area, id, verb] = parts;
    if (area === "checkout" && sessions.has(id)) {
      const session = sessions.get(id);
      if (method === "GET")
        return html(
          response,
          page(
            "Subscribe to Nodrail Pro",
            button(`/checkout/${id}/pay`, "Pay") +
              button(`/checkout/${id}/decline`, "Use a declined card") +
              button(`/checkout/${id}/leave`, "Back"),
          ),
        );
      if (verb === "pay") {
        redirect(response, session.success_url);
        background(pay(id));
        return true;
      }
      if (verb === "leave")
        return (redirect(response, session.cancel_url), true);
      if (verb === "decline")
        return html(
          response,
          page(
            "Your card was declined",
            button(`/checkout/${id}/leave`, "Back"),
          ),
        );
    }
    if (area === "portal" && portals.has(id)) {
      const session = portals.get(id);
      const current = liveFor(session.customer);
      if (method === "GET")
        return html(
          response,
          page(
            "Manage your plan",
            button(`/portal/${id}/cancel`, "Cancel plan") +
              button(`/portal/${id}/leave`, "Return to Nodrail"),
          ),
        );
      if (verb === "cancel" && current) {
        redirect(response, session.return_url);
        // As the real portal does: a date, with cancel_at_period_end left false.
        background(
          updateSubscription(current.id, {
            cancel_at: current.items.data[0].current_period_end,
          }),
        );
        return true;
      }
      if (verb === "leave")
        return (redirect(response, session.return_url), true);
    }
    return false;
  }

  const html = (response, content) => {
    response.writeHead(200, { "content-type": "text/html" }).end(content);
    return true;
  };

  function route(method, path) {
    for (const [pattern, handler] of Object.entries(api)) {
      const [verb, template] = pattern.split(" ");
      if (verb !== method) continue;
      const wanted = template.split("/");
      const actual = path.split("/");
      if (wanted.length !== actual.length) continue;
      const params = [];
      if (
        wanted.every((part, index) => {
          if (part.startsWith(":")) return params.push(actual[index]) > 0;
          return part === actual[index];
        })
      )
        return { handler, params };
    }
    return null;
  }

  const handle = async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    const { pathname } = new URL(request.url, "http://x");
    const json = (status, body) =>
      response
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(body));
    try {
      if (pathname === "/health") return json(200, { ok: true });
      if (pathname.startsWith("/__control/")) {
        const [, , kind, id] = pathname.split("/");
        const body = text ? JSON.parse(text) : {};
        if (kind === "customer") return json(200, liveFor(id) ?? null);
        if (kind === "subscription")
          return json(200, await updateSubscription(id, body));
        return json(404, {});
      }
      if (pathname.startsWith("/v1/")) {
        if (request.headers.authorization !== `Bearer ${apiKey}`)
          return json(401, { error: { message: "Invalid API key" } });
        const match = route(request.method, pathname);
        if (!match) return json(404, { error: { message: "Not found" } });
        const key = request.headers["idempotency-key"];
        const remembered = key ? idempotent.get(key) : undefined;
        if (remembered) return json(200, remembered);
        const result = match.handler(match.params, parseForm(text));
        if (key && !result.status) idempotent.set(key, result.body);
        return json(result.status ?? 200, result.body);
      }
      if (browser(request.method, pathname.split("/").slice(1), response))
        return undefined;
      return json(404, {});
    } catch (error) {
      return json(500, { error: { message: String(error) } });
    }
  };

  const server = createServer((request, response) => {
    void handle(request, response);
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    pay,
    updateSubscription,
    send,
    eventsOf: (type) =>
      [...events.values()].filter((event) => event.type === type),
    liveFor,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { STRIPE_API_BASE, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } =
    process.env;
  const target = `${process.env.APP_ORIGIN}/api/webhooks/stripe`;
  const fake = await startFakeStripe({
    port: Number(new URL(STRIPE_API_BASE).port),
    apiKey: STRIPE_SECRET_KEY,
    webhookSecret: STRIPE_WEBHOOK_SECRET,
    prices: [process.env.STRIPE_PRICE_PRO],
    deliver: (payload, signature) =>
      fetch(target, {
        method: "POST",
        headers: { "stripe-signature": signature },
        body: payload,
      }),
  });
  console.log(`Local Stripe stand-in on ${fake.base}`);
}
