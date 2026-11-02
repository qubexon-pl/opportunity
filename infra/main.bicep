targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment, used to name the resource group.')
param environmentName string

@minLength(1)
@description('Location for all resources.')
param location string

@description('Fully qualified name of the existing Azure SQL server.')
param sqlServerFqdn string

@description('Name of the existing database on that server.')
param sqlDatabaseName string

@secure()
@description('Signing key for session cookies. Regenerated per provision unless supplied.')
param sessionSecret string = newGuid()

var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources './modules/resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    name: environmentName
    location: location
    tags: tags
    sqlServerFqdn: sqlServerFqdn
    sqlDatabaseName: sqlDatabaseName
    sessionSecret: sessionSecret
  }
}

output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_KEY_VAULT_NAME string = resources.outputs.keyVaultName
output AZURE_LOG_ANALYTICS_WORKSPACE_ID string = resources.outputs.logAnalyticsWorkspaceId

output WEB_APP_NAME string = resources.outputs.webAppName
output WEB_URL string = resources.outputs.webAppUrl

// Needed to grant the identity access inside the database.
output WEB_IDENTITY_NAME string = resources.outputs.identityName
output WEB_IDENTITY_CLIENT_ID string = resources.outputs.identityClientId
output WEB_IDENTITY_PRINCIPAL_ID string = resources.outputs.identityPrincipalId
