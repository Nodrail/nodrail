// Local stand-in for the hosting scheduler: retries and silence alerts.
const url = `${process.env.APP_ORIGIN}/api/internal/notifications/deliver`;

for (;;) {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.NOTIFICATIONS_SECRET}` },
  }).catch((error) => ({ status: 0, text: () => String(error) }));
  console.log(new Date().toISOString(), response.status, await response.text());
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}
