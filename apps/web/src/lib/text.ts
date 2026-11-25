/** "1 request", "3 requests". */
export const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;
