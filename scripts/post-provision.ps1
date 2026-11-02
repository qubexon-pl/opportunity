$ErrorActionPreference = 'Stop'

function Get-AzdValue([string]$name) {
  $value = & azd env get-value $name
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($value | Out-String))) {
    throw "AZD environment value '$name' is not available."
  }
  return ($value | Out-String).Trim().Trim('"')
}

function Invoke-Az([string[]]$arguments) {
  $output = & az @arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Azure CLI command failed: az $($arguments[0..([Math]::Min(2, $arguments.Length - 1))] -join ' ')"
  }
  return $output
}

function Test-KvSecret([string]$vaultName, [string]$secretName) {
  $result = & az keyvault secret show --vault-name $vaultName --name $secretName --query id --output tsv --only-show-errors 2>$null
  return $LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($result | Out-String))
}

$resourceGroup = Get-AzdValue 'AZURE_RESOURCE_GROUP'
$webAppName = Get-AzdValue 'AZURE_WEBAPP_NAME'
$webAppPrincipalId = Get-AzdValue 'AZURE_WEBAPP_PRINCIPAL_ID'
$sqlServer = Get-AzdValue 'AZURE_SQL_SERVER'
$sqlServerName = Get-AzdValue 'AZURE_SQL_SERVER_NAME'
$sqlDatabase = Get-AzdValue 'AZURE_SQL_DATABASE'
$keyVaultName = Get-AzdValue 'AZURE_KEY_VAULT_NAME'
$keyVaultId = Get-AzdValue 'AZURE_KEY_VAULT_ID'
$tenantId = Get-AzdValue 'AZURE_TENANT_ID'
$environmentName = Get-AzdValue 'AZURE_ENV_NAME'

