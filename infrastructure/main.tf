provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}

# only for demo environment
provider "azurerm" {
  subscription_id = var.private_endpoint_subscription_id
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
  alias = "webpubsub_vnet_provider"
}

locals {
  app_full_name = "${var.product}-${var.component}"
  local_env     = var.env == "preview" ? "aat" : var.env
  s2s_key       = data.azurerm_key_vault_secret.s2s_key.value
  # list of the thumbprints of the SSL certificates that should be accepted by the API (gateway)
  allowed_certificate_thumbprints = [
    # API tests
    var.api_gateway_test_certificate_thumbprint,
    "29390B7A235C692DACD93FA0AB90081867177BEC"
  ]
  thumbprints_in_quotes      = formatlist("&quot;%s&quot;", local.allowed_certificate_thumbprints)
  thumbprints_in_quotes_str  = join(",", local.thumbprints_in_quotes)
  api_policy                 = replace(file("template/api-policy.xml"), "ALLOWED_CERTIFICATE_THUMBPRINTS", local.thumbprints_in_quotes_str)
  api_base_path              = "${var.product}-icp-api"
  icp_event_handler_url      = var.env == "prod" ? "https://em-icp.platform.hmcts.net/eventhandler" : "https://em-icp.${var.env}.platform.hmcts.net/eventhandler"
  managed_redis_environments = toset(var.env == "demo" ? [var.env] : [])
}

resource "azurerm_resource_group" "rg" {
  name     = "${var.product}-${var.component}-${var.env}"
  location = var.location

  tags = var.common_tags
}

data "azurerm_user_assigned_identity" "em-shared-identity" {
  name                = "rpa-${var.env}-mi"
  resource_group_name = "managed-identities-${var.env}-rg"
}

data "azurerm_user_assigned_identity" "jenkins" {
  name                = "jenkins-${var.env}-mi"
  resource_group_name = "managed-identities-${var.env}-rg"
}

module "local_key_vault" {
  source                       = "git@github.com:hmcts/cnp-module-key-vault?ref=DTSPO-31965/remove-jenkins-ptl-access"
  product                      = local.app_full_name
  env                          = var.env
  tenant_id                    = var.tenant_id
  object_id                    = var.jenkins_AAD_objectId
  resource_group_name          = azurerm_resource_group.rg.name
  product_group_object_id      = "5d9cd025-a293-4b97-a0e5-6f43efce02c0"
  common_tags                  = var.common_tags
  managed_identity_object_ids  = ["${data.azurerm_user_assigned_identity.em-shared-identity.principal_id}", "${var.managed_identity_object_id}"]
  jenkins_object_id            = data.azurerm_user_assigned_identity.jenkins.principal_id
  grant_preview_jenkins_access = var.env == "aat"
}

data "azurerm_key_vault" "s2s_vault" {
  name                = "s2s-${local.local_env}"
  resource_group_name = "rpe-service-auth-provider-${local.local_env}"
}

data "azurerm_key_vault_secret" "s2s_key" {
  name         = "microservicekey-em-icp"
  key_vault_id = data.azurerm_key_vault.s2s_vault.id
}

resource "azurerm_key_vault_secret" "local_s2s_key" {
  name         = "microservicekey-em-icp"
  value        = data.azurerm_key_vault_secret.s2s_key.value
  key_vault_id = module.local_key_vault.key_vault_id
}

data "azurerm_application_insights" "em_application_insight" {
  name                = "em-${local.local_env}"
  resource_group_name = "rpa-${local.local_env}"
}

resource "azurerm_key_vault_secret" "local_app_insights_key" {
  name         = "AppInsightsInstrumentationKey"
  value        = data.azurerm_application_insights.em_application_insight.connection_string
  key_vault_id = module.local_key_vault.key_vault_id
  depends_on   = [data.azurerm_application_insights.em_application_insight]
}


#Redis
data "azurerm_subnet" "core_infra_redis_subnet" {
  name                 = "core-infra-subnet-1-${var.env}"
  virtual_network_name = "core-infra-vnet-${var.env}"
  resource_group_name  = "core-infra-${var.env}"
}

#webpubsub
data "azurerm_subnet" "cft_infra_web_pub_sub_subnet" {
  name                 = "private-endpoints"
  virtual_network_name = "cft-${var.env}-vnet"
  resource_group_name  = "cft-${var.env}-network-rg"
  provider             = azurerm.webpubsub_vnet_provider
}

module "em-icp-redis-cache" {
  source                        = "git@github.com:hmcts/cnp-module-redis?ref=master"
  product                       = "${var.product}-${var.component}-redis-cache"
  location                      = var.location
  env                           = var.env
  count                         = 1
  redis_version                 = "6"
  subnetid                      = data.azurerm_subnet.core_infra_redis_subnet.id
  common_tags                   = var.common_tags
  private_endpoint_enabled      = true
  public_network_access_enabled = true
  business_area                 = "cft"
  sku_name                      = var.sku_name
  family                        = var.family
  capacity                      = var.capacity
}

