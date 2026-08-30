const TASTING_FIELDS = [
  "first_sip_acidity", "rawness", "floral", "fruit",
  "sugar_sweetness", "honey_sweetness", "texture", "dryness",
  "paper", "grain", "grass", "bitterness", "watery_finish",
  "aftertaste_duration", "free_comment",
];

const valueAt = (object, paths) => {
  for (const path of paths) {
    let value = object;
    for (const part of path.split(".")) value = value?.[part];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const stringOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const firstArray = (object, names) => {
  for (const name of names) if (Array.isArray(object?.[name])) return object[name];
  return [];
};

const numericPoint = (point) => {
  if (typeof point === "number") return Number.isFinite(point) ? point : null;
  return numberOrNull(point?.value ?? point?.y ?? point?.temperature);
};

const pointTime = (point) => numberOrNull(
  point?.elapsed_seconds ?? point?.elapsedSeconds ?? point?.time ?? point?.x,
);

const event = (roast, names) => numberOrNull(valueAt(roast, names));

const actionHistory = (roast, typeWords) => {
  const actions = Array.isArray(roast?.actions) ? roast.actions : [];
  return actions.flatMap((action) => {
    const type = String(action?.type ?? action?.name ?? action?.event ?? "").toLowerCase();
    if (!typeWords.some((word) => type.includes(word))) return [];
    return [{
      elapsed_seconds: numberOrNull(action?.time ?? action?.elapsedSeconds ?? action?.elapsed_seconds),
      value: numberOrNull(action?.value ?? action?.setting ?? action?.level),
      raw: structuredClone(action),
    }];
  });
};

export function emptyTasting(overrides = {}) {
  return Object.fromEntries(TASTING_FIELDS.map((field) => [
    field,
    stringOrNull(overrides[field]),
  ]));
}

export function normalizeProfile(roast = {}) {
  const series = {
    ibts: firstArray(roast, ["ibtsTemperature", "ibtsTemperatures", "ibts"]),
    bean_temperature: firstArray(roast, ["beanTemperature", "beanTemperatures", "beanTemp", "bt"]),
    ror: firstArray(roast, ["beanDerivative", "beanRoR", "rateOfRise", "ror"]),
    power: firstArray(roast, ["power", "powerSeries", "powerData"]),
    fan: firstArray(roast, ["fan", "fanSeries", "fanData"]),
    drum_speed: firstArray(roast, ["drumSpeed", "drumSpeeds", "drumSpeedSeries"]),
  };
  const explicitTimes = firstArray(roast, ["elapsedSeconds", "elapsed_seconds", "time", "times"]);
  const length = Math.max(explicitTimes.length, ...Object.values(series).map((values) => values.length), 0);
  return Array.from({ length }, (_, index) => {
    const sourcePoint = Object.values(series).find((values) => values[index] && typeof values[index] === "object")?.[index];
    return {
      elapsed_seconds: numberOrNull(explicitTimes[index]) ?? pointTime(sourcePoint),
      ibts: numericPoint(series.ibts[index]),
      bean_temperature: numericPoint(series.bean_temperature[index]),
      ror: numericPoint(series.ror[index]),
      power: numericPoint(series.power[index]),
      fan: numericPoint(series.fan[index]),
      drum_speed: numericPoint(series.drum_speed[index]),
    };
  });
}

export function normalizeRoast(roast = {}, bean = null, tasting = {}) {
  const total = event(roast, ["totalRoastTime", "totalTime", "dropTime"]);
  const firstCrack = event(roast, ["firstCrackTime", "first_crack_time"]);
  const development = total !== null && firstCrack !== null ? total - firstCrack : null;
  const varieties = valueAt(bean, ["varieties", "variety"]);
  const roastId = stringOrNull(valueAt(roast, ["uid", "id", "roastId"]));

  return {
    roast_id: roastId,
    roast_datetime: stringOrNull(valueAt(roast, ["dateTime", "roastDate", "createdAt"])),
    coffee_name: stringOrNull(valueAt(bean, ["name"]) ?? valueAt(roast, ["roastName", "name", "bean.name"])),
    origin_country: stringOrNull(valueAt(bean, ["country", "origin.country"]) ?? valueAt(roast, ["bean.country"])),
    farm_or_producer: stringOrNull(valueAt(bean, ["farm", "producer", "origin.farm"]) ?? valueAt(roast, ["bean.farm"])),
    variety: Array.isArray(varieties) ? varieties.map(String) : stringOrNull(varieties),
    process: stringOrNull(valueAt(bean, ["process", "processingMethod"]) ?? valueAt(roast, ["bean.process"])),
    batch_size_g: numberOrNull(valueAt(roast, ["weightGreen", "greenWeight", "chargeWeight"])),
    preheat_c: numberOrNull(valueAt(roast, ["preheatTemperature"])),
    charge_time_s: event(roast, ["chargeTime", "beanChargeTime"]),
    yellow_time_s: event(roast, ["yellowTime", "dryEndTime", "yellowingTime"]),
    first_crack_time_s: firstCrack,
    drop_time_s: event(roast, ["dropTime", "totalRoastTime"]),
    total_time_s: total,
    development_time_s: development,
    development_ratio_pct: total !== null && total > 0 && development !== null
      ? Math.round((development / total) * 1000) / 10
      : null,
    charge_ibts_c: numberOrNull(valueAt(roast, ["beanChargeTemperature", "chargeIbts"])),
    charge_bean_temperature_c: numberOrNull(valueAt(roast, ["drumChargeTemperature", "chargeBeanTemperature"])),
    yellow_ibts_c: numberOrNull(valueAt(roast, ["yellowTemperature", "yellowIbts"])),
    first_crack_ibts_c: numberOrNull(valueAt(roast, ["firstCrackTemp", "firstCrackIbts"])),
    drop_ibts_c: numberOrNull(valueAt(roast, ["dropTemperature", "dropIbts"])),
    power_changes: actionHistory(roast, ["power", "heater"]),
    fan_changes: actionHistory(roast, ["fan"]),
    drum_speed_changes: actionHistory(roast, ["drum"]),
    profile: normalizeProfile(roast),
    tasting: emptyTasting(tasting),
    raw_roast: structuredClone(roast),
    raw_bean: bean ? structuredClone(bean) : null,
  };
}

export { TASTING_FIELDS };

