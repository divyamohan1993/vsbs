// VSBS — root Terraform.
//
// Phase 4 (dual-region) refactor: this root composes two regional data planes
// (asia-south1 + us-central1) plus a global edge (DNS + LB + Cloud Armor) and
// a cross-region observability module (`observability.tf`).
//
// Per-region resources live in modules/region. India and US wrappers live in
// regions/india and regions/us so an operator can stand up only one region
// while another is being approved.
//
// References:
//   docs/research/dispatch.md §2 (per-region data plane motivation)
//   docs/compliance/dpia.md (DPDP residency)

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
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  backend "gcs" {
    // configure via `terraform init -backend-config=...`
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

// ---- Regional aliased providers (used by the region modules) ----
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

// ---- APIs (project-wide; enabled once per project) ----
locals {
  services = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "firestore.googleapis.com",
    "pubsub.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "cloudtrace.googleapis.com",
    "aiplatform.googleapis.com",
    "routes.googleapis.com",
    "places.googleapis.com",
    "geocoding.googleapis.com",
    "routeoptimization.googleapis.com",
    "documentai.googleapis.com",
    "speech.googleapis.com",
    "translate.googleapis.com",
    "identitytoolkit.googleapis.com",
    "recaptchaenterprise.googleapis.com",
    "binaryauthorization.googleapis.com",
    "cloudkms.googleapis.com",
    "redis.googleapis.com",
    "compute.googleapis.com",
    "dns.googleapis.com",
    "iap.googleapis.com",
    "bigquery.googleapis.com",
  ])
}

resource "google_project_service" "enabled" {
  for_each                   = local.services
  project                    = var.project_id
  service                    = each.key
  disable_on_destroy         = false
  disable_dependent_services = false
}

// ---- Service accounts (single set per project; reused across regions) ----
resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "vsbs-api"
  display_name = "VSBS API (Cloud Run)"
}

resource "google_service_account" "web" {
  project      = var.project_id
  account_id   = "vsbs-web"
  display_name = "VSBS Web (Cloud Run)"
}

resource "google_project_iam_member" "api_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_trace" {
  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.api.email}"
}

// ---- Per-region data planes ----
module "india" {
  source = "./modules/region"

  providers = {
    google      = google.in
    google-beta = google-beta.in
  }

  project_id   = var.project_id
  region       = "asia-south1"
  region_short = "in"

  primary_locale     = "en-IN"
  firestore_location = "asia-south1"
  secret_replicas    = []

  api_image           = var.api_image
  web_image           = var.web_image
  region_router_image = var.region_router_image

  service_account_api = google_service_account.api.email
  service_account_web = google_service_account.web.email

  log_sink_dataset_project = var.project_id
  log_sink_dataset         = google_bigquery_dataset.vsbs_logs.dataset_id

  fqdn_api = "api-in.dmj.one"
  fqdn_web = "vsbs-in.dmj.one"

  api_min_instances = 0
  api_max_instances = 10
  web_min_instances = 1
  web_max_instances = 20

  depends_on = [google_project_service.enabled]
}

module "us" {
  source = "./modules/region"

  providers = {
    google      = google.us
    google-beta = google-beta.us
  }

  project_id   = var.project_id
  region       = "us-central1"
  region_short = "us"

  primary_locale     = "en-US"
  firestore_location = "us-central1"
  secret_replicas    = ["us-east1"]

  api_image           = var.api_image
  web_image           = var.web_image
  region_router_image = var.region_router_image

  service_account_api = google_service_account.api.email
  service_account_web = google_service_account.web.email

  log_sink_dataset_project = var.project_id
  log_sink_dataset         = google_bigquery_dataset.vsbs_logs.dataset_id

  fqdn_api = "api-us.dmj.one"
  fqdn_web = "vsbs-us.dmj.one"

  api_min_instances = 0
  api_max_instances = 10
  web_min_instances = 1
  web_max_instances = 20

  depends_on = [google_project_service.enabled]
}

// ---- Grant each region's logging sink writer dataEditor on the central dataset ----
resource "google_bigquery_dataset_iam_member" "in_sink_editor" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.vsbs_logs.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = module.india.logging_sink_writer_identity
}

resource "google_bigquery_dataset_iam_member" "us_sink_editor" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.vsbs_logs.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = module.us.logging_sink_writer_identity
}

// ---- Global edge ----
module "global" {
  source = "./global"

  project_id        = var.project_id
  domain_root       = var.domain_root
  managed_zone_name = var.managed_zone_name

  api_backend_in           = module.india.api_backend_service_id
  web_backend_in           = module.india.web_backend_service_id
  region_router_backend_in = module.india.region_router_backend_service_id

  api_backend_us           = module.us.api_backend_service_id
  web_backend_us           = module.us.web_backend_service_id
  region_router_backend_us = module.us.region_router_backend_service_id

  rate_limit_per_minute_otp     = var.rate_limit_per_minute_otp
  rate_limit_per_minute_default = var.rate_limit_per_minute_default

  iap_admin_member = var.iap_admin_member

  depends_on = [google_project_service.enabled]
}

// ---- Outputs preserved from the v0.1 root ----
output "web_url_in" {
  value       = module.india.web_url
  description = "India regional web Cloud Run uri."
}

output "api_url_in" {
  value       = module.india.api_url
  description = "India regional API Cloud Run uri."
}

output "web_url_us" {
  value       = module.us.web_url
  description = "US regional web Cloud Run uri."
}

output "api_url_us" {
  value       = module.us.api_url
  description = "US regional API Cloud Run uri."
}

output "global_lb_ip" {
  value       = module.global.global_lb_ip
  description = "Global anycast IP all FQDNs A-record to."
}

// Backwards-compat shims so anything that still reads the old outputs works
// against the India region by default.
output "web_url" {
  value       = module.india.web_url
  description = "[deprecated] alias for module.india.web_url"
}

output "api_url" {
  value       = module.india.api_url
  description = "[deprecated] alias for module.india.api_url"
}
