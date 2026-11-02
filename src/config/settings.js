const store = require('./store');

const DEFAULT_PEOPLE = [
  'Anna Wacholak',
  'Jacek Szostak',
  'Grzegorz Nowakowski',
  'Krzysztof Bukowski',
  'Daniel Troska',
];

const DEFAULT_FIRM_STAGES = ['Won'];

const DEFAULT_VIEW_DEFAULTS = {
  pipeline: { stages: [], statuses: [] },
  management: { stages: [], statuses: [], people: [], managers: [], perspective: 'months', units: 6, offset: 0 },
};

/* Settings are held in memory by the store and persisted to Azure SQL (or the
   local file when there is no database), so reading them here is cheap. */
function loadFileConfig() {
  return store.snapshot();
}

function saveFileConfig(config) {
  return store.save(config);
}

let memo = { version: -1, value: null };

function getConfig() {
  // Called many times per request by the capacity maths, so the result is
  // built once per settings version rather than on every call.
  const version = store.currentVersion();
  if (memo.version === version) return memo.value;
  const fileConfig = store.peek();
  memo = { version, value: buildConfig(fileConfig) };
  return memo.value;
}

function buildConfig(fileConfig) {
  return {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '4000', 10),
    session: {
      secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    },
    sql: {
      server: process.env.AZURE_SQL_SERVER || '',
      database: process.env.AZURE_SQL_DATABASE || '',
      user: process.env.AZURE_SQL_USER || '',
      password: process.env.AZURE_SQL_PASSWORD || '',
      encrypt: (process.env.AZURE_SQL_ENCRYPT || 'true') === 'true',
      // Set when running under a user-assigned managed identity.
      clientId: process.env.AZURE_CLIENT_ID || '',
    },
    people: {
      names: Array.isArray(fileConfig.people) && fileConfig.people.length ? fileConfig.people : DEFAULT_PEOPLE,
      dailyHours: fileConfig.personDailyHours && typeof fileConfig.personDailyHours === 'object' ? fileConfig.personDailyHours : {},
      roles: fileConfig.personRoles && typeof fileConfig.personRoles === 'object' ? fileConfig.personRoles : {},
      costs: fileConfig.personCosts && typeof fileConfig.personCosts === 'object' ? fileConfig.personCosts : {},
      managers: fileConfig.personManagers && typeof fileConfig.personManagers === 'object' ? fileConfig.personManagers : {},
      absences: fileConfig.personAbsences && typeof fileConfig.personAbsences === 'object' ? fileConfig.personAbsences : {},
    },
    capacity: {
      firmStages: Array.isArray(fileConfig.firmStages) ? fileConfig.firmStages : DEFAULT_FIRM_STAGES,
    },
  };
}

function validateConfig({ requireProductionSecrets = false } = {}) {
  const cfg = getConfig();
  const errors = [];

  if (!Number.isInteger(cfg.port) || cfg.port <= 0) {
    errors.push('PORT must be a positive integer.');
  }
  if (requireProductionSecrets && (!cfg.session.secret || cfg.session.secret === 'dev-secret-change-me')) {
    errors.push('SESSION_SECRET must be set to a strong value in production.');
  }
  if (requireProductionSecrets && (!cfg.sql.server || !cfg.sql.database)) {
    errors.push('AZURE_SQL_SERVER and AZURE_SQL_DATABASE must be configured in production.');
  }

  if (errors.length) {
    throw new Error('Invalid configuration: ' + errors.join(' '));
  }

  return cfg;
}

function updatePeopleConfig({ people, personDailyHours, personRoles, personCosts, personManagers, personAbsences }) {
  const fileConfig = loadFileConfig();
  if (Array.isArray(people)) fileConfig.people = people;
  if (personDailyHours && typeof personDailyHours === 'object') fileConfig.personDailyHours = personDailyHours;
  if (personRoles && typeof personRoles === 'object') fileConfig.personRoles = personRoles;
  if (personCosts && typeof personCosts === 'object') fileConfig.personCosts = personCosts;
  if (personManagers && typeof personManagers === 'object') fileConfig.personManagers = personManagers;
  if (personAbsences && typeof personAbsences === 'object') fileConfig.personAbsences = personAbsences;
  return saveFileConfig(fileConfig);
}

function updateFirmStages(stages) {
  const fileConfig = loadFileConfig();
  fileConfig.firmStages = Array.isArray(stages) ? stages.map((stage) => String(stage)) : [];
  return saveFileConfig(fileConfig);
}

function toStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

/* Each signed-in person keeps their own saved filters; the shared key is what
   anyone without saved filters of their own (or without sign-in) starts from. */
const SHARED_VIEW_DEFAULTS_KEY = 'viewDefaults';

function viewDefaultsKey(userId) {
  return userId ? `${SHARED_VIEW_DEFAULTS_KEY}:user:${String(userId).toLowerCase()}` : SHARED_VIEW_DEFAULTS_KEY;
}

function normalizeViewDefaults(saved) {
  const pipeline = (saved && saved.pipeline) || {};
  const management = (saved && saved.management) || {};

  const units = Number(management.units);
  const offset = Number(management.offset);

  return {
    pipeline: {
      stages: toStringArray(pipeline.stages),
      statuses: toStringArray(pipeline.statuses),
    },
    management: {
      stages: toStringArray(management.stages),
      statuses: toStringArray(management.statuses),
      people: toStringArray(management.people),
      managers: toStringArray(management.managers),
      perspective: management.perspective ? String(management.perspective) : DEFAULT_VIEW_DEFAULTS.management.perspective,
      units: Number.isFinite(units) && units > 0 ? units : DEFAULT_VIEW_DEFAULTS.management.units,
      // Negative values look back at a period that has already happened.
      offset: Number.isFinite(offset) ? Math.trunc(offset) : DEFAULT_VIEW_DEFAULTS.management.offset,
    },
  };
}

/** Saved filter defaults for the pipeline and management screens, for one person when given. */
function getViewDefaults(userId) {
  const config = loadFileConfig();
  const own = userId ? config[viewDefaultsKey(userId)] : null;
  return normalizeViewDefaults(own || config[SHARED_VIEW_DEFAULTS_KEY] || {});
}

function updateViewDefaults(scope, values, userId) {
  if (scope !== 'pipeline' && scope !== 'management') throw new Error(`Unknown view scope: ${scope}`);

  const fileConfig = loadFileConfig();
  const current = getViewDefaults(userId);
  const key = viewDefaultsKey(userId);
  fileConfig[key] = { ...current, [scope]: { ...current[scope], ...values } };
  return saveFileConfig(fileConfig).then(() => fileConfig[key][scope]);
}

function isSqlConfigured() {
  return !!(process.env.AZURE_SQL_SERVER && process.env.AZURE_SQL_DATABASE);
}

module.exports = {
  DEFAULT_PEOPLE,
  DEFAULT_FIRM_STAGES,
  DEFAULT_VIEW_DEFAULTS,
  getConfig,
  validateConfig,
  updatePeopleConfig,
  updateFirmStages,
  getViewDefaults,
  updateViewDefaults,
  isSqlConfigured,
  refreshSettings: store.refresh,
};
