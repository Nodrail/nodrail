import source from "../../typeorm.config";

async function revert() {
  const count = Number(process.argv[2]);
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("Expected a positive migration count");

  await source.initialize();
  try {
    for (let remaining = count; remaining > 0; remaining -= 1)
      await source.undoLastMigration();
  } finally {
    await source.destroy();
  }
}

void revert().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
