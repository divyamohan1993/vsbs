// Inputs to the per-region VSBS data plane module.
//
// Each region is a fully-independent data plane: its own Cloud Run services,
// its own Firestore database, its own Secret Manager replicas pinned to the
// region (DPDP-India residency requires no replication out of asia-south1).

variable "project_id" {
  type        = string
  description = "GCP project that owns the region's resources."
}

variable "region" {
  type        = string
  description = "Full GCP region id (e.g. asia-south1, us-central1)."
}

variable "region_short" {
  type        = string
  description = "Short slug used in resource ids (e.g. in, us)."
  validation {
    condition     = can(regex("^[a-z]{2,4}$", var.region_short))
    error_message = "region_short must be 2-4 lowercase letters."
  }
}

variable "primary_locale" {
  type        = string
  description = "BCP-47 default locale for the region (e.g. en-IN, en-US)."
}

variable "firestore_location" {
  type        = string
  description = "Firestore location id. Use a regional location for residency, or nam5/eur3 for multi-region. India must use asia-south1 to meet DPDP residency."
}

variable "api_image" {
  type        = string
  description = "Full image URI for the API service."
}

variable "web_image" {
  type        = string
  description = "Full image URI for the web service."
}

variable "region_router_image" {
  type        = string
  description = "Full image URI for the region-router service that 302s users to the right regional FQDN."
}

variable "api_min_instances" {
  type        = number
  default     = 0
  description = "Minimum Cloud Run instances for the API."
}

variable "api_max_instances" {
  type        = number
  default     = 10
  description = "Maximum Cloud Run instances for the API."
}

variable "web_min_instances" {
  type        = number
  default     = 1
  description = "Minimum Cloud Run instances for the web tier."
}

variable "web_max_instances" {
  type        = number
  default     = 20
  description = "Maximum Cloud Run instances for the web tier."
}

variable "secret_replicas" {
  type        = list(string)
  default     = []
  description = "Region ids the Secret Manager secrets in this data plane may replicate to. Empty list pins replication to var.region, which is the DPDP-safe default."
}

variable "log_sink_dataset_project" {
  type        = string
  description = "Project that owns the central BigQuery dataset for cross-region observability."
}

variable "log_sink_dataset" {
  type        = string
  description = "Name of the BigQuery dataset (e.g. vsbs_logs) used as the destination for the regional log sink."
}

variable "service_account_api" {
  type        = string
  description = "Email of the API service account in this project."
}

variable "service_account_web" {
  type        = string
  description = "Email of the web service account in this project."
}

variable "fqdn_api" {
  type        = string
  description = "Region-pinned API FQDN (e.g. api-in.dmj.one)."
}

variable "fqdn_web" {
  type        = string
  description = "Region-pinned web FQDN (e.g. vsbs-in.dmj.one)."
}

variable "region_runtime_env" {
  type = map(string)
  default = {
    APP_REGION_RUNTIME = ""
    APP_PRIMARY_LOCALE = ""
  }
  description = "Optional extra env passed into the API container."
}

variable "cloud_armor_policy_id" {
  type        = string
  description = "Cloud Armor security policy id (from `security.tf`). Attached to every backend service in this region."
}

variable "iap_admin_client_id" {
  type        = string
  description = "OAuth2 client id used by Cloud IAP on the admin backend service."
}

variable "iap_admin_client_secret" {
  type        = string
  sensitive   = true
  description = "OAuth2 client secret used by Cloud IAP on the admin backend service."
}

variable "project_number" {
  type        = string
  description = "GCP project NUMBER (numeric). Used to compose the IAP audience `/projects/<num>/global/backendServices/<id>`."
}

variable "production_env" {
  type        = bool
  default     = true
  description = "When true, Cloud Run runs with NODE_ENV=production and live mode for every adapter. Set false for non-production region apply. NOTE: env.ts superRefine fails closed when NODE_ENV=production and any adapter is in sim mode or GCP_IAP_AUDIENCE is missing."
}

variable "autonomy_enabled" {
  type        = bool
  default     = false
  description = "Master kill switch for autonomous handover. Defaults to off until safety gates pass."
}
