variable "product" {
  default = "xui"
}

variable "component" {
  default = "icp-api"
}

variable "location" {
  default = "UK South"
}

variable "env" {}

variable "common_tags" {
  type = map(string)
}

variable "tenant_id" {}

variable "jenkins_AAD_objectId" {
  description = "(Required) The Azure AD object ID of a user, service principal or security group in the Azure Active Directory tenant for the vault. The object ID must be unique for the list of access policies."
}

variable "subscription" {}

variable "managed_identity_object_id" {
  default = ""
}

variable "appinsights_location" {
  default     = "West Europe"
  description = "Location for Application Insights"
}

# thumbprint of the SSL certificate for API gateway tests
variable "api_gateway_test_certificate_thumbprint" {
  # keeping this empty by default, so that no thumbprint will match
  default = ""
}

variable "private_endpoint_subscription_id" {
  description = "Subscription ID for the private endpoint"
  type        = string
}

variable "private_dns_subscription_id" {
  type        = string
  default     = "1baf5470-1c3e-40d3-a6f7-74bfbce4b348"
  description = "Subscription containing the shared HMCTS private DNS zones."
}

variable "managed_redis_sku_name" {
  type        = string
  default     = "Balanced_B1"
  description = "Azure Managed Redis SKU."
}
