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