Write-Host 'Restricting Azure SQL firewall access to the App Service outbound addresses.'
$outboundAddresses = Invoke-Az @('webapp', 'show', '--resource-group', $resourceGroup, '--name', $webAppName, '--query', 'outboundIpAddresses', '--output', 'tsv', '--only-show-errors')
$outboundIps = @("$outboundAddresses" -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($outboundIps.Count -eq 0) {
  throw 'App Service did not report outbound IP addresses for the Azure SQL firewall.'
}
for ($index = 0; $index -lt $outboundIps.Count; $index++) {
  $ruleName = "appservice$index"
  $ipAddress = $outboundIps[$index]
  Invoke-Az @('sql', 'server', 'firewall-rule', 'create', '--resource-group', $resourceGroup, '--server', $sqlServerName, '--name', $ruleName, '--start-ip-address', $ipAddress, '--end-ip-address', $ipAddress, '--output', 'none', '--only-show-errors') | Out-Null
}

Write-Host 'Preparing Key Vault secrets and application authentication.'
$deployerObjectId = (& az ad signed-in-user show --query id --output tsv --only-show-errors).Trim()
if ($LASTEXITCODE -ne 0 -or -not $deployerObjectId) {
  throw 'Could not resolve the signed-in Entra user needed for scoped Key Vault secret setup.'
}

$roleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
$existingRole = & az role assignment list --assignee $deployerObjectId --scope $keyVaultId --include-inherited --query "[?roleDefinitionId=='/providers/Microsoft.Authorization/roleDefinitions/$roleId'].id | [0]" --output tsv --only-show-errors
if ($LASTEXITCODE -ne 0) {
  throw 'Could not inspect Key Vault role assignments.'
}

$temporaryRoleCreated = $false
if ([string]::IsNullOrWhiteSpace(($existingRole | Out-String))) {
  Invoke-Az @('role', 'assignment', 'create', '--role', $roleId, '--assignee-object-id', $deployerObjectId, '--assignee-principal-type', 'User', '--scope', $keyVaultId, '--output', 'none', '--only-show-errors') | Out-Null
  $temporaryRoleCreated = $true
}

try {
  $keyVaultAccessReady = $false
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    $probe = & az keyvault secret list --vault-name $keyVaultName --query '[].name' --output json --only-show-errors 2>$null
    if ($LASTEXITCODE -eq 0) {
      $keyVaultAccessReady = $true
      break
    }
    Start-Sleep -Seconds 5
  }
  if (-not $keyVaultAccessReady) {
    throw 'Key Vault data-plane access was not available after waiting for RBAC propagation.'
  }

  if (-not (Test-KvSecret $keyVaultName 'session-secret')) {
    $secretBytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
    $sessionSecret = [Convert]::ToBase64String($secretBytes)
    Invoke-Az @('keyvault', 'secret', 'set', '--vault-name', $keyVaultName, '--name', 'session-secret', '--value', $sessionSecret, '--output', 'none', '--only-show-errors') | Out-Null
    [Array]::Clear($secretBytes, 0, $secretBytes.Length)
    $sessionSecret = $null
  }

  $registrationName = "opportunities-$environmentName"
  $redirectUri = "https://$webAppName.azurewebsites.net/.auth/login/aad/callback"
  $matchingApps = Invoke-Az @('ad', 'app', 'list', '--display-name', $registrationName, '--query', "[?displayName=='$registrationName'].appId", '--output', 'json', '--only-show-errors') | ConvertFrom-Json
  if ($matchingApps.Count -gt 1) {
    throw "More than one Entra app registration is named '$registrationName'; resolve the duplicate before continuing."
  }

  if ($matchingApps.Count -eq 1) {
    $clientId = [string]$matchingApps[0]
    Invoke-Az @('ad', 'app', 'update', '--id', $clientId, '--web-redirect-uris', $redirectUri, '--only-show-errors', '--output', 'none') | Out-Null
  } else {
    $clientId = (& az ad app create --display-name $registrationName --sign-in-audience AzureADMyOrg --web-redirect-uris $redirectUri --query appId --output tsv --only-show-errors).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $clientId) {
      throw 'Could not create the Entra app registration. An administrator with application registration permission must create it.'
    }
  }

  $servicePrincipal = & az ad sp show --id $clientId --query id --output tsv --only-show-errors 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($servicePrincipal | Out-String))) {
    Invoke-Az @('ad', 'sp', 'create', '--id', $clientId, '--only-show-errors', '--output', 'none') | Out-Null
  }

  if (-not (Test-KvSecret $keyVaultName 'easy-auth-client-secret')) {
    $clientSecret = (& az ad app credential reset --id $clientId --append --years 2 --query password --output tsv --only-show-errors).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $clientSecret) {
      throw 'Could not create an Entra app credential for App Service Authentication.'
    }
    Invoke-Az @('keyvault', 'secret', 'set', '--vault-name', $keyVaultName, '--name', 'easy-auth-client-secret', '--value', $clientSecret, '--output', 'none', '--only-show-errors') | Out-Null
    $clientSecret = $null
  }

  $sessionReference = "@Microsoft.KeyVault(VaultName=$keyVaultName;SecretName=session-secret)"
  $authReference = "@Microsoft.KeyVault(VaultName=$keyVaultName;SecretName=easy-auth-client-secret)"
  Invoke-Az @('webapp', 'config', 'appsettings', 'set', '--resource-group', $resourceGroup, '--name', $webAppName, '--settings', "SESSION_SECRET=$sessionReference", "MICROSOFT_PROVIDER_AUTHENTICATION_SECRET=$authReference", '--output', 'none', '--only-show-errors') | Out-Null
  Invoke-Az @('webapp', 'auth', 'microsoft', 'update', '--resource-group', $resourceGroup, '--name', $webAppName, '--client-id', $clientId, '--client-secret-setting-name', 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET', '--issuer', "https://login.microsoftonline.com/$tenantId/v2.0", '--allowed-audiences', $clientId, '--only-show-errors') | Out-Null
  Invoke-Az @('webapp', 'auth', 'update', '--resource-group', $resourceGroup, '--name', $webAppName, '--enabled', 'true', '--action', 'RedirectToLoginPage', '--unauthenticated-client-action', 'RedirectToLoginPage', '--redirect-provider', 'azureactivedirectory', '--require-https', 'true', '--only-show-errors') | Out-Null

  Write-Host 'Granting the App Service identity its database permissions.'
  $env:SQL_SERVER = $sqlServer
  $env:SQL_DATABASE = $sqlDatabase
  $env:APP_SERVICE_NAME = $webAppName
  & node scripts/grant-sql-access.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not grant the App Service identity access to the Azure SQL database.'
  }
} finally {
  if ($temporaryRoleCreated) {
    Invoke-Az @('role', 'assignment', 'delete', '--assignee', $deployerObjectId, '--role', $roleId, '--scope', $keyVaultId, '--only-show-errors') | Out-Null
  }
}
