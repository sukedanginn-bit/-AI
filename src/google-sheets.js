const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
export const REQUIRED_SHEETS = ["Roasts", "ProfilePoints", "Tasting", "SyncState", "Schema"];

export const ROAST_COLUMNS = [
  "roast_id", "roast_datetime", "coffee_name", "origin_country", "farm_or_producer",
  "variety", "process", "batch_size_g", "preheat_c", "charge_time_s", "yellow_time_s",
  "first_crack_time_s", "drop_time_s", "total_time_s", "development_time_s",
  "development_ratio_pct", "charge_ibts_c", "charge_bean_temperature_c", "yellow_ibts_c",
  "first_crack_ibts_c", "drop_ibts_c", "source_hash",
];

const sleepDefault = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function rowToValues(row, columns = ROAST_COLUMNS) {
  return columns.map((column) => {
    const value = row?.[column];
    if (value === null || value === undefined) return "";
    return Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : value;
  });
}

export function valuesToRows(values = [], columns = ROAST_COLUMNS) {
  return values.map((valuesRow) => Object.fromEntries(columns.map((column, index) => [
    column, valuesRow[index] === "" || valuesRow[index] === undefined ? null : valuesRow[index],
  ])));
}

export function buildRoastValueBatches(plan, { sheetName = "Roasts", columns = ROAST_COLUMNS, chunkSize = 500 } = {}) {
  const ranges = [];
  for (const update of plan.updates) {
    ranges.push({
      range: `'${sheetName}'!A${update.index + 2}`,
      majorDimension: "ROWS",
      values: [rowToValues(update.value, columns)],
    });
  }
  if (plan.additions.length) {
    for (let index = 0; index < plan.additions.length; index += chunkSize) {
      ranges.push({
        range: `'${sheetName}'!A2`,
        append: true,
        majorDimension: "ROWS",
        values: plan.additions.slice(index, index + chunkSize).map((row) => rowToValues(row, columns)),
      });
    }
  }
  const batches = [];
  for (let index = 0; index < ranges.length; index += chunkSize) batches.push(ranges.slice(index, index + chunkSize));
  return batches;
}

export function createSheetsClient({ spreadsheetId, getAccessToken, fetchImpl = fetch, sleep = sleepDefault }) {
  if (!spreadsheetId) throw new Error("GOOGLE_SPREADSHEET_ID がありません");

  const request = async (path, options = {}, attempt = 0, token = null, refreshed = false) => {
    const accessToken = token || await getAccessToken();
    let response;
    try {
      response = await fetchImpl(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...options.headers },
      });
    } catch (error) {
      if (attempt >= 3) throw error;
      await sleep(250 * (2 ** attempt));
      return request(path, options, attempt + 1, accessToken, refreshed);
    }
    if (response.status === 401 && !refreshed) {
      const renewedToken = await getAccessToken({ forceRefresh: true });
      return request(path, options, attempt, renewedToken, true);
    }
    if (RETRYABLE.has(response.status) && attempt < 3) {
      await sleep(250 * (2 ** attempt));
      return request(path, options, attempt + 1, accessToken, refreshed);
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`Google Sheets API error (${response.status}): ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  };

  return {
    getSpreadsheet: () => request("?fields=sheets.properties"),
    async ensureSheets(names = REQUIRED_SHEETS) {
      const spreadsheet = await this.getSpreadsheet();
      const existing = new Set((spreadsheet.sheets || []).map((sheet) => sheet.properties?.title));
      const missing = names.filter((name) => !existing.has(name));
      if (!missing.length) return [];
      await request(":batchUpdate", {
        method: "POST", body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
      });
      return missing;
    },
    readRoasts: async (columns = ROAST_COLUMNS) => {
      const data = await request(`/values/${encodeURIComponent("Roasts!A2:ZZ")}?majorDimension=ROWS`);
      return valuesToRows(data.values || [], columns);
    },
    async applyRoastBatches(batches) {
      for (const batch of batches) {
        const updates = batch.filter((range) => !range.append);
        const appends = batch.filter((range) => range.append);
        if (updates.length) {
          await request("/values:batchUpdate", {
            method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: updates }),
          });
        }
        for (const append of appends) {
          await request(`/values/${encodeURIComponent("Roasts!A:ZZ")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
            method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: append.values }),
          });
        }
      }
    },
  };
}

export { RETRYABLE, SHEETS_API };
