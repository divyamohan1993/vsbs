// VSBS per-region data plane.
//
// Resources provisioned for a single region:
//   - Artifact Registry (Docker)
//   - Firestore database (regional location for residency)
//   - Secret Manager secrets replicated only to allowed regions
//   - Cloud Run v2 services: api, web
//   - IAM bindings (web invokes api; allUsers invokes web; logging sink writer)
//   - VPC connector for serverless egress
//   - Backend service + serverless NEG for the global LB
//   - Logging sink to a central BigQuery dataset
//
// References:
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/firestore_database
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_region_network_endpoint_group
//   https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/logging_project_sink

locals {
  region_label   = var.region
  region_tag     = var.region_short
  service_prefix = "vsbs-${var.region_short}"

  // Secret replication — DPDP-safe default is "pin to this region only".
  // Callers may pass extra replicas (e.g. asia-south2 for in-country DR) via
  // var.secret_replicas. Empty list means single-region pin.
  secret_replication_locations = length(var.secret_replicas) > 0 ? distinct(concat([var.region], var.secret_replicas)) : [var.region]
}

// ---- Artifact Registry (Docker images for this region) ----
resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  repository_id = "${local.service_prefix}-images"
  format        = "DOCKER"
  location      = var.region
  description   = "VSBS container images for ${var.region}"
  labels = {
    region   = local.region_tag
    workload = "vsbs"
  }
}

// ---- Firestore database (regional, for DPDP residency) ----
resource "google_firestore_database" "default" {
  project                           = var.project_id
  name                              = "vsbs-${var.region_short}"
  location_id                       = var.firestore_location
  type                              = "FIRESTORE_NATIVE"
  concurrency_mode                  = "OPTIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
}

// ---- Secret Manager — region-pinned replicas ----
resource "google_secret_manager_secret" "anthropic_key" {
  project   = var.project_id
  secret_id = "${local.service_prefix}-anthropic-api-key"
  replication {
    user_managed {
      dynamic "replicas" {
        for_each = local.secret_replication_locations
        content {
          location = replicas.value
        }
      }
    }
  }
  labels = {
    region    = local.region_tag
    purpose   = "llm"
    sensitive = "true"
  }
}

resource "google_secret_manager_secret" "maps_server_key" {
  project   = var.project_id
  secret_id = "${local.service_prefix}-maps-server-api-key"
  replication {
    user_managed {
      dynamic "replicas" {
        for_each = local.secret_replication_locations
        content {
          location = replicas.value
        }
      }
    }
  }
  labels = {
    region  = local.region_tag
    purpose = "maps"
  }
}

resource "google_secret_manager_secret" "smartcar_secret" {
  project   = var.project_id
  secret_id = "${local.service_prefix}-smartcar-client-secret"
  replication {
    user_managed {
      dynamic "replicas" {
        for_each = local.secret_replication_locations
        content {
          location = replicas.value
        }
      }
    }
  }
  labels = {
    region  = local.region_tag
    purpose = "telematics"
  }
}

resource "google_secret_manager_secret" "identity_platform_signing_key" {
  project   = var.project_id
  secret_id = "${local.service_prefix}-identity-platform-signing-key"
  replication {
    user_managed {
      dynamic "replicas" {
        for_each = local.secret_replication_locations
        content {
          location = replicas.value
        }
      }
    }
  }
  labels = {
    region  = local.region_tag
    purpose = "identity"
  }
}

// ---- Cloud Run v2: API ----
resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  name     = "${local.service_prefix}-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account                  = var.service_account_api
    max_instance_request_concurrency = 80
    timeout                          = "60s"

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    containers {
      image = var.api_image
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      ports {
        container_port = 8787
      }

      env {
        name  = "APP_REGION"
        value = var.region
      }
      env {
        name  = "APP_REGION_RUNTIME"
        value = var.region
      }
      env {
        name  = "APP_REGION_SHORT"
        value = var.region_short
      }
      env {
        name  = "APP_PRIMARY_LOCALE"
        value = var.primary_locale
      }
      env {
        name  = "APP_FQDN_API"
        value = var.fqdn_api
      }
      env {
        name  = "APP_FQDN_WEB"
        value = var.fqdn_web
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
      env {
        name = "SMARTCAR_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.smartcar_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "IDENTITY_PLATFORM_SIGNING_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.identity_platform_signing_key.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
          port = 8787
        }
        initial_delay_seconds = 2
        period_seconds        = 5
        timeout_seconds       = 2
        failure_threshold     = 5
      }

      liveness_probe {
        http_get {
          path = "/healthz"
          port = 8787
        }
        period_seconds  = 30
        timeout_seconds = 3
      }
    }
  }

  labels = {
    region   = local.region_tag
    workload = "api"
  }
}

