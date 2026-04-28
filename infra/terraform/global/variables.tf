variable "project_id" {
  type        = string
  description = "GCP project that owns the global resources (DNS, LB, Cloud Armor)."
}

variable "domain_root" {
  type        = string
  default     = "dmj.one"
  description = "Root domain. The zone must already be delegated to Cloud DNS or be created here."
}

variable "managed_zone_name" {
  type        = string
  default     = "vsbs-zone"
  description = "Cloud DNS managed-zone name."
}

variable "create_managed_zone" {
  type        = bool
  default     = true
  description = "If true, create the managed zone. If the zone exists outside Terraform, set to false and import."
}

// Backend service ids surfaced from each region module — these slot into the
// global URL map's host- and path-based rules.
variable "api_backend_in" {
  type        = string
  description = "Self-link / id of the India API backend service."
}

variable "web_backend_in" {
  type        = string
  description = "Self-link / id of the India web backend service."
}

variable "region_router_backend_in" {
  type        = string
  description = "Self-link / id of the India region-router backend service."
}

variable "api_backend_us" {
  type        = string
  description = "Self-link / id of the US API backend service."
}

variable "web_backend_us" {
  type        = string
  description = "Self-link / id of the US web backend service."
}

variable "region_router_backend_us" {
  type        = string
  description = "Self-link / id of the US region-router backend service."
}

variable "rate_limit_per_minute_otp" {
  type        = number
  default     = 100
  description = "Cloud Armor per-IP rate limit on /v1/auth/otp endpoints."
}

variable "rate_limit_per_minute_default" {
  type        = number
  default     = 600
  description = "Cloud Armor per-IP rate limit on everything else."
}

variable "iap_admin_member" {
  type        = string
  default     = ""
  description = "Optional IAM principal allowed through IAP for /admin paths (e.g. group:vsbs-ops@dmj.one)."
}
