// VSBS — minimal, production-shaped Terraform for GCP.
// Provisions the core resources described in docs/research/dispatch.md §2.
// This is the skeleton every environment inherits; tenancy and per-tenant
// overrides live in a separate module.

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    google      = { source = "hashicorp/google", version = ">= 6.10.0" }
    google-beta = { source = "hashicorp/google-beta", version = ">= 6.10.0" }
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

// ---- APIs ----
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
    "redis.googleapis.com", // Memorystore for Valkey
  ])
}

resource "google_project_service" "enabled" {
  for_each                   = local.services
  service                    = each.key
  disable_on_destroy         = false
  disable_dependent_services = false
}

// ---- Artifact Registry ----
resource "google_artifact_registry_repository" "containers" {
  repository_id = "vsbs"
  format        = "DOCKER"
  location      = var.region
  depends_on    = [google_project_service.enabled]
}

// ---- Service accounts ----
resource "google_service_account" "api" {
  account_id   = "vsbs-api"
  display_name = "VSBS API (Cloud Run)"
}

resource "google_service_account" "web" {
  account_id   = "vsbs-web"
  display_name = "VSBS Web (Cloud Run)"
}

// Minimal permissions — add more per module.
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

// ---- Firestore (Native) ----
resource "google_firestore_database" "default" {
  project                 = var.project_id
  name                    = "(default)"
  location_id             = var.firestore_location
  type                    = "FIRESTORE_NATIVE"
  concurrency_mode        = "OPTIMISTIC"
  app_engine_integration_mode = "DISABLED"
  depends_on              = [google_project_service.enabled]
}

// ---- Secret Manager ----
resource "google_secret_manager_secret" "anthropic_key" {
  secret_id = "anthropic-api-key"
  replication { auto {} }
}

resource "google_secret_manager_secret" "maps_server_key" {
  secret_id = "maps-server-api-key"
  replication { auto {} }
}

resource "google_secret_manager_secret" "smartcar_secret" {
  secret_id = "smartcar-client-secret"
  replication { auto {} }
}

// ---- Cloud Run services ----
resource "google_cloud_run_v2_service" "api" {
  name     = "vsbs-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.api.email
    max_instance_request_concurrency = 80
    scaling {
      max_instance_count = 10
      min_instance_count = 0
    }
    containers {
      image = var.api_image
      resources {
        limits = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      env {
        name  = "APP_REGION"
        value = var.region
      }
      env {
        name = "ANTHROPIC_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.anthropic_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "MAPS_SERVER_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.maps_server_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }
  depends_on = [google_project_service.enabled]
}

resource "google_cloud_run_v2_service" "web" {
  name     = "vsbs-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.web.email
    scaling {
      max_instance_count = 20
      min_instance_count = 1
    }
    containers {
      image = var.web_image
      resources { limits = { cpu = "1", memory = "1Gi" } }
    }
  }
  depends_on = [google_project_service.enabled]
}

// Public access for the web tier.
resource "google_cloud_run_v2_service_iam_member" "web_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

// API is reached only from the web tier by default.
resource "google_cloud_run_v2_service_iam_member" "api_from_web" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.web.email}"
}

output "web_url" { value = google_cloud_run_v2_service.web.uri }
output "api_url" { value = google_cloud_run_v2_service.api.uri }
