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
    if (rowById.has(id)) updates.push({ index: rowById.get(id), value: roast });
    else additions.push(roast);
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

