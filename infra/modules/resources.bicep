targetScope = 'resourceGroup'

@description('Base name used to derive resource names.')
param name string

param location string = resourceGroup().location
param tags object = {}

param sqlServerFqdn string
param sqlDatabaseName string

@secure()
param sessionSecret string

var resourceSuffix = take(uniqueString(subscription().id, resourceGroup().name, name), 6)

// Key Vault names allow only letters, digits and dashes, and cap at 24 chars.
var shortName = take(toLower(replace(replace(name, '-', ''), '_', '')), 12)
var keyVaultName = 'kv-${shortName}-${resourceSuffix}'

var sessionSecretName = 'session-secret'

// Built-in role: Key Vault Secrets User
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${name}-${resourceSuffix}'
  location: location
  tags: tags
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${name}-${resourceSuffix}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${name}-${resourceSuffix}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    // RBAC rather than access policies, so the identity below is the only grant.
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

resource sessionSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: sessionSecretName
  properties: {
    value: sessionSecret
  }
}

resource keyVaultRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, identity.id, keyVaultSecretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${name}-${resourceSuffix}'
  location: location
  tags: tags
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
  properties: {
    reserved: true // Linux
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: 'app-${name}-${resourceSuffix}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    // Key Vault references resolve through this identity.
    keyVaultReferenceIdentity: identity.id
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/health'
      appCommandLine: 'npm start'
      appSettings: [
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          // Build on deploy, so node_modules never has to be committed or shipped.
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
        {
          name: 'AZURE_CLIENT_ID'
          value: identity.properties.clientId
        }
        {
          name: 'AZURE_SQL_SERVER'
          value: sqlServerFqdn
        }
        {
          name: 'AZURE_SQL_DATABASE'
          value: sqlDatabaseName
        }
        {
          name: 'AZURE_SQL_ENCRYPT'
          value: 'true'
        }
        {
          // Persistent storage, so people settings and absences survive restarts
          // and redeploys. The deployed app folder itself is not writable.
          name: 'OPP_CONFIG_FILE'
          value: '/home/data/config.local.json'
        }
        {
          name: 'SESSION_SECRET'
          value: '@Microsoft.KeyVault(VaultName=${keyVault.name};SecretName=${sessionSecretName})'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'ApplicationInsightsAgent_EXTENSION_VERSION'
          value: '~3'
        }
      ]
    }
  }
  dependsOn: [
    keyVaultRoleAssignment
    sessionSecretResource
  ]
}

resource webAppDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: webApp
  name: 'to-log-analytics'
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      {
        category: 'AppServiceConsoleLogs'
        enabled: true
      }
      {
        category: 'AppServiceHTTPLogs'
        enabled: true
      }
      {
        category: 'AppServiceAppLogs'
        enabled: true
      }
      {
        category: 'AppServicePlatformLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output keyVaultName string = keyVault.name
output logAnalyticsWorkspaceId string = logAnalytics.id
output webAppName string = webApp.name
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output identityName string = identity.name
output identityClientId string = identity.properties.clientId
output identityPrincipalId string = identity.properties.principalId
