type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Remove target fixture summaries before their scores/status are parsed or
 * their detail endpoints are requested.
 */
export function excludeFixtureRows(
  rows: unknown[],
  excludedFixtureIds: readonly number[],
): unknown[] {
  if (!excludedFixtureIds.length) return rows;
  const excluded = new Set(excludedFixtureIds);
  return rows.filter((value) => {
    const row = asObject(value);
    const fixture = asObject(row?.fixture);
    const fixtureId = asInteger(fixture?.id) ?? asInteger(row?._id);
    return fixtureId === null || !excluded.has(fixtureId);
  });
}
