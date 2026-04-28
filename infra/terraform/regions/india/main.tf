// VSBS — India (asia-south1) data plane wrapper.
//
// This file is invoked from the root with a `module "india"` block.
// It composes the reusable `modules/region` with India-specific settings:
//
//   - Firestore residency pinned to asia-south1 (DPDP Act 2023 + Rules 2025)
//   - Secret Manager replication never leaves IN
//   - Primary locale en-IN; the web shell flips Hindi via next-intl when the
//     Accept-Language negotiator picks hi-IN.
//
// References:
//   docs/compliance/dpia.md (residency rationale)
//   docs/research/security.md §3 (DPDP cross-border rules)

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }
}

variable "project_id" {
  type = string
}

variable "api_image" {
  type = string
}

variable "web_image" {
  type = string
}

variable "region_router_image" {
  type = string
}

variable "service_account_api" {
  type = string
}

variable "service_account_web" {
  type = string
}

variable "log_sink_dataset_project" {
  type = string
}

variable "log_sink_dataset" {
  type = string
}

variable "fqdn_api" {
  type    = string
  default = "api-in.dmj.one"
}

variable "fqdn_web" {
  type    = string
  default = "vsbs-in.dmj.one"
}

provider "google" {
  alias   = "in"
  project = var.project_id
  region  = "asia-south1"
}

provider "google-beta" {
  alias   = "in"
  project = var.project_id
  region  = "asia-south1"
}

module "india" {
  source = "../../modules/region"

  providers = {
    google      = google.in
    google-beta = google-beta.in
  }

  project_id   = var.project_id
  region       = "asia-south1"
  region_short = "in"

  primary_locale     = "en-IN"
  firestore_location = "asia-south1"

  // No replicas — DPDP-residency posture is "data stays in India".
  // For in-country DR the operator can add asia-south2 here once GA.
  secret_replicas = []

  api_image           = var.api_image
  web_image           = var.web_image
  region_router_image = var.region_router_image

  service_account_api = var.service_account_api
  service_account_web = var.service_account_web

  log_sink_dataset_project = var.log_sink_dataset_project
  log_sink_dataset         = var.log_sink_dataset

  fqdn_api = var.fqdn_api
  fqdn_web = var.fqdn_web

  api_min_instances = 0
  api_max_instances = 10
  web_min_instances = 1
  web_max_instances = 20
}

output "api_url" {
  value = module.india.api_url
}

output "web_url" {
  value = module.india.web_url
}

output "firestore_id" {
  value = module.india.firestore_id
}

output "api_backend_service_id" {
  value = module.india.api_backend_service_id
}

output "web_backend_service_id" {
  value = module.india.web_backend_service_id
}

output "region_router_backend_service_id" {
  value = module.india.region_router_backend_service_id
}

output "logging_sink_writer_identity" {
  value = module.india.logging_sink_writer_identity
}
