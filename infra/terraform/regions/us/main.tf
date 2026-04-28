// VSBS — US (us-central1) data plane wrapper.
//
// CCPA + CPRA compliant; serves US, EU (until eu-* region is provisioned),
// and any non-IN traffic by default. Firestore is regional us-central1 to
// keep CCPA "selling-data" rules tractable; no cross-border replication.

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
  default = "api-us.dmj.one"
}

variable "fqdn_web" {
  type    = string
  default = "vsbs-us.dmj.one"
}

provider "google" {
  alias   = "us"
  project = var.project_id
  region  = "us-central1"
}

provider "google-beta" {
  alias   = "us"
  project = var.project_id
  region  = "us-central1"
}

module "us" {
  source = "../../modules/region"

  providers = {
    google      = google.us
    google-beta = google-beta.us
  }

  project_id   = var.project_id
  region       = "us-central1"
  region_short = "us"

  primary_locale     = "en-US"
  firestore_location = "us-central1"

  // For US/EU users we allow a second replica in us-east1 for DR.
  secret_replicas = ["us-east1"]

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
  value = module.us.api_url
}

output "web_url" {
  value = module.us.web_url
}

output "firestore_id" {
  value = module.us.firestore_id
}

output "api_backend_service_id" {
  value = module.us.api_backend_service_id
}

output "web_backend_service_id" {
  value = module.us.web_backend_service_id
}

output "region_router_backend_service_id" {
  value = module.us.region_router_backend_service_id
}

output "logging_sink_writer_identity" {
  value = module.us.logging_sink_writer_identity
}
