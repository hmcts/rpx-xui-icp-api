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
  thumbprints_in_quotes     = formatlist("&quot;%s&quot;", local.allowed_certificate_thumbprints)
  thumbprints_in_quotes_str = join(",", local.thumbprints_in_quotes)
  api_policy                = replace(file("template/api-policy.xml"), "ALLOWED_CERTIFICATE_THUMBPRINTS", local.thumbprints_in_quotes_str)
  api_base_path             = "${var.product}-${var.component}"
  icp_event_handler_url     = var.env == "prod" ? "https://xui-icp.platform.hmcts.net/eventhandler" : "https://xui-icp.${var.env}.platform.hmcts.net/eventhandler"
}

resource "azurerm_resource_group" "rg" {
  name     = "${var.product}-${var.component}-${var.env}"
  location = var.location

  tags = var.common_tags
}

data "azurerm_user_assigned_identity" "shared_identity" {
  name                = "rpa-${var.env}-mi"
  resource_group_name = "managed-identities-${var.env}-rg"
}

data "azurerm_key_vault" "shared_vault" {
  name                = "rpx-${local.local_env}"
  resource_group_name = "rpx-${local.local_env}"
}

data "azurerm_key_vault" "s2s_vault" {
  name                = "s2s-${local.local_env}"
  resource_group_name = "rpe-service-auth-provider-${local.local_env}"
}

data "azurerm_key_vault_secret" "s2s_key" {
  name         = "microservicekey-em-icp"
  key_vault_id = data.azurerm_key_vault.s2s_vault.id
}

