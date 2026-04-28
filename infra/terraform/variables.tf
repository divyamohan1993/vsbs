variable "project_id" {
  type        = string
  description = "GCP project id for VSBS deployments."
}

variable "region" {
  type        = string
  default     = "asia-south1"
  description = "Default provider region. Per-region modules pin their own."
}

variable "firestore_location" {
  type        = string
  default     = "asia-south1"
  description = "[deprecated — used only by the v0.1 single-region root] Firestore location id."
}

variable "api_image" {
  type        = string
  description = "Full image URI for the API (Artifact Registry)."
}

variable "web_image" {
  type        = string
  description = "Full image URI for the web app (Artifact Registry)."
}

variable "region_router_image" {
  type        = string
  description = "Full image URI for the region-router service."
}

variable "domain_root" {
  type        = string
  default     = "dmj.one"
  description = "Root domain for VSBS FQDNs."
}

variable "managed_zone_name" {
  type        = string
  default     = "vsbs-zone"
  description = "Cloud DNS managed-zone name."
}

variable "rate_limit_per_minute_otp" {
  type        = number
  default     = 100
  description = "Cloud Armor per-IP rate limit on /v1/auth/otp endpoints (per minute)."
}

variable "rate_limit_per_minute_default" {
  type        = number
  default     = 600
  description = "Cloud Armor per-IP rate limit on everything else (per minute)."
}

variable "iap_admin_member" {
  type        = string
  default     = ""
  description = "Optional IAM principal allowed through IAP for /admin paths."
}
