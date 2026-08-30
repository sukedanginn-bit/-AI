const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

const comparable = (value) => JSON.stringify(canonicalize(value));

export function planRoastUpsert(existingRows = [], incomingRoasts = []) {
  const rowById = new Map();
  existingRows.forEach((row, index) => {
    const id = String(row?.roast_id ?? "").trim();
    if (id) rowById.set(id, index);
  });

  const updates = [];
  const additions = [];
  const seenIncoming = new Set();
  for (const roast of incomingRoasts) {
    const id = String(roast?.roast_id ?? "").trim();
    if (!id || seenIncoming.has(id)) continue;
    seenIncoming.add(id);
    if (rowById.has(id)) {
      const index = rowById.get(id);
      if (comparable(existingRows[index]) !== comparable(roast)) {
        updates.push({ index, value: roast });
      }
    } else additions.push(roast);
  }
  return { updates, additions };
}

export async function applyUpsertAfterRemoteReady(existingRows, incomingRoasts, assertRemoteReady) {
  const plan = planRoastUpsert(existingRows, incomingRoasts);
  await assertRemoteReady();
  const result = existingRows.map((row) => structuredClone(row));
  for (const update of plan.updates) result[update.index] = structuredClone(update.value);
  result.push(...plan.additions.map((row) => structuredClone(row)));
  return result;
}
