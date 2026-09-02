/**
 * Helpers for filters that accept several values at once. HTML sends a bare
 * string when one option is selected and an array when several are.
 */

function queryList(value) {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}

/** Keeps only values that appear in the allowed list, preserving its order. */
function filterAgainst(values, allowed) {
  const selected = new Set(queryList(values).map((value) => value.toLowerCase()));
  return allowed.filter((option) => selected.has(String(option).toLowerCase()));
}

/** Rebuilds a query string, expanding array values into repeated keys. */
function toQueryString(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, item));
    } else {
      search.append(key, String(value));
    }
  });
  return search.toString();
}

module.exports = { queryList, filterAgainst, toQueryString };
