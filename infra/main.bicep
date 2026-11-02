targetScope = 'subscription'

@description('AZD environment name used for resource naming and tags.')
param environmentName string

@description('Azure region confirmed for this deployment.')
param location string

@description('Object ID of the Entra user who administers the new SQL server.')
param sqlAdminObjectId string

@description('User principal name of the Entra SQL administrator.')
param sqlAdminLogin string

@secure()
@description('Bootstrap SQL password required by the SQL server resource. Entra-only authentication is enabled.')
param sqlAdminPassword string = 'Aa1!${newGuid()}'

var tags = {
  'azd-env-name': environmentName
  application: 'opportunities'
}

resource resourceGroup 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module opportunities './modules/opportunities.bicep' = {
  name: 'opportunities-${environmentName}'
  scope: resourceGroup
  params: {
    environmentName: environmentName
    location: location
    sqlAdminObjectId: sqlAdminObjectId
    sqlAdminLogin: sqlAdminLogin
    sqlAdminPassword: sqlAdminPassword
    tags: tags
  }
}

output AZURE_RESOURCE_GROUP string = resourceGroup.name
output AZURE_WEBAPP_NAME string = opportunities.outputs.webAppName
output AZURE_WEBAPP_PRINCIPAL_ID string = opportunities.outputs.webAppPrincipalId
output AZURE_SQL_SERVER string = opportunities.outputs.sqlServerFqdn
output AZURE_SQL_SERVER_NAME string = opportunities.outputs.sqlServerName
output AZURE_SQL_DATABASE string = opportunities.outputs.sqlDatabaseName
output AZURE_KEY_VAULT_NAME string = opportunities.outputs.keyVaultName
output AZURE_KEY_VAULT_ID string = opportunities.outputs.keyVaultId
output AZURE_APP_URL string = opportunities.outputs.appUrl
output AZURE_TENANT_ID string = tenant().tenantId