// ---- Cloud Run v2: Web ----
resource "google_cloud_run_v2_service" "web" {
  project  = var.project_id
  name     = "${local.service_prefix}-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account                  = var.service_account_web
    max_instance_request_concurrency = 200

    scaling {
      min_instance_count = var.web_min_instances
      max_instance_count = var.web_max_instances
    }

    containers {
      image = var.web_image
      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }
      ports {
        container_port = 3000
      }
      env {
        name  = "APP_REGION"
        value = var.region
      }
      env {
        name  = "APP_REGION_RUNTIME"
        value = var.region
      }
      env {
        name  = "APP_PRIMARY_LOCALE"
        value = var.primary_locale
      }
      env {
        name  = "NEXT_PUBLIC_API_BASE"
        value = "https://${var.fqdn_api}"
      }
      env {
        name  = "NEXT_PUBLIC_REGION"
        value = var.region
      }
    }
  }

  labels = {
    region   = local.region_tag
    workload = "web"
  }
}

// ---- IAM: web service can invoke the api ----
resource "google_cloud_run_v2_service_iam_member" "api_invoker_web" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.service_account_web}"
}

// IAM: allow the global LB backend (handled at the global layer) — web is
// internal-LB only; the global URL map's serverless NEG fronts public traffic.
// We still want the api invokable from the LB principal, so grant allUsers
// at the LB layer is gated by Cloud Armor and IAP for /admin.

// ---- Serverless NEGs for the global Load Balancer ----
resource "google_compute_region_network_endpoint_group" "api_neg" {
  project               = var.project_id
  name                  = "${local.service_prefix}-api-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.api.name
  }
}

resource "google_compute_region_network_endpoint_group" "web_neg" {
  project               = var.project_id
  name                  = "${local.service_prefix}-web-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.web.name
  }
}

// ---- Backend services (one per service per region; the global URL map
//      attaches them with host- and path-based rules) ----
resource "google_compute_backend_service" "api" {
  project               = var.project_id
  name                  = "${local.service_prefix}-api-be"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_name             = "http"
  timeout_sec           = 60
  enable_cdn            = false

  log_config {
    enable      = true
    sample_rate = 1.0
  }

  backend {
    group = google_compute_region_network_endpoint_group.api_neg.id
  }
}

resource "google_compute_backend_service" "web" {
  project               = var.project_id
  name                  = "${local.service_prefix}-web-be"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_name             = "http"
  timeout_sec           = 60
  enable_cdn            = true

  cdn_policy {
    cache_mode                   = "CACHE_ALL_STATIC"
    default_ttl                  = 3600
    client_ttl                   = 3600
    max_ttl                      = 86400
    negative_caching             = true
    serve_while_stale            = 60
    signed_url_cache_max_age_sec = 0
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }

  backend {
    group = google_compute_region_network_endpoint_group.web_neg.id
  }
}

// ---- Logging sink → central BigQuery dataset, partitioned by region ----
resource "google_logging_project_sink" "regional" {
  project = var.project_id
  name    = "${local.service_prefix}-bq-sink"

  destination = "bigquery.googleapis.com/projects/${var.log_sink_dataset_project}/datasets/${var.log_sink_dataset}"

  // Capture only Cloud Run + LB + Cloud Armor logs for this region; drop
  // GCE noise that doesn't belong to us.
  filter = join(" ", [
    "resource.type=(\"cloud_run_revision\" OR \"http_load_balancer\")",
    "AND labels.\"goog-resource-region\"=\"${var.region}\""
  ])

  unique_writer_identity = true

  bigquery_options {
    use_partitioned_tables = true
  }
}

// ---- Cloud Run v2: region-router (302s users to the correct regional FQDN) ----
//
// This service is *publicly* reachable so the global LB can hit it as a
// fallback (when host-based routing alone cannot decide, e.g. requests to
// the geo-neutral apex). The actual residency decision is implemented in
// the container code (apps/api/src/middleware/region.ts is the same logic).
resource "google_cloud_run_v2_service" "region_router" {
  project  = var.project_id
  name     = "${local.service_prefix}-region-router"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account                  = var.service_account_api
    max_instance_request_concurrency = 200

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    containers {
      image = var.region_router_image
      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        cpu_idle = true
      }
      ports {
        container_port = 8787
      }
      env {
        name  = "APP_REGION_RUNTIME"
        value = var.region
      }
      env {
        name  = "REGION_ROUTER_ONLY"
        value = "true"
      }
      env {
        name  = "REGION_FQDN_IN"
        value = "vsbs-in.dmj.one"
      }
      env {
        name  = "REGION_FQDN_US"
        value = "vsbs-us.dmj.one"
      }
      env {
        name  = "REGION_FQDN_DEFAULT"
        value = var.fqdn_web
      }
    }
  }

  labels = {
    region   = local.region_tag
    workload = "region-router"
  }
}

resource "google_compute_region_network_endpoint_group" "region_router_neg" {
  project               = var.project_id
  name                  = "${local.service_prefix}-region-router-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.region_router.name
  }
}

resource "google_compute_backend_service" "region_router" {
  project               = var.project_id
  name                  = "${local.service_prefix}-region-router-be"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_name             = "http"
  timeout_sec           = 10
  enable_cdn            = false

  log_config {
    enable      = true
    sample_rate = 1.0
  }

  backend {
    group = google_compute_region_network_endpoint_group.region_router_neg.id
  }
}