data "azurerm_key_vault_secret" "existing_xui_s2s_key" {
  count        = local.local_env == "prod" ? 0 : 1
  name         = "microservicekey-xui-icp"
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

data "azurerm_key_vault_secret" "existing_em_s2s_key" {
  count        = local.local_env == "prod" ? 0 : 1
  name         = "microservicekey-em-icp"
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

resource "azurerm_key_vault_secret" "local_s2s_key" {
  name         = "microservicekey-xui-icp"
  value        = data.azurerm_key_vault_secret.s2s_key.value
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

resource "azurerm_key_vault_secret" "compat_s2s_key" {
  name         = "microservicekey-em-icp"
  value        = data.azurerm_key_vault_secret.s2s_key.value
  key_vault_id = data.azurerm_key_vault.shared_vault.id

  lifecycle {
    ignore_changes = all
  }
}

import {
  for_each = var.env == "prod" ? toset([]) : toset(["import"])

  to = azurerm_key_vault_secret.local_s2s_key
  id = data.azurerm_key_vault_secret.existing_xui_s2s_key[0].id
}

import {
  for_each = var.env == "prod" ? toset([]) : toset(["import"])

  to = azurerm_key_vault_secret.compat_s2s_key
  id = data.azurerm_key_vault_secret.existing_em_s2s_key[0].id
}

module "application_insights" {
  source = "git@github.com:hmcts/terraform-module-application-insights?ref=4.x"

  env                 = var.env
  product             = var.product
  name                = "${local.app_full_name}-appinsights"
  resource_group_name = azurerm_resource_group.rg.name
  # The subscription has reached its activity-log-alert limit. Use the
  # module's quota-safe scheduled-query alert instead.
  alert_limit_reached = true
  common_tags         = var.common_tags
}

resource "azurerm_key_vault_secret" "local_app_insights_key" {
  name         = "xui-icp-appinsights-instrumentation-key"
  value        = module.application_insights.connection_string
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

resource "azurerm_key_vault_secret" "compat_app_insights_key" {
  name         = "AppInsightsInstrumentationKey"
  value        = module.application_insights.connection_string
  key_vault_id = data.azurerm_key_vault.shared_vault.id

  lifecycle {
    ignore_changes = all
  }
}

data "azurerm_key_vault_secret" "existing_xui_app_insights_key" {
  count        = local.local_env == "prod" ? 0 : 1
  name         = "xui-icp-appinsights-instrumentation-key"
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

data "azurerm_key_vault_secret" "existing_compat_app_insights_key" {
  name         = "AppInsightsInstrumentationKey"
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

import {
  for_each = var.env == "prod" ? toset([]) : toset(["import"])

  to = azurerm_key_vault_secret.local_app_insights_key
  id = data.azurerm_key_vault_secret.existing_xui_app_insights_key[0].id
}

import {
  to = azurerm_key_vault_secret.compat_app_insights_key
  id = data.azurerm_key_vault_secret.existing_compat_app_insights_key.id
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

module "xui_icp_redis_cache" {
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
  name         = "xui-icp-redis-password"
  value        = module.xui_icp_redis_cache[0].access_key
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

resource "azurerm_key_vault_secret" "compat_redis_password" {
  count        = 1
  name         = "redis-password"
  value        = module.xui_icp_redis_cache[0].access_key
  key_vault_id = data.azurerm_key_vault.shared_vault.id

  lifecycle {
    ignore_changes = all
  }
}

data "azurerm_key_vault_secret" "existing_xui_redis_password" {
  count        = local.local_env == "prod" ? 0 : 1
  name         = "xui-icp-redis-password"
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

data "azurerm_key_vault_secret" "existing_compat_redis_password" {
  count        = local.local_env == "prod" ? 0 : 1
  name         = "redis-password"
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

import {
  for_each = var.env == "prod" ? toset([]) : toset(["import"])

  to = azurerm_key_vault_secret.local_redis_password[0]
  id = data.azurerm_key_vault_secret.existing_xui_redis_password[0].id
}

import {
  for_each = var.env == "prod" ? toset([]) : toset(["import"])

  to = azurerm_key_vault_secret.compat_redis_password[0]
  id = data.azurerm_key_vault_secret.existing_compat_redis_password[0].id
}

resource "azurerm_web_pubsub" "ped_web_pubsub" {
  name                          = "${local.app_full_name}-webpubsub-${var.env}"
  location                      = var.location
  resource_group_name           = azurerm_resource_group.rg.name
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
    identity_ids = [data.azurerm_user_assigned_identity.shared_identity.id]
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

resource "azurerm_key_vault_secret" "xui_icp_api_web_pubsub_primary_connection_string" {
  name         = "xui-icp-web-pubsub-primary-connection-string"
  value        = azurerm_web_pubsub.ped_web_pubsub.primary_connection_string
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

resource "azurerm_key_vault_secret" "compat_web_pubsub_primary_connection_string" {
  name         = "em-icp-web-pubsub-primary-connection-string"
  value        = azurerm_web_pubsub.ped_web_pubsub.primary_connection_string
  key_vault_id = data.azurerm_key_vault.shared_vault.id

  lifecycle {
    ignore_changes = all
  }
}

data "azurerm_key_vault_secret" "existing_xui_web_pubsub_primary_connection_string" {
  count        = local.local_env == "prod" ? 0 : 1
  name         = "xui-icp-web-pubsub-primary-connection-string"
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

data "azurerm_key_vault_secret" "existing_compat_web_pubsub_primary_connection_string" {
  count        = local.local_env == "prod" ? 0 : 1
  name         = "em-icp-web-pubsub-primary-connection-string"
  key_vault_id = data.azurerm_key_vault.shared_vault.id
}

import {
  for_each = var.env == "prod" ? toset([]) : toset(["import"])

  to = azurerm_key_vault_secret.xui_icp_api_web_pubsub_primary_connection_string
  id = data.azurerm_key_vault_secret.existing_xui_web_pubsub_primary_connection_string[0].id
}

import {
  for_each = var.env == "prod" ? toset([]) : toset(["import"])

  to = azurerm_key_vault_secret.compat_web_pubsub_primary_connection_string
  id = data.azurerm_key_vault_secret.existing_compat_web_pubsub_primary_connection_string[0].id
}

variable "user_ids" {
  type = list(string)
  default = [
    "3689a22e-1785-4944-bd9e-113355bfb070",
    "192df417-f2be-4bd9-8e3e-c08b6e4cb0b8"
  ]
  description = "List of user IDs to grant the Web PubSub Service Owner role to."
}

variable "manage_web_pubsub_role_assignments" {
  type        = bool
  default     = false
  description = "Opt in to user Web PubSub role assignments when platform RBAC permits them."
}

resource "azurerm_role_assignment" "web_pubsub_service_owner" {
  for_each = local.local_env != "prod" && var.manage_web_pubsub_role_assignments ? toset(var.user_ids) : toset([])

  scope                = azurerm_web_pubsub.ped_web_pubsub.id
  role_definition_name = "Web PubSub Service Owner"
  principal_id         = each.value

  lifecycle {
    prevent_destroy = true
  }
}
