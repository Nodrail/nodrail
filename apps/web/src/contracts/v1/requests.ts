/** How long a submitted request may wait for its permit before it expires. */
export const REQUEST_TTL_MINUTES = 60;

const shortId = (id: string) => id.slice(0, 8).toUpperCase();

/** What a request is called on screen and in its answers. */
export const requestReference = (id: string) => `REQ-${shortId(id)}`;

/** Finds a request by what is shown on screen or by its raw ID. */
export const withoutReferencePrefix = (text: string) =>
  text.replace(/^REQ-/i, "");