resource "azurerm_key_vault_secret" "local_redis_password" {
  count        = 1
  name         = "redis-password"
  value        = module.em-icp-redis-cache[0].access_key
  key_vault_id = module.local_key_vault.key_vault_id
}

# Deploy Azure Managed Redis alongside the existing cache in demo. The legacy
# cache remains the application target until connectivity has been validated.
module "managed_redis" {
  for_each = local.managed_redis_environments

  source = "git@github.com:hmcts/terraform-module-azure-managed-redis?ref=main"

  product     = var.product
  component   = var.component
  env         = var.env
  location    = var.location
  common_tags = var.common_tags

  # The legacy demo cache is Basic C1 (1 GB), so Balanced B1 is the closest
  # Managed Redis starting point for validation.
  sku_name                  = "Balanced_B1"
  high_availability_enabled = false

  public_network_access   = "Disabled"
  create_private_endpoint = true
  subnet_id               = data.azurerm_subnet.core_infra_redis_subnet.id
  private_dns_zone_ids = [
    "/subscriptions/${var.private_endpoint_subscription_id}/resourceGroups/core-infra-intsvc-rg/providers/Microsoft.Network/privateDnsZones/privatelink.redis.azure.net"
  ]

  # Retain access-key authentication while the application uses ioredis with
  # a password supplied through Key Vault.
  access_keys_authentication_enabled = true
  persistence_rdb_backup_frequency   = "6h"
}

resource "azurerm_key_vault_secret" "managed_redis_password" {
  for_each = local.managed_redis_environments

  name         = "managed-redis-password"
  value        = module.managed_redis[each.key].primary_access_key
  key_vault_id = module.local_key_vault.key_vault_id
}

resource "azurerm_web_pubsub" "ped_web_pubsub" {
  name                          = "${local.app_full_name}-webpubsub-${var.env}"
  location                      = var.location
  resource_group_name           = "${local.app_full_name}-${var.env}"
  sku                           = "Standard_S1"
  capacity                      = 1
  public_network_access_enabled = false
  live_trace {
    enabled                   = true
    messaging_logs_enabled    = true
    connectivity_logs_enabled = false
  }
  tags = var.common_tags

  identity {
    type         = "UserAssigned"
    identity_ids = [data.azurerm_user_assigned_identity.em-shared-identity.id]
  }
}

resource "azurerm_private_endpoint" "ped_web_pubsub_private_endpoint" {
  name                = "${local.app_full_name}-${var.env}-privateendpoint"
  resource_group_name = "cft-${var.env}-network-rg"
  location            = var.location
  subnet_id           = data.azurerm_subnet.cft_infra_web_pub_sub_subnet.id
  provider            = azurerm.webpubsub_vnet_provider

  private_service_connection {
    name                           = "${local.app_full_name}-${var.env}-service-connection"
    is_manual_connection           = false
    private_connection_resource_id = azurerm_web_pubsub.ped_web_pubsub.id
    subresource_names              = ["webpubsub"]
  }
}

resource "azurerm_web_pubsub_network_acl" "ped_web_pubsub_network_acl" {
  web_pubsub_id  = azurerm_web_pubsub.ped_web_pubsub.id
  default_action = "Allow"
  public_network {
  }

  private_endpoint {
    id = azurerm_private_endpoint.ped_web_pubsub_private_endpoint.id
  }

  depends_on = [
    azurerm_private_endpoint.ped_web_pubsub_private_endpoint
  ]
}

resource "azurerm_web_pubsub_hub" "icpHub" {
  name          = "hub"
  web_pubsub_id = azurerm_web_pubsub.ped_web_pubsub.id
  event_handler {
    url_template       = local.icp_event_handler_url
    user_event_pattern = "*"
    system_events      = ["connect", "connected", "disconnected"]
  }
  anonymous_connections_enabled = true
  depends_on = [
    azurerm_web_pubsub.ped_web_pubsub
  ]
}

resource "azurerm_key_vault_secret" "em_icp_web_pubsub_primary_connection_string" {
  name         = "em-icp-web-pubsub-primary-connection-string"
  value        = azurerm_web_pubsub.ped_web_pubsub.primary_connection_string
  key_vault_id = module.local_key_vault.key_vault_id
}

variable "user_ids" {
  type = list(string)
  default = [
    "3689a22e-1785-4944-bd9e-113355bfb070",
    "192df417-f2be-4bd9-8e3e-c08b6e4cb0b8"
  ]
  description = "List of user IDs to grant the Web PubSub Service Owner role to."
}

resource "azurerm_role_assignment" "web_pubsub_service_owner" {
  # Preserve the existing for_each state addresses so current assignments are
  # not replaced during this migration.
  for_each = local.local_env != "prod" ? toset(var.user_ids) : []

  scope                = azurerm_web_pubsub.ped_web_pubsub.id
  role_definition_name = "Web PubSub Service Owner"
  principal_id         = each.value
}
