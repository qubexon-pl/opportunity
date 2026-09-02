const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', '..', 'config.local.json');

const DEFAULT_PEOPLE = [
  'Anna Wacholak',
  'Jacek Szostak',
  'Grzegorz Nowakowski',
  'Krzysztof Bukowski',
  'Daniel Troska',
];

const DEFAULT_FIRM_STAGES = ['Won'];

function loadFileConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[Settings] Error loading config file:', err.message);
  }
  return {};
}

function saveFileConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function getConfig() {
  const fileConfig = loadFileConfig();

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
    },
    people: {
      names: Array.isArray(fileConfig.people) && fileConfig.people.length ? fileConfig.people : DEFAULT_PEOPLE,
      dailyHours: fileConfig.personDailyHours && typeof fileConfig.personDailyHours === 'object' ? fileConfig.personDailyHours : {},
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

function updatePeopleConfig({ people, personDailyHours }) {
  const fileConfig = loadFileConfig();
  if (Array.isArray(people)) fileConfig.people = people;
  if (personDailyHours && typeof personDailyHours === 'object') fileConfig.personDailyHours = personDailyHours;
  saveFileConfig(fileConfig);
}

function updateFirmStages(stages) {
  const fileConfig = loadFileConfig();
  fileConfig.firmStages = Array.isArray(stages) ? stages.map((stage) => String(stage)) : [];
  saveFileConfig(fileConfig);
}

function isSqlConfigured() {
  const cfg = getConfig();
  return !!(cfg.sql.server && cfg.sql.database);
}

module.exports = {
  DEFAULT_PEOPLE,
  DEFAULT_FIRM_STAGES,
  getConfig,
  validateConfig,
  updatePeopleConfig,
  updateFirmStages,
  isSqlConfigured,
};
